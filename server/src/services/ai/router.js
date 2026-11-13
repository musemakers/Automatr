import * as openai from './providers/openai.js';
import { describeHexColors } from '../../utils/colorNames.js';
import * as anthropic from './providers/anthropic.js';
import * as gemini from './providers/gemini.js';
import * as seedream from './providers/seedream.js';
import { annotateIfBillingError } from '../../utils/classifyAiError.js';
import { detectBlackBars } from '../../utils/imageBars.js';
import { sniffImageMime } from '../../utils/sniffImageMime.js';
import { ruleText, ruleTexts } from '../blanketRulesService.js';
import { isMonochromeOutput } from '../../utils/colourGuard.js';
import { aiLog, aiLogTimer } from '../../utils/aiLog.js';
import { openaiImageCostFromUsage, geminiImageCostFromUsage } from '../../constants/aiPricing.js';
import { recordCallTrace, describeReferenceFiles } from '../aiUsageLogService.js';
import { getPlan, customProvider } from '../pipeline/pipelineService.js';
import { getSettings } from '../appSettingsService.js';

const PROVIDERS = { openai, anthropic, gemini, seedream };

const ALIASES = {
  gpt: 'openai',
  openai: 'openai',
  chatgpt: 'openai',
  claude: 'anthropic',
  anthropic: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  seedream: 'seedream',
  bytedance: 'seedream'
};

// AI Block Architecture (Admin -> AI Blocks): a saved pipeline decides which models are tried, in
// what order, which quality checks run and which prompt blocks apply. With no saved pipeline
// getPlan() is null and everything below behaves exactly as before.
const getProv = (key) => PROVIDERS[key] || customProvider(key);

function pickCandidates(plan, explicit, fallback) {
  if (!plan) return fallback;
  if (!explicit) return plan.order;
  if (explicit === plan.order[0]) return plan.order; // the pipeline's own primary: include its fallbacks
  return [explicit]; // a deliberate per-call override (e.g. "Alternative model")
}

function applyPromptBlocks(plan, text) {
  let out = text;
  for (const b of plan?.promptBlocks || []) if (b.type === 'prompt.suffix') out = `${out} ${b.text}`;
  return out;
}

/** Plan info for callers that choose models themselves (designService). */
export async function planInfo(workflow) {
  const plan = await getPlan(workflow);
  if (!plan) return null;
  const configuredOrder = (plan.order || []).filter((k) => getProv(k)?.isConfigured());
  return { ...plan, configuredOrder };
}

function resolveName(model) {
  if (!model || model === 'auto') return null;
  if (String(model).startsWith('custom:')) return model;
  const key = ALIASES[model.toLowerCase()];
  if (!key) throw new Error(`Unknown model "${model}". Use gpt, claude, gemini, or auto.`);
  return key;
}

function priorityList(envVar, fallback) {
  const raw = process.env[envVar];
  const list = (raw ? raw.split(',') : fallback).map((s) => s.trim().toLowerCase());
  return list.map((m) => ALIASES[m]).filter(Boolean);
}

/**
 * Generate text, either from a specific model or by trying providers in
 * priority order until one succeeds (model === "auto" or omitted).
 */
export async function generateText({ model = 'auto', system, prompt, maxTokens, purpose }) {
  const plan = await getPlan('copy');
  const explicit = resolveName(model);
  const candidates = pickCandidates(plan, explicit, explicit ? [explicit] : priorityList('AI_TEXT_PRIORITY', ['openai', 'anthropic', 'gemini']));
  if (plan?.promptBlocks?.length) system = applyPromptBlocks(plan, system || '').trim() || system;

  const configured = candidates.filter((c) => getProv(c)?.isConfigured());
  if (configured.length === 0) {
    aiLog('text', 'fail', { msg: `${purpose || 'text generation'}: no text provider configured - returning placeholder text` });
    return {
      text: placeholderCaption(prompt),
      modelUsed: 'placeholder',
      note: 'The AI text model is not set up yet. Ask an admin to configure it.'
    };
  }

  let lastError;
  for (const providerKey of configured) {
    const log = aiLogTimer('text', { provider: PROVIDER_LABELS[providerKey] || providerKey, model: getProv(providerKey).textModelName?.(), msg: purpose || 'generating text', extra: `${String(prompt || '').length} chars in` });
    const t0 = Date.now();
    try {
      const text = await getProv(providerKey).generateText({ system, prompt, maxTokens });
      log.done(purpose || 'text ready', `${String(text || '').length} chars out`);
      recordCallTrace({
        type: 'text', provider: providerKey, model: getProv(providerKey).textModelName?.() || '', purpose: purpose || '',
        // providers don't report usage, so tokens are ~4 characters each (same basis as the cost estimate)
        inputTokens: Math.ceil((String(system || '').length + String(prompt || '').length) / 4), outputTokens: Math.ceil(String(text || '').length / 4), tokensEstimated: true,
        durationMs: Date.now() - t0
      });
      return { text, modelUsed: providerKey };
    } catch (err) {
      log.fail(err, configured.length > 1 ? 'trying next provider' : undefined);
      lastError = annotateIfBillingError(err, providerKey);
      console.warn(`[ai:text] ${providerKey} failed, trying next provider:`, err.message);
    }
  }
  throw lastError || new Error('All configured text providers failed.');
}

const MAX_BAR_RETRIES = 2;
const MAX_COLOUR_RETRIES = 2;
// The standing instructions added below (full canvas, colour integrity and their retry wording) are edited under Admin -> AI Settings -> Blanket instructions.

/**
 * Generate an image, either from a specific model or by trying providers in
 * priority order. Anthropic/Claude is never selected here (no image API).
 */
export async function generateImage({ model = 'auto', prompt, size, quality: requestedQuality, referenceImages = [], purpose, inputFidelity }) {
  // Last line of defence: no hex colour code may reach an image model, or it
  // can get drawn onto the creative as text. See utils/colorNames.js.
  const plan = await getPlan('image');
  // Prompt blocks from the AI Block pipeline (instruction text, then the optional prompt enhancer).
  for (const b of plan?.promptBlocks || []) {
    if (b.type === 'prompt.suffix') prompt = `${prompt} ${b.text}`;
    if (b.type === 'prompt.enhance') {
      try {
        const r = await generateText({ model: 'auto', system: b.instruction, prompt, maxTokens: 700, purpose: 'prompt enhancer block' });
        if (r.modelUsed !== 'placeholder' && r.text) prompt = r.text;
      } catch (err) {
        console.warn('[ai:image] prompt enhancer failed, using the original prompt:', err.message);
      }
    }
  }
  prompt = describeHexColors(prompt);
  const explicit = resolveName(model);
  const candidates = pickCandidates(plan, explicit, explicit
    ? [explicit]
    : priorityList('AI_IMAGE_PRIORITY', ['openai', 'gemini', 'seedream']));
  const baseRules = ruleTexts(['imageFullCanvas', 'imageProductColour', 'imageNoMonochrome']);
  const withRules = (...extra) => [prompt, baseRules, ...extra].filter(Boolean).join(' ');
  // Automatic black-bar / greyscale checks (each failure = another billed image) are OFF by default: the "Fill the whole canvas" and
  // "Full colour only" rules are part of every image prompt instead. To bring a check back, add its block to a saved image pipeline
  // (Admin -> AI Blocks) or set IMAGE_QA_CHECKS=on to restore the old defaults.
  const qaOn = String(process.env.IMAGE_QA_CHECKS || '').toLowerCase() === 'on';
  const qa = plan?.qa || { blackBars: { enabled: qaOn, retries: qaOn ? MAX_BAR_RETRIES : 0 }, colour: { enabled: qaOn, retries: qaOn ? MAX_COLOUR_RETRIES : 0 } };

  const imageCapable = candidates.filter((c) => c !== 'anthropic');
  const configured = imageCapable.filter((c) => getProv(c)?.isConfigured());

  if (configured.length === 0) {
    aiLog('image', 'fail', { msg: `${purpose || 'image generation'}: no image provider configured - returning placeholder` });
    return {
      placeholder: true,
      modelUsed: 'placeholder',
      note:
        imageCapable.length === 0
          ? 'The AI image model is not set up yet. Ask an admin to configure it.'
          : 'The AI image model is not set up yet. Ask an admin to configure it.'
    };
  }

  let lastError;
  for (const providerKey of configured) {
    // OPENAI_IMAGE_QUALITY (low | medium | high | xhigh | max | auto) overrides the quality sent to OpenAI image models only; unset = unchanged.
    const envQuality = String(process.env.OPENAI_IMAGE_QUALITY || '').trim().toLowerCase();
    const quality = providerKey === 'openai' && ['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(envQuality) ? envQuality : requestedQuality;
    const log = aiLogTimer('image', { provider: PROVIDER_LABELS[providerKey] || providerKey, model: getProv(providerKey).imageModelName?.(), msg: purpose || 'generating image', extra: `${size || ''} · ${quality || ''} · ${referenceImages.length} reference image(s) · prompt ${String(prompt || '').length} chars` });
    const t0 = Date.now();
    let attempts = 0;
    // Real token usage (OpenAI reports it per call); summed over every attempt, since regenerations are billed too.
    const used = { inputTokens: 0, outputTokens: 0, imageInputTokens: 0, calls: 0 };
    const gen = async (args) => {
      attempts += 1;
      const res = await getProv(providerKey).generateImage(args);
      if (res?.usage) {
        used.inputTokens += res.usage.inputTokens || 0;
        used.outputTokens += res.usage.outputTokens || 0;
        used.imageInputTokens += res.usage.imageInputTokens || 0;
        used.calls += 1;
      }
      return res;
    };
    try {
      let { b64, mimeType } = await gen({ prompt: withRules(), size, quality, referenceImages, inputFidelity });
      // Models sometimes return a creative with a solid black band along one edge
      // (letterbox/pillarbox). Detect it and retry rather than show a half-empty
      // image; if the retries keep failing, keep the last result (never block).
      for (let attempt = 1; qa.blackBars.enabled && attempt <= qa.blackBars.retries; attempt++) {
        let check;
        try { check = await detectBlackBars(b64); } catch { break; }
        if (!check.hasBars) break;
        console.warn(`[ai:image] black band detected (${JSON.stringify(check.bars)}), retry ${attempt}/${qa.blackBars.retries}`);
        log.retry(`black band detected on the result - regenerating (${attempt}/${qa.blackBars.retries})`);
        try {
          ({ b64, mimeType } = await gen({ prompt: withRules(ruleText('imageFullCanvasRetry')), size, quality, referenceImages, inputFidelity }));
        } catch (retryErr) {
          console.warn('[ai:image] retry after black band failed, keeping previous result:', retryErr.message);
          break;
        }
      }
      // COLOUR INTEGRITY: no black-and-white design is ever accepted (unless every supplied reference is itself
      // achromatic). Retry with a strict colour instruction; if it still comes back greyscale, fail this provider
      // (next provider -> otherwise a readable error) rather than let a B&W creative through. See utils/colourGuard.js.
      for (let colourTry = 0; qa.colour.enabled; colourTry++) {
        let mono = false;
        try { mono = await isMonochromeOutput(b64, referenceImages); } catch { mono = false; }
        if (!mono) break;
        if (colourTry >= qa.colour.retries) throw new Error('The AI returned a black-and-white image, which is not allowed. Please try again.');
        console.warn(`[ai:image] black-and-white result rejected, retry ${colourTry + 1}/${qa.colour.retries}`);
        log.retry(`black-and-white result rejected - regenerating in full colour (${colourTry + 1}/${qa.colour.retries})`);
        ({ b64, mimeType } = await gen({ prompt: withRules(ruleText('imageColourRetry')), size, quality, referenceImages, inputFidelity }));
      }
      log.done(purpose || 'image ready');
      recordCallTrace({
        type: 'image', provider: providerKey, model: getProv(providerKey).imageModelName?.() || '', purpose: purpose || '',
        prompt: withRules(), // exactly what the model was asked (shown to agency admins in AI usage)
        size: [size, quality].filter(Boolean).join(' · ') || '', quality: quality || '', referenceImages: referenceImages.length, referenceFiles: describeReferenceFiles(referenceImages),
        attempts, durationMs: Date.now() - t0,
        // Real token counts whenever every attempt reported usage; OpenAI also gets its exact token-priced cost.
        // Seedream is billed a flat price per image (the rate card is exact); anything else is a flat estimate.
        costBasis: providerKey === 'seedream' ? 'rate-card' : 'flat-estimate',
        ...(used.calls > 0 && used.calls === attempts
          ? {
              inputTokens: used.inputTokens, outputTokens: used.outputTokens, imageInputTokens: used.imageInputTokens, tokensEstimated: false,
              ...(providerKey === 'openai' ? { actualCostUsd: openaiImageCostFromUsage(used), costBasis: 'provider-tokens' } : {}),
              ...(providerKey === 'gemini' && geminiImageCostFromUsage(getProv(providerKey).imageModelName?.(), used) !== null
                ? { actualCostUsd: geminiImageCostFromUsage(getProv(providerKey).imageModelName?.(), used), costBasis: 'provider-tokens' }
                : {})
            }
          : {})
      });
      return { b64, mimeType, modelUsed: providerKey, placeholder: false };
    } catch (err) {
      log.fail(err, configured.length > 1 ? 'trying next provider' : undefined);
      lastError = annotateIfBillingError(err, providerKey);
      console.warn(`[ai:image] ${providerKey} failed, trying next provider:`, err.message);
    }
  }
  // Image generation is expensive / optional - degrade gracefully rather than
  // blocking the whole workflow, but surface exactly why so it's never a
  // silent mystery to the person using the app. If the failure was a
  // billing/quota issue, carry that through so the client can offer a
  // direct "add credits" link instead of just a dead end.
  console.warn('[ai:image] all providers failed, falling back to placeholder:', lastError?.message);
  return {
    placeholder: true,
    modelUsed: 'placeholder',
    note: lastError?.message ? `Image generation failed: ${lastError.message}` : 'Image generation failed for an unknown reason.',
    isBillingError: Boolean(lastError?.isBillingError),
    billingUrl: lastError?.billingUrl || null,
    billingProviderLabel: lastError?.billingProviderLabel || null
  };
}

export function providerStatus() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([key, provider]) => [key, provider.isConfigured()])
  );
}

/**
 * Vision analysis (used for brand asset analysis). Tries providers in
 * priority order (all three support vision on their current default
 * models), same graceful-degradation shape as generateText/generateImage:
 * never throws just because nothing's configured, so callers can treat
 * "no AI available" as a normal, expected outcome rather than an error.
 */
export async function analyzeImage({ model = 'auto', base64, mimeType, instruction, maxTokens, detail, purpose }) {
  // Trust the bytes over the declared type (a JPEG named .png makes Anthropic return a 400).
  mimeType = sniffImageMime(base64, mimeType);
  let explicit = resolveName(model);
  let candidates;
  if (explicit) candidates = [explicit];
  else {
    candidates = priorityList('AI_VISION_PRIORITY', ['anthropic', 'openai', 'gemini']);
    // Admin -> AI Settings -> "Default vision model": a pinned model goes first, the others still back it up.
    try {
      const pinned = ALIASES[String((await getSettings()).visionModel || 'auto').toLowerCase()];
      if (pinned) candidates = [pinned, ...candidates.filter((c) => c !== pinned)];
    } catch { /* settings unavailable: keep the env priority */ }
  }

  const configured = candidates.filter(
    (c) => PROVIDERS[c].isConfigured() && (!PROVIDERS[c].ANALYZABLE_MIME_TYPES || PROVIDERS[c].ANALYZABLE_MIME_TYPES.has(mimeType))
  );
  if (configured.length === 0) {
    aiLog('vision', 'fail', { msg: `${purpose || 'image analysis'}: no provider can analyze ${mimeType} files` });
    return { text: null, modelUsed: 'none', note: `No configured AI provider supports analyzing ${mimeType} files.` };
  }

  let lastError;
  for (const providerKey of configured) {
    const log = aiLogTimer('vision', { provider: PROVIDER_LABELS[providerKey], model: (PROVIDERS[providerKey].visionModelName || PROVIDERS[providerKey].textModelName)?.(), msg: purpose || 'analysing image', extra: `${mimeType} · ${Math.round((base64?.length || 0) * 0.75 / 1024)}KB` });
    try {
      const text = await PROVIDERS[providerKey].analyzeImage({ base64, mimeType, instruction, maxTokens, detail });
      log.done(purpose || 'analysis ready', `${String(text || '').length} chars out`);
      return { text, modelUsed: providerKey };
    } catch (err) {
      log.fail(err, configured.length > 1 ? 'trying next provider' : undefined);
      lastError = annotateIfBillingError(err, providerKey);
      console.warn(`[ai:vision] ${providerKey} failed, trying next provider:`, err.message);
    }
  }
  return {
    text: null,
    modelUsed: 'none',
    note: lastError?.message || 'All configured vision providers failed.',
    isBillingError: Boolean(lastError?.isBillingError),
    billingUrl: lastError?.billingUrl || null,
    billingProviderLabel: lastError?.billingProviderLabel || null
  };
}

function placeholderCaption(prompt) {
  const trimmed = (prompt || '').replace(/\s+/g, ' ').slice(0, 90);
  return `[Draft copy - configure an AI provider for real generation] ${trimmed}`;
}

const PROVIDER_LABELS = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google', seedream: 'Seedream' };

/**
 * The exact model IDs that will be used for a workspace selection: kind is
 * 'text' | 'image'. A pinned model gives one entry; "auto" gives every
 * configured provider in the order they are tried (first = used first).
 */
export function describeActiveModels(kind, selection = 'auto') {
  const explicit = resolveName(selection);
  const candidates = explicit
    ? [explicit]
    : kind === 'image'
      ? priorityList('AI_IMAGE_PRIORITY', ['openai', 'gemini', 'seedream'])
      : kind === 'vision'
        ? priorityList('AI_VISION_PRIORITY', ['anthropic', 'openai', 'gemini'])
        : priorityList('AI_TEXT_PRIORITY', ['openai', 'anthropic', 'gemini']);
  const fnName = kind === 'image' ? 'imageModelName' : kind === 'vision' ? 'visionModelName' : 'textModelName';
  return candidates
    .filter((c) => typeof PROVIDERS[c]?.[fnName] === 'function')
    .map((c) => ({ provider: PROVIDER_LABELS[c] || c, model: PROVIDERS[c][fnName](), configured: Boolean(PROVIDERS[c].isConfigured()) }));
}
