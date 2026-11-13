import { getSettings } from './appSettingsService.js';
import { getPricing } from './pricingService.js';
import { effectiveVideoSeconds } from './costEstimateService.js';
import { providerStatus, describeActiveModels } from './ai/router.js';
import { providerStatus as videoProviderStatus, describeActiveVideoModels } from './ai/videoRouter.js';
import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  VIDEO_PROVIDERS,
  IMAGE_RESOLUTIONS,
  VIDEO_LENGTH_PRESETS,
  WORKFLOWS,
  WORKFLOW_TEXT_STEPS,
  DEFAULT_ASSUMPTIONS,
  PROVIDER_LABELS,
  referenceImageUsd
} from '../constants/usageEstimator.js';

const MAX_IMAGES = 5000;
const MAX_VIDEOS = 1000;

// Short model ids used in AppSetting -> provider keys (same maps as costEstimateService / the admin controller).
const COPY_BY_MODEL = { gpt: 'openai', claude: 'anthropic', gemini: 'gemini' };
const IMAGE_BY_MODEL = { gpt: 'openai', gemini: 'gemini', seedream: 'seedream' };
const VIDEO_BY_MODEL = { gemini: 'veo', kling: 'kling', runway: 'runway', seedance: 'seedance' };
const ENV_ALIASES = {
  gpt: 'openai', openai: 'openai', chatgpt: 'openai',
  claude: 'anthropic', anthropic: 'anthropic',
  gemini: 'gemini', google: 'gemini',
  seedream: 'seedream', bytedance: 'seedream',
  veo: 'veo', kling: 'kling', runway: 'runway', runwayml: 'runway', seedance: 'seedance'
};

function envList(envVar, fallback) {
  const raw = process.env[envVar];
  return (raw ? raw.split(',') : fallback).map((s) => ENV_ALIASES[s.trim().toLowerCase()]).filter(Boolean);
}

function firstConfigured(list, status, fallback) {
  return list.find((p) => status[p]) || fallback;
}

/** The provider each kind of work will actually be served by right now (mirrors the routers' own selection). */
export async function resolveActiveProviders() {
  const settings = await getSettings();
  const textStatus = providerStatus();
  const videoStatus = videoProviderStatus();

  const copy = COPY_BY_MODEL[settings.copyModel] || firstConfigured(envList('AI_TEXT_PRIORITY', ['openai', 'anthropic', 'gemini']), textStatus, 'openai');
  const image = IMAGE_BY_MODEL[settings.imageModel] || firstConfigured(envList('AI_IMAGE_PRIORITY', ['openai', 'gemini', 'seedream']), textStatus, 'openai');
  const video = VIDEO_BY_MODEL[settings.videoModel] || firstConfigured(envList('AI_VIDEO_PRIORITY', ['veo', 'kling', 'runway', 'seedance']), videoStatus, 'veo');
  const vision = firstConfigured(envList('AI_VISION_PRIORITY', ['anthropic', 'openai', 'gemini']), textStatus, 'anthropic');
  const template = ENV_ALIASES[String(process.env.TEMPLATE_ANALYSIS_MODEL || 'gpt').toLowerCase()] || firstConfigured(envList('AI_VISION_PRIORITY', ['anthropic', 'openai', 'gemini']), textStatus, 'openai');
  return { copy, vision, template, image, video };
}

/** Exact model id configured for a provider ('' if unknown). */
export function modelIdFor(kind, providerKey) {
  try {
    if (kind === 'video') return describeActiveVideoModels(providerKey)[0]?.model || '';
    return describeActiveModels(kind, providerKey)[0]?.model || '';
  } catch {
    return '';
  }
}

/** Every provider currently configured, per kind - used for the what-if selectors and the "price all models" fetch. */
export function configuredProviders() {
  const text = providerStatus();
  const video = videoProviderStatus();
  return {
    text: TEXT_PROVIDERS.filter((p) => text[p]),
    image: IMAGE_PROVIDERS.filter((p) => text[p]),
    video: VIDEO_PROVIDERS.filter((p) => video[p])
  };
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The static options the page needs to render its controls. */
export async function getEstimatorConfig() {
  const [active, { pricing, meta, fx }] = await Promise.all([resolveActiveProviders(), getPricing()]);
  const configured = configuredProviders();
  return {
    limits: { maxImages: MAX_IMAGES, maxVideos: MAX_VIDEOS },
    resolutions: IMAGE_RESOLUTIONS,
    videoLengths: VIDEO_LENGTH_PRESETS,
    workflows: WORKFLOWS,
    defaults: { images: 20, resolution: '2K', videos: 2, videoSeconds: 5, workflow: 'new', ...DEFAULT_ASSUMPTIONS },
    active: {
      copy: { provider: active.copy, label: PROVIDER_LABELS[active.copy], model: modelIdFor('text', active.copy) },
      vision: { provider: active.vision, label: PROVIDER_LABELS[active.vision], model: modelIdFor('text', active.vision) },
      template: { provider: active.template, label: PROVIDER_LABELS[active.template], model: modelIdFor('text', active.template) },
      image: { provider: active.image, label: PROVIDER_LABELS[active.image], model: modelIdFor('image', active.image) },
      video: { provider: active.video, label: PROVIDER_LABELS[active.video], model: modelIdFor('video', active.video) }
    },
    configured: Object.fromEntries(
      Object.entries(configured).map(([k, list]) => [k, list.map((p) => ({ id: p, label: PROVIDER_LABELS[p], model: modelIdFor(k === 'text' ? 'text' : k, p) }))])
    ),
    pricing,
    pricingMeta: meta,
    fx
  };
}

/**
 * The cost estimate. Pure arithmetic over the saved/default rates - no AI call,
 * so it's instant and can run on every slider move.
 *
 * @param {{images?:number, resolution?:string, videos?:number, videoSeconds?:number, workflow?:string,
 *          imagesPerBrief?:number, retryBufferPct?:number, imageProvider?:string, videoProvider?:string, copyProvider?:string}} input
 */
export async function estimateUsage(input = {}) {
  const [active, { pricing, meta, fx }] = await Promise.all([resolveActiveProviders(), getPricing()]);

  const images = clampInt(input.images, 0, MAX_IMAGES, 0);
  const videos = clampInt(input.videos, 0, MAX_VIDEOS, 0);
  const resolution = IMAGE_RESOLUTIONS.some((r) => r.id === input.resolution) ? input.resolution : '2K';
  const videoSeconds = VIDEO_LENGTH_PRESETS.includes(Number(input.videoSeconds)) ? Number(input.videoSeconds) : VIDEO_LENGTH_PRESETS[0];
  const workflow = WORKFLOW_TEXT_STEPS[input.workflow] ? input.workflow : 'new';
  const imagesPerBrief = clampInt(input.imagesPerBrief, 1, 100, DEFAULT_ASSUMPTIONS.imagesPerBrief);
  const retryBufferPct = clampInt(input.retryBufferPct, 0, 200, DEFAULT_ASSUMPTIONS.retryBufferPct);
  const retryFactor = 1 + retryBufferPct / 100;
  const referenceAssets = clampInt(input.referenceAssets, 0, 10, DEFAULT_ASSUMPTIONS.referenceAssets);
  const logos = clampInt(input.logos, 0, 10, DEFAULT_ASSUMPTIONS.logos);

  // Optional what-if overrides; only accepted for providers that exist for that kind.
  const imageProvider = IMAGE_PROVIDERS.includes(input.imageProvider) ? input.imageProvider : active.image;
  const videoProvider = VIDEO_PROVIDERS.includes(input.videoProvider) ? input.videoProvider : active.video;
  const copyProvider = TEXT_PROVIDERS.includes(input.copyProvider) ? input.copyProvider : active.copy;
  const providers = { ...active, image: imageProvider, video: videoProvider, copy: copyProvider };

  // --- images ---
  const imageUnit = pricing.image[imageProvider][resolution];
  // Reference + logo pictures sent with every generation are billed as input on top of the image itself.
  const refUnit = (referenceAssets + logos) * referenceImageUsd(imageProvider);
  const imageTotal = images * imageUnit * retryFactor;
  const referenceTotal = images * refUnit * retryFactor;

  // --- video ---
  const billedSeconds = effectiveVideoSeconds(videoProvider, videoSeconds);
  const videoUnit = pricing.video[videoProvider].perSecond * billedSeconds;
  const videoTotal = videos * videoUnit * retryFactor;

  // --- text (from the workflow's step profile) ---
  const briefs = images > 0 ? Math.ceil(images / imagesPerBrief) : videos > 0 ? videos : 0;
  const unitsFor = { brief: briefs, image: images, video: videos };
  const lines = WORKFLOW_TEXT_STEPS[workflow].map((step) => {
    const provider = providers[step.kind];
    const rate = pricing.text[provider];
    const units = unitsFor[step.scope];
    const calls = units * step.calls;
    const inputTokens = calls * step.input;
    const outputTokens = calls * step.output;
    const usd = (inputTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output;
    return {
      id: step.id,
      label: step.label,
      scope: step.scope,
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      model: modelIdFor('text', provider),
      calls,
      tokensPerCall: { input: step.input, output: step.output },
      inputTokens,
      outputTokens,
      usd
    };
  });
  const textTotal = lines.reduce((s, l) => s + l.usd, 0);

  const total = imageTotal + referenceTotal + videoTotal + textTotal;
  return {
    inputs: { images, resolution, videos, videoSeconds, workflow, imagesPerBrief, retryBufferPct, referenceAssets, logos },
    providers: Object.fromEntries(
      Object.entries(providers).map(([k, p]) => [k, { provider: p, label: PROVIDER_LABELS[p], model: modelIdFor(k === 'image' ? 'image' : k === 'video' ? 'video' : 'text', p) }])
    ),
    image: { count: images, resolution, unitUsd: imageUnit, totalUsd: imageTotal },
    references: { referenceAssets, logos, perPictureUsd: referenceImageUsd(imageProvider), unitUsd: refUnit, totalUsd: referenceTotal },
    video: { count: videos, requestedSeconds: videoSeconds, billedSeconds, perSecondUsd: pricing.video[videoProvider].perSecond, unitUsd: videoUnit, totalUsd: videoTotal },
    text: { briefs, lines, totalUsd: textTotal, totalInputTokens: lines.reduce((s, l) => s + l.inputTokens, 0), totalOutputTokens: lines.reduce((s, l) => s + l.outputTokens, 0) },
    totalUsd: total,
    fx,
    pricingSource: meta.source,
    pricingFetchedAt: meta.fetchedAt
  };
}
