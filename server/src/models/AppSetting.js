import mongoose from 'mongoose';

// Providers capable of *live* news (i.e. real web search, not a speculative
// AI-generated blurb). Today that's just Anthropic; more can be added to
// this list as their news-fetching implementation lands in
// services/ai/newsSearch.js.
export const LIVE_NEWS_PROVIDERS = ['anthropic'];

// Every provider selectable in the admin panel, including ones that fall
// back to the older speculative-blurb behavior (see industryData.js).
export const NEWS_PROVIDERS = ['anthropic', 'openai', 'gemini'];

// Which model generates post copy by default when a user doesn't override
// it - "auto" lets the router pick whatever's configured/best, or an admin
// can pin it to a specific provider for the whole workspace.
export const COPY_MODELS = ['auto', 'gpt', 'claude', 'gemini'];

// Which model looks at images (animation ideas, brand / reference / template analysis). "auto" follows
// AI_VISION_PRIORITY; a pinned model is tried first and the others still back it up if it fails.
export const VISION_MODELS = ['auto', 'gpt', 'claude', 'gemini'];

// Same idea for image generation. Claude/Anthropic has no image API so it's
// deliberately excluded here (the router would just error on it).
export const IMAGE_MODELS = ['auto', 'gpt', 'gemini', 'seedream'];

// Same idea again for video generation. Veo rides on the same GEMINI_API_KEY
// as Gemini text/image, so it's labeled "gemini" here too for consistency
// with the other pickers - kling, runway, and seedance are separate
// keys/providers (seedance shares Seedream's Ark account/key by default,
// see providers/seedance.js, but is still its own selectable option here
// since it's a distinct model/capability from the image side).
export const VIDEO_MODELS = ['auto', 'gemini', 'kling', 'runway', 'seedance'];

// Every provider the router knows about, and what it can actually do -
// drives the capability matrix on the admin AI Settings page so admins can
// see at a glance why e.g. Claude never shows up as an image-model option.
// Kling/Runway/Seedance are video-only providers with no text/image/vision
// API, so they're listed here purely for the "video" column.
export const PROVIDER_CAPABILITIES = {
  openai: { text: true, image: true, vision: true, video: false, label: 'OpenAI (GPT)' },
  anthropic: { text: true, image: false, vision: true, video: false, label: 'Anthropic (Claude)' },
  gemini: { text: true, image: true, vision: true, video: true, label: 'Google (Gemini / Veo)' },
  seedream: { text: false, image: true, vision: false, video: false, label: 'ByteDance (Seedream)' },
  kling: { text: false, image: false, vision: false, video: true, label: 'Kling' },
  runway: { text: false, image: false, vision: false, video: true, label: 'Runway' },
  seedance: { text: false, image: false, vision: false, video: true, label: 'ByteDance (Seedance)' }
};

const appSettingSchema = new mongoose.Schema(
  {
    // Fixed key so there's always exactly one settings document ("singleton").
    key: { type: String, required: true, unique: true, default: 'global' },
    newsProvider: { type: String, enum: NEWS_PROVIDERS, default: 'anthropic' },
    copyModel: { type: String, enum: COPY_MODELS, default: 'auto' },
    imageModel: { type: String, enum: IMAGE_MODELS, default: 'auto' },
    visionModel: { type: String, enum: VISION_MODELS, default: 'auto' },
    videoModel: { type: String, enum: VIDEO_MODELS, default: 'auto' },
    // When true, every cost-estimate figure (image/text/video "~$0.0X" tags
    // shown before a generation button) is hidden workspace-wide - the
    // generation itself is unaffected, this only controls whether the
    // dollar figure is shown to whoever's using the app.
    hideCosts: { type: Boolean, default: false },
    // Blanket instructions edited by the super admin (see constants/blanketRules.js): { [key]: { enabled?, text? } }.
    blanketRules: { type: Object, default: {} },
    // One-off startup migrations already applied (see services/tenantMigration.js).
    migrations: { type: Object, default: {} }
  },
  { timestamps: true }
);

export default mongoose.model('AppSetting', appSettingSchema);
