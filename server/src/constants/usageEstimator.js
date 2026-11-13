// Shared definitions for the Admin -> Usage Estimator: the choices an admin can
// pick from, the default (ballpark) price tables, and the per-step TEXT TOKEN
// PROFILE of each workflow.
//
// IMPORTANT - what is real and what is approximate:
//  * Prices: real once an admin runs "Fetch current pricing" and saves; until
//    then they are the static ballparks from constants/aiPricing.js.
//  * Token profile: hand-estimated from the prompts / maxTokens in the services
//    named on each step (the app does not log token counts yet). Adjust here if
//    a prompt grows. Vision steps include a rough allowance for the image tokens.

import { IMAGE_PRICING_USD, TEXT_PRICING_USD_PER_1K, VIDEO_PRICING_USD_PER_SECOND, veoRatePerSecondFromEnv } from './aiPricing.js';

// Rupees per US dollar used to show INR figures. Seed value only (an aggregator
// quote, 16 Oct 2026) - the admin page can fetch/edit the live rate and saves it.
export const DEFAULT_USD_TO_INR = 94.5;

export const IMAGE_PROVIDERS = ['openai', 'gemini', 'seedream'];
export const TEXT_PROVIDERS = ['openai', 'anthropic', 'gemini'];
export const VIDEO_PROVIDERS = ['veo', 'kling', 'runway', 'seedance'];

export const PROVIDER_LABELS = {
  openai: 'OpenAI (GPT)',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
  seedream: 'ByteDance (Seedream)',
  veo: 'Google (Veo)',
  kling: 'Kling',
  runway: 'Runway',
  seedance: 'ByteDance (Seedance)'
};

export const IMAGE_RESOLUTIONS = [
  { id: '1K', label: '1K (about 1024 px)' },
  { id: '2K', label: '2K (about 2048 px)' },
  { id: '4K', label: '4K (about 4096 px)' }
];

// Clip lengths offered to the admin. Providers snap to their own supported
// lengths (see effectiveVideoSeconds in costEstimateService.js), and the
// estimate is billed on the snapped length.
export const VIDEO_LENGTH_PRESETS = [5, 8, 10];

export const WORKFLOWS = [
  { id: 'new', label: 'New Creative', hint: 'Full wizard: Look & Feel and Message suggestions, then copy for every image.' },
  { id: 'adaptation', label: 'Creative Adaptation', hint: 'Template analysis (3 vision calls) and headline variations, then copy for every image.' }
];

export const DEFAULT_ASSUMPTIONS = {
  // A brief produces this many images (3 style options per chosen direction).
  imagesPerBrief: 3,
  // Extra spend for regenerations / automatic retries (black-band and
  // black-and-white rejections in router.js). 0 = none assumed.
  retryBufferPct: 0,
  // Pictures sent along WITH each image generation, so the model can copy a product / style / the brand mark.
  // Each one is an input image the provider bills (see REFERENCE_IMAGE_COST). 1 + 1 is the usual brief.
  referenceAssets: 1,
  logos: 1
};

// What one input (reference or logo) picture adds to ONE image generation, per provider.
//  openai   - billed per image TOKEN on the way in: a ~1024px picture is roughly 1,100 tokens at the flare model's
//             image-input rate (OPENAI_IMAGE_TOKEN_PRICING_USD_PER_1M.imageInput). With high input fidelity it can be
//             several times more - this is the normal-fidelity figure. APPROXIMATE (token count not confirmed).
//  gemini   - input tokens are very cheap next to the image output; ~1,300 tokens at roughly $0.5 per 1M. APPROXIMATE.
//  seedream - flat price per output image; reference pictures add no separate charge.
export const REFERENCE_IMAGE_COST = {
  openai: { tokens: 1100, usdPer1M: 8 },
  gemini: { tokens: 1300, usdPer1M: 0.5 },
  seedream: { tokens: 0, usdPer1M: 0 }
};
/** USD one reference / logo picture adds to one image generation for this provider. */
export function referenceImageUsd(provider) {
  const r = REFERENCE_IMAGE_COST[provider];
  return r ? (r.tokens * r.usdPer1M) / 1e6 : 0;
}

/**
 * Text steps per workflow.
 *  scope:  'brief' (once per brief), 'image' (once per generated image), 'video' (once per video)
 *  kind:   which provider's text rates apply -
 *            'copy'     -> the admin's default copy model
 *            'vision'   -> AI_VISION_PRIORITY (first configured)
 *            'template' -> TEMPLATE_ANALYSIS_MODEL (default GPT)
 *  calls:  API calls per scope unit; input/output are tokens per call.
 */
const COMMON_IMAGE_STEPS = [
  { id: 'caption', label: 'Caption', scope: 'image', kind: 'copy', calls: 1, input: 350, output: 120, source: 'captionService.generateCaption (max 200 out)' },
  { id: 'headline', label: 'Headline', scope: 'image', kind: 'copy', calls: 1, input: 200, output: 30, source: 'captionService headline (max 40 out)' }
];

const VIDEO_STEPS = [
  { id: 'video_ideas', label: 'Animation ideas', scope: 'video', kind: 'vision', calls: 1, input: 1800, output: 1500, source: 'videoIdeasService (max 5000 out)' },
  { id: 'video_prompt', label: 'Detailed video prompt', scope: 'video', kind: 'vision', calls: 1, input: 1500, output: 400, source: 'videoIdeasService (max 1400 out)' }
];

export const WORKFLOW_TEXT_STEPS = {
  new: [
    { id: 'look_feel', label: 'Look & Feel suggestion', scope: 'brief', kind: 'copy', calls: 1, input: 450, output: 200, source: 'lookAndFeelService (max 400 out)' },
    { id: 'message', label: 'Message suggestion', scope: 'brief', kind: 'copy', calls: 1, input: 450, output: 150, source: 'messageSuggestionService (max 300 out)' },
    ...COMMON_IMAGE_STEPS,
    ...VIDEO_STEPS
  ],
  adaptation: [
    { id: 'template_analysis', label: 'Template analysis (vision)', scope: 'brief', kind: 'template', calls: 3, input: 2600, output: 800, source: 'templateAnalysisService (3 vision calls)' },
    { id: 'headline_variations', label: 'Headline variations', scope: 'brief', kind: 'copy', calls: 1, input: 500, output: 250, source: 'captionService headline variations (max 350 out)' },
    ...COMMON_IMAGE_STEPS,
    ...VIDEO_STEPS
  ]
};

/** Fresh default pricing (ballparks) in the stored shape. */
export function defaultPricing() {
  const image = {};
  for (const p of IMAGE_PROVIDERS) {
    const t = IMAGE_PRICING_USD[p];
    // Static table only has two tiers. Until prices are fetched, 1K = standard,
    // 2K and 4K = high (so 4K is likely UNDER-stated until a fetch).
    image[p] = { '1K': t.standard, '2K': t.high, '4K': t.high };
  }
  const text = {};
  for (const p of TEXT_PROVIDERS) {
    const t = TEXT_PRICING_USD_PER_1K[p];
    text[p] = { input: round(t.input * 1000), output: round(t.output * 1000) };
  }
  const video = {};
  for (const p of VIDEO_PROVIDERS) video[p] = { perSecond: p === 'veo' ? veoRatePerSecondFromEnv() : VIDEO_PRICING_USD_PER_SECOND[p] };
  return { image, text, video };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
