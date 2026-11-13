import * as veo from './providers/veo.js';
import * as kling from './providers/kling.js';
import * as runway from './providers/runway.js';
import * as seedance from './providers/seedance.js';
import { getSettings } from '../appSettingsService.js';
import { describeHexColors } from '../../utils/colorNames.js';
import { aiLog, aiLogTimer } from '../../utils/aiLog.js';
import { ruleText } from '../blanketRulesService.js';
import { recordCallTrace, describeReferenceFiles } from '../aiUsageLogService.js';
import { priceVideoJob } from '../costEstimateService.js';
import { getPlan } from '../pipeline/pipelineService.js';

const PROVIDERS = { veo, kling, runway, seedance };
const POLL_LOG = new Map(); // `${provider}:${jobId}` -> { first, last } poll-log timestamps
const VIDEO_LABELS = { veo: 'Google Gemini Omni', kling: 'Kling', runway: 'Runway', seedance: 'Seedance' };

const ALIASES = {
  veo: 'veo',
  google: 'veo',
  gemini: 'veo', // admin AI Settings panel labels this option "Gemini" since it shares GEMINI_API_KEY
  kling: 'kling',
  runway: 'runway',
  runwayml: 'runway',
  seedance: 'seedance',
  bytedance: 'seedance'
};

function resolveName(provider) {
  if (!provider || provider === 'auto') return null;
  const key = ALIASES[provider.toLowerCase()];
  if (!key) throw new Error(`Unknown video provider "${provider}". Use veo, kling, runway, seedance, or auto.`);
  return key;
}

function priorityList() {
  const raw = process.env.AI_VIDEO_PRIORITY;
  const list = (raw ? raw.split(',') : ['veo', 'kling', 'runway', 'seedance']).map((s) => s.trim().toLowerCase());
  return list.map((p) => ALIASES[p]).filter(Boolean);
}

export function providerStatus() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([key, p]) => [key, p.isConfigured()]));
}

/**
 * Starts a video generation job with whichever provider is requested (or
 * the first configured one, in priority order, for "auto"). Returns
 * immediately - video generation takes 1-3+ minutes, so the caller polls
 * checkVideoJob separately rather than waiting here.
 */
export async function submitVideoJob({ provider = 'auto', prompt, aspectRatio, durationSeconds, imagePath }) {
  // Hex colour codes in a prompt get rendered as on-screen text - see utils/colorNames.js.
  prompt = describeHexColors(prompt);
  // COLOUR INTEGRITY for every video (all providers, all flows): full colour, product colours untouched.
  const colourRule = ruleText('videoColour');
  if (colourRule && !String(prompt).includes(colourRule.slice(0, 40))) prompt = `${prompt} ${colourRule}`;
  // GLITCH-FREE output for every video: stability only, it never restricts what moves (editable under Admin -> AI Settings -> Blanket instructions).
  const glitchRule = ruleText('videoGlitch');
  if (glitchRule && !String(prompt).includes(glitchRule.slice(0, 40))) prompt = `${prompt} ${glitchRule}`;
  // CORRECT HANDS for every video: no extra / merged / missing fingers or limbs (editable under Admin -> AI Settings -> Blanket instructions).
  const handsRule = ruleText('videoHands');
  if (handsRule && !String(prompt).includes(handsRule.slice(0, 40))) prompt = `${prompt} ${handsRule}`;
  // AI Block Architecture: a saved video pipeline decides the model order and any prompt blocks.
  const plan = await getPlan('video');
  for (const b of plan?.promptBlocks || []) if (b.type === 'prompt.suffix') prompt = `${prompt} ${b.text}`;
  // If the caller didn't ask for a specific provider, defer to whatever an
  // admin has pinned in Admin -> AI Settings ("Default video model") before
  // falling back to the AI_VIDEO_PRIORITY env chain - same pattern as
  // designService's resolveTextRotation/resolveImageModel for copy/images.
  let effectiveProvider = provider;
  if ((!provider || provider === 'auto') && !plan) {
    const settings = await getSettings().catch(() => null);
    if (settings?.videoModel && settings.videoModel !== 'auto') {
      effectiveProvider = settings.videoModel;
    }
  }

  const explicit = resolveName(effectiveProvider);
  const candidates = plan
    ? (!explicit || explicit === plan.order[0] ? plan.order : [explicit])
    : explicit ? [explicit] : priorityList();
  const configured = candidates.filter((c) => PROVIDERS[c].isConfigured());

  if (configured.length === 0) {
    aiLog('video', 'fail', { msg: 'no video provider configured - cannot start the job' });
    return {
      submitted: false,
      note:
        candidates.length === 0
          ? 'The AI video model is not set up yet. Ask an admin to configure it.'
          : 'The selected AI video model is not set up yet. Ask an admin to configure it.'
    };
  }

  let lastError;
  for (const key of configured) {
    const log = aiLogTimer('video', { provider: VIDEO_LABELS[key], model: PROVIDERS[key].videoModelName?.(), msg: 'submitting video job', extra: `${aspectRatio || ''} · ${durationSeconds ? durationSeconds + 's' : 'default length'} · ${imagePath ? 'image-to-video' : 'text-to-video'} · prompt ${String(prompt || '').length} chars` });
    const t0 = Date.now();
    try {
      // `billing` (exact model / resolution / billed seconds) is for cost logging only - kept out of providerMeta.
      const { externalJobId, billing, ...providerMeta } = await PROVIDERS[key].submitJob({ prompt, aspectRatio, durationSeconds, imagePath });
      const priced = billing ? priceVideoJob(key, billing) : null;
      recordCallTrace({
        type: 'video', provider: key, model: billing?.model || PROVIDERS[key].videoModelName?.() || '', size: aspectRatio || '',
        prompt: String(prompt || ''), mode: imagePath ? 'image-to-video' : 'text-to-video', referenceImages: imagePath ? 1 : 0, referenceFiles: imagePath ? describeReferenceFiles([{ filePath: imagePath, filename: 'Source image', role: 'source-frame' }]) : [], durationMs: Date.now() - t0,
        ...(priced ? { resolution: billing.resolution || '', videoSeconds: billing.seconds, rateUsd: priced.rateUsd, costBasis: priced.basis, actualCostUsd: priced.costUsd } : {})
      });
      log.done('job accepted - generation runs in the background', `job ${String(externalJobId).slice(-14)}`);
      return { submitted: true, provider: key, externalJobId, providerMeta: Object.keys(providerMeta).length ? providerMeta : undefined };
    } catch (err) {
      log.fail(err, configured.length > 1 ? 'trying next provider' : undefined);
      lastError = err;
      console.warn(`[ai:video] ${key} submit failed, trying next provider:`, err.message);
    }
  }
  return { submitted: false, note: lastError?.message || 'All configured video providers failed to accept the job.' };
}

/**
 * Polls a previously submitted job. Returns { status: 'processing' } while
 * still running, or { status: 'completed', videoUrl } / { status: 'failed', note }.
 * providerMeta carries anything a provider's submitJob returned beyond
 * externalJobId that its own checkJob needs back (currently just Kling's
 * endpoint, since its image-to-video and text-to-video jobs are polled at
 * different URLs).
 */
export async function checkVideoJob({ provider, externalJobId, providerMeta }) {
  const key = resolveName(provider) || provider;
  if (!PROVIDERS[key]) throw new Error(`Unknown video provider "${provider}".`);
  const result = await PROVIDERS[key].checkJob({ externalJobId, ...(providerMeta || {}) });
  // Polling happens every few seconds - log the first poll, then a heartbeat every ~30s, plus the final outcome.
  const jobKey = `${key}:${externalJobId}`;
  const now = Date.now();
  const seen = POLL_LOG.get(jobKey);
  const info = { provider: VIDEO_LABELS[key], model: PROVIDERS[key].videoModelName?.(), extra: `job ${String(externalJobId).slice(-14)}` };
  if (result.status === 'completed') {
    aiLog('video', 'done', { ...info, msg: 'video generated by the model', ms: seen ? now - seen.first : undefined });
    POLL_LOG.delete(jobKey);
  } else if (result.status === 'failed') {
    aiLog('video', 'fail', { ...info, msg: `video generation failed: ${String(result.note || 'unknown error').slice(0, 200)}`, ms: seen ? now - seen.first : undefined });
    POLL_LOG.delete(jobKey);
  } else if (!seen || now - seen.last > 30000) {
    aiLog('video', 'info', { ...info, msg: seen ? 'still generating…' : 'generating - waiting on the model', ms: seen ? now - seen.first : undefined });
    POLL_LOG.set(jobKey, { first: seen?.first || now, last: now });
  }
  return result;
}

/** Exact video model IDs for the workspace selection ('auto' = every provider in the order tried). */
export function describeActiveVideoModels(selection = 'auto') {
  const explicit = resolveName(selection);
  const candidates = explicit ? [explicit] : priorityList();
  return candidates.map((c) => ({ provider: VIDEO_LABELS[c] || c, model: PROVIDERS[c].videoModelName(), configured: Boolean(PROVIDERS[c].isConfigured()) }));
}
