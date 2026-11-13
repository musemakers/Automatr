import { IMAGE_PRICING_USD, TEXT_PRICING_USD_PER_1K, VIDEO_PRICING_USD_PER_SECOND, veoRatePerSecondFromEnv, veoRateFor, seedanceRatePer1M, seedanceEstimatedTokens } from '../constants/aiPricing.js';
import { getSavedPricingSync } from './pricingService.js';

// If an admin has saved real prices (Admin -> Usage Estimator), they win over the
// static ballparks in constants/aiPricing.js. Until then nothing here changes.
// The two legacy quality tiers map onto the estimator's resolutions:
// 'standard' -> 1K, 'high' -> 2K.
function savedImagePrice(providerKey, qualityTier) {
  const v = getSavedPricingSync()?.image?.[providerKey]?.[qualityTier === 'standard' ? '1K' : '2K'];
  return typeof v === 'number' ? v : null;
}
function textRatesPer1K(providerKey) {
  const saved = getSavedPricingSync()?.text?.[providerKey];
  if (saved && typeof saved.input === 'number' && typeof saved.output === 'number') {
    return { input: saved.input / 1000, output: saved.output / 1000 };
  }
  return TEXT_PRICING_USD_PER_1K[providerKey] || TEXT_PRICING_USD_PER_1K.openai;
}
// Veo's rate follows the configured model name (VEO_MODEL) and resolution (VEO_RESOLUTION), e.g.
// veo-3.1-lite-generate-preview -> Lite, veo-3.1-fast-generate-preview -> Fast, anything else -> Standard.
function veoRatePerSecond() {
  return veoRatePerSecondFromEnv();
}
function videoRatePerSecond(providerKey) {
  const v = getSavedPricingSync()?.video?.[providerKey]?.perSecond;
  if (typeof v === 'number') return v;
  if (providerKey === 'veo') return veoRatePerSecond();
  return VIDEO_PRICING_USD_PER_SECOND[providerKey] ?? VIDEO_PRICING_USD_PER_SECOND.veo;
}

// Maps the short model ids used in AppSetting.copyModel/imageModel (and the
// buttons in the UI) to the provider keys the pricing tables are keyed by.
const IMAGE_PROVIDER_BY_MODEL = { gpt: 'openai', gemini: 'gemini', seedream: 'seedream' };
const TEXT_PROVIDER_BY_MODEL = { gpt: 'openai', claude: 'anthropic', gemini: 'gemini' };

export function estimateImageCostUsd(model, qualityTier = 'high') {
  const providerKey = IMAGE_PROVIDER_BY_MODEL[model] || 'openai';
  const saved = savedImagePrice(providerKey, qualityTier);
  if (saved !== null) return saved;
  const table = IMAGE_PRICING_USD[providerKey] || IMAGE_PRICING_USD.openai;
  return table[qualityTier === 'standard' ? 'standard' : 'high'];
}

/** @param {{inputTokens: number, outputTokens: number}} tokens - rough expected sizes for the specific task being estimated */
export function estimateTextCostUsd(model, { inputTokens, outputTokens }) {
  const providerKey = TEXT_PROVIDER_BY_MODEL[model] || 'openai';
  const rates = textRatesPer1K(providerKey);
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

/**
 * Cost of ONE video job from what was actually requested (exact model id, resolution, billed seconds) - used at submit time.
 * Veo uses its per-model / per-resolution rate card; Seedance is token-billed (this is the up-front estimate, replaced by the
 * real usage.completion_tokens when the job finishes); Kling / Runway use their per-second rate (admin-saved price wins).
 * @returns {{costUsd:number, rateUsd:number, basis:'rate-card'|'tokens-estimated'}}
 */
export function priceVideoJob(providerKey, { model, resolution, seconds }) {
  const secs = Number(seconds) || 0;
  if (providerKey === 'veo') {
    const rate = veoRateFor(model, resolution);
    return { costUsd: rate * secs, rateUsd: rate, basis: 'rate-card' };
  }
  if (providerKey === 'seedance') {
    const cost = (seedanceEstimatedTokens(secs, resolution) * seedanceRatePer1M(model)) / 1e6;
    return { costUsd: cost, rateUsd: secs ? cost / secs : 0, basis: 'tokens-estimated' };
  }
  const rate = videoRatePerSecond(providerKey);
  return { costUsd: rate * secs, rateUsd: rate, basis: 'rate-card' };
}

export function estimateVideoCostUsd(model = 'veo', seconds = 6) {
  const rate = videoRatePerSecond(model);
  return rate * seconds;
}

// --- Provider-keyed variants, used for logging actual usage after a call
// completes (router.js knows which literal provider - 'openai', 'gemini',
// etc. - actually served the request, not the short model id like 'gpt'
// used elsewhere for pre-generation estimates and admin settings). ---

export function estimateImageCostUsdByProvider(providerKey, qualityTier = 'high') {
  const saved = savedImagePrice(providerKey, qualityTier);
  if (saved !== null) return saved;
  const table = IMAGE_PRICING_USD[providerKey] || IMAGE_PRICING_USD.openai;
  return table[qualityTier === 'standard' ? 'standard' : 'high'];
}

/** @param {{inputTokens: number, outputTokens: number}} tokens */
export function estimateTextCostUsdByProvider(providerKey, { inputTokens, outputTokens }) {
  const rates = textRatesPer1K(providerKey);
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

/**
 * The duration each video provider will actually render, given the
 * requested one. Mirrors the snapping each provider module does in its own
 * submitJob (Kling/Runway/Seedance only accept 5s or 10s; Veo takes the
 * rounded value). Keep in sync with providers/*.js.
 */
export function effectiveVideoSeconds(providerKey, requestedSeconds) {
  const req = Number(requestedSeconds);
  switch (providerKey) {
    case 'kling':
      return req > 5 ? 10 : 5;
    case 'runway':
    case 'seedance':
      return req > 7 ? 10 : 5;
    case 'veo': {
      // Gemini Omni renders 3-10 s (VEO_MIN_SECONDS / VEO_MAX_SECONDS) - mirrors providers/veo.js snapDuration().
      const min = Number(process.env.VEO_MIN_SECONDS) || 3;
      const max = Number(process.env.VEO_MAX_SECONDS) || 10;
      if (!req) return 6;
      return Math.min(max, Math.max(min, Math.round(req)));
    }
    default:
      return req > 0 ? Math.round(req) : 6;
  }
}

/** Provider-keyed video cost estimate for logging after a job is submitted. */
export function estimateVideoCostUsdByProvider(providerKey, seconds) {
  const rate = videoRatePerSecond(providerKey);
  return rate * seconds;
}
