// Rough, publicly-known provider pricing used to show a "this will cost
// about $X" estimate next to buttons that trigger an AI request, so a user
// isn't clicking blind. These are NOT wired to any real billing/metering -
// they're static approximations that will drift from actual provider
// pricing over time. Treat every number here as a ballpark, re-check
// against each provider's current pricing page periodically, and never
// present these as an exact charge anywhere in the UI.
//
// Last refreshed against public pricing pages/aggregators: July 2026.

// USD per image, by rough quality tier. "high" assumes the larger/premium
// tier each provider offers; "standard" assumes their fast/cheap tier.
export const IMAGE_PRICING_USD = {
  openai: { standard: 0.04, high: 0.17 }, // GPT Image 2 - Medium vs. High quality tier (1024x1024 reference)
  gemini: { standard: 0.02, high: 0.13 }, // standard: Imagen 4 Fast / base Nano Banana; high: Nano Banana Pro (Gemini 3 Pro Image) at 2K
  seedream: { standard: 0.035, high: 0.045 } // standard: Seedream 4.0; high: Seedream 4.5 (this app's default model) - official BytePlus rate
};

// USD per 1,000 tokens, input vs. output - current production-tier model
// for each provider (not their cheapest budget tier, not their priciest
// flagship), since that's the realistic middle ground for copy/suggestion
// generation in this app.
export const TEXT_PRICING_USD_PER_1K = {
  openai: { input: 0.0025, output: 0.015 }, // GPT-5.4 - recommended production workhorse
  anthropic: { input: 0.002, output: 0.01 }, // Claude Sonnet 5, current introductory rate (standard $3/$15 resumes Sep 1, 2026)
  gemini: { input: 0.0003, output: 0.0025 } // Gemini 2.5 Flash
};

// USD per second of generated video - Veo/Kling/Runway "standard" tiers.
export const VIDEO_PRICING_USD_PER_SECOND = {
  veo: 0.1, // Gemini Omni 1.1 Flash, 720p (provider key 'veo' kept for compatibility)
  kling: 0.1, // Kling 3.0
  runway: 0.15, // Runway Gen-4.5
  seedance: 0.022 // Seedance 1.0 Pro Fast, 720p - ROUGH (token-billed by BytePlus, ~108k tokens per 5s clip); verify against Ark console billing
};

// Veo is billed per second and the rate depends on WHICH Veo model VEO_MODEL points at (and the resolution).
// Gemini API paid tier, per second: Lite $0.05 (720p) / $0.08 (1080p), Fast $0.10 / $0.12, Standard $0.40 / $0.40.
// Rough: re-check https://ai.google.dev/gemini-api/docs/pricing - Lite is a preview model and may change.
export const VEO_PRICING_USD_PER_SECOND = {
  // Gemini Omni 1.1 Flash (gemini-omni-1.1-flash): token-billed by Google ($17.50 / 1M video output tokens), converted to $/sec.
  // DERIVED, not an official per-second table (720p ~ Google's "approx $0.10/sec"); 1080p/4k are upscaled. Re-check ai.google.dev pricing.
  omni: { '360p': 0.035, '720p': 0.1, '1080p': 0.15, '4k': 0.3 },
  lite: { '720p': 0.05, '1080p': 0.08 }, // veo-3.1-lite-generate-preview (4K not supported); re-confirmed 2026-10-21
  fast: { '720p': 0.1, '1080p': 0.12 },
  standard: { '720p': 0.4, '1080p': 0.4 }
};

/** Veo $/sec for an exact model id + resolution (lite / fast / anything else = standard). 4K is not offered. */
export function veoRateFor(model, resolution) {
  const m = String(model || 'gemini-omni-1.1-flash').toLowerCase();
  const tier = m.includes('omni') ? 'omni' : m.includes('lite') ? 'lite' : m.includes('fast') ? 'fast' : 'standard';
  const r = String(resolution || '720p').toLowerCase();
  const res = tier === 'omni' ? (['360p', '1080p', '4k'].includes(r) ? r : '720p') : r === '1080p' ? '1080p' : '720p';
  return VEO_PRICING_USD_PER_SECOND[tier][res];
}

/** The Veo rate for the model currently configured via VEO_MODEL / VEO_RESOLUTION (used by pre-generation estimates). */
export function veoRatePerSecondFromEnv() {
  return veoRateFor(process.env.VEO_MODEL, process.env.VEO_RESOLUTION);
}

// Seedance (BytePlus ModelArk) is billed per TOKEN, USD per 1M video tokens, online inference
// (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing, checked 2026-10-22).
// Real usage = usage.completion_tokens on the finished task. Only successfully generated videos are charged.
// 1.5 Pro costs double with generated audio; this app asks for silent video, so the no-audio rate applies
// unless SEEDANCE_AUDIO=true is set.
export function seedanceRatePer1M(model) {
  const m = String(model || '').toLowerCase();
  if (/seedance-1-5/.test(m)) return String(process.env.SEEDANCE_AUDIO || '').toLowerCase() === 'true' ? 2.4 : 1.2;
  if (/seedance-1-0-pro-fast/.test(m)) return 1.0;
  return 2.5; // seedance-1-0-pro (and any unknown id: the conservative, higher rate)
}
/** BytePlus's own formula: seconds x width x height x fps / 1024. Used only for the up-front estimate; 720p ~ 1280x720 at 24fps. */
export function seedanceEstimatedTokens(seconds, resolution = '720p') {
  const area = { '480p': 854 * 480, '720p': 1280 * 720, '1080p': 1920 * 1080 }[String(resolution).toLowerCase()] || 1280 * 720;
  return Math.round((Number(seconds) || 0) * area * 24 / 1024);
}

// OpenAI image models (gpt-image-2.5-flare / -sunburst) are billed per TOKEN, Standard processing, USD per 1M tokens
// (https://developers.openai.com/api/docs/pricing, checked 2026-10-22). Batch processing is half price but is not used here.
export const OPENAI_IMAGE_TOKEN_PRICING_USD_PER_1M = { textInput: 5, imageInput: 8, imageOutput: 30 };

/**
 * Exact cost of one OpenAI image call from the usage block the API returns (see providers/openai.js normalizeUsage).
 * Input tokens that are not tagged as image tokens are priced as text.
 * @param {{inputTokens:number, outputTokens:number, imageInputTokens?:number}} u
 */
export function openaiImageCostFromUsage(u) {
  const r = OPENAI_IMAGE_TOKEN_PRICING_USD_PER_1M;
  const imageIn = Math.min(u.imageInputTokens || 0, u.inputTokens || 0);
  const textIn = Math.max(0, (u.inputTokens || 0) - imageIn);
  return (textIn * r.textInput + imageIn * r.imageInput + (u.outputTokens || 0) * r.imageOutput) / 1e6;
}

// Gemini image models are billed per TOKEN, USD per 1M tokens, Standard paid tier
// (https://ai.google.dev/gemini-api/docs/pricing, checked 2026-10-22). Only models whose rates were confirmed are listed;
// any other model id returns null and the row keeps the flat per-image estimate instead of a guessed token price.
const GEMINI_IMAGE_TOKEN_PRICING_USD_PER_1M = [
  { match: /gemini-3\.1-flash-lite-image/i, input: 0.25, output: 30 },
  { match: /gemini-3\.1-flash-image/i, input: 0.5, output: 60 },
  { match: /gemini-nano-banana-2\.1/i, input: 1.5, output: 30 }
];
/** Exact cost of a Gemini image call from its usageMetadata, or null when this model's token price isn't known. */
export function geminiImageCostFromUsage(model, u) {
  const r = GEMINI_IMAGE_TOKEN_PRICING_USD_PER_1M.find((x) => x.match.test(String(model || '')));
  if (!r) return null;
  return ((u.inputTokens || 0) * r.input + (u.outputTokens || 0) * r.output) / 1e6;
}
