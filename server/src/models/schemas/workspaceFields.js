import mongoose from 'mongoose';

// Fields that used to live on each User and now belong to a Customer (the
// shared workspace): brand kit, competitor watch list, connected social
// accounts. Kept here so Customer.js stays readable and the redaction rules for
// OAuth tokens live in one place.

export const brandKitFields = {
  colors: { type: [String], default: ['#0F2A5C', '#2E5EFF', '#EEF3FF', '#0A0E17', '#FFFFFF'] },
  fonts: {
    display: { type: String, default: 'Space Grotesk' },
    body: { type: String, default: 'IBM Plex Sans' },
    suggestedDisplay: { type: String, default: '' },
    suggestedBody: { type: String, default: '' }
  },
  designLanguage: {
    colorRoles: {
      primary: { type: String, default: '' },
      secondary: { type: String, default: '' },
      accent: { type: String, default: '' },
      neutral: { type: String, default: '' }
    },
    logoType: { type: String, default: '' },
    typographyImpression: { type: String, default: '' },
    moodTags: { type: [String], default: [] },
    imageryStyle: { type: String, default: '' },
    voiceTone: { type: String, default: '' },
    // Where the tone of voice came from: 'guideline' (stated in an uploaded brand guideline), 'web' (found by searching the web), 'manual' (typed in by the team).
    voiceToneSource: { type: String, default: '' },
    // Fields a person has edited by hand; a re-analysis of an uploaded asset never overwrites these.
    editedFields: { type: [String], default: [] },
    summary: { type: String, default: '' },
    lastAnalyzedAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'BrandAsset', default: null },
    lastAnalyzedAt: { type: Date, default: null },
    modelUsed: { type: String, default: '' }
  },
  // The structured Brand Assets screen (Guidelines, Assets, Colors, Imagery, Languages & Fonts): one list of items per box,
  // the guidelines PDF it was read from, and the AI style summaries of the reference images. See utils/brandProfile.js.
  // Agency-only, like the guide. The older fields below are kept in step with it so every existing prompt path still works.
  profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Customer-specific brand guide, written by the agency's super admin (Brand Assets -> Brand guide).
  // Customers never see or edit it. Read by utils/brandGuide.js when the brand is being followed.
  guide: {
    instructions: { type: String, default: '' }, // applies to every caption and every image
    copyInstructions: { type: String, default: '' },
    designInstructions: { type: String, default: '' },
    audience: { type: String, default: '' },
    positioning: { type: String, default: '' },
    logoRules: { type: String, default: '' }, // which logo to use where
    mandatoryText: { type: String, default: '' }, // disclaimer / legal line
    doList: { type: [String], default: [] },
    dontList: { type: [String], default: [] },
    preferredWords: { type: [String], default: [] },
    avoidWords: { type: [String], default: [] },
    taglines: { type: [String], default: [] },
    // Style rules learned from the brand's past published assets (Brand guide -> Learn from past assets). Each is one sentence the AI follows.
    learned: { type: [{ scope: { type: String, enum: ['copy', 'design'], default: 'design' }, text: { type: String, default: '' }, _id: false }], default: [] },
    // Photography guide (Brand guide -> Photography guide): how photographs of people, products and ingredients should look.
    // Photographic direction only - never typography, text, logos, layout or aspect ratio (see utils/photographyGuide.js).
    // `source` is the uploaded .md as written, kept so it can be read again; the other fields are the condensed, editable direction.
    photography: {
      fileName: { type: String, default: '' },
      uploadedAt: { type: Date, default: null },
      source: { type: String, default: '' },
      look: { type: String, default: '' },
      people: { type: String, default: '' },
      product: { type: String, default: '' },
      avoid: { type: String, default: '' },
      modelSuffix: { type: String, default: '' },
      productSuffix: { type: String, default: '' }
    },
    reviewedAt: { type: Date, default: null },
    reviewedByName: { type: String, default: '' }
  }
};

// A sub-brand's own kit: empty by default so only what its assets actually told us overrides the main brand.
export const subBrandKitFields = {
  colors: { type: [String], default: [] },
  fonts: {
    display: { type: String, default: '' },
    body: { type: String, default: '' },
    suggestedDisplay: { type: String, default: '' },
    suggestedBody: { type: String, default: '' }
  },
  designLanguage: brandKitFields.designLanguage
};

export const competitorFields = {
  type: [{ name: { type: String, required: true, trim: true }, website: { type: String, default: '' }, _id: false }],
  default: []
};

export const connectedAccountFields = {
  linkedin: {
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    personURN: { type: String, default: '' },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    connectedAt: { type: Date, default: null }
  },
  meta: {
    userAccessToken: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    pageId: { type: String, default: '' },
    pageName: { type: String, default: '' },
    pageAccessToken: { type: String, default: '' },
    instagramBusinessId: { type: String, default: '' },
    instagramUsername: { type: String, default: '' },
    connectedAt: { type: Date, default: null }
  },
  x: {
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    userId: { type: String, default: '' },
    username: { type: String, default: '' },
    connectedAt: { type: Date, default: null }
  },
  youtube: {
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    channelId: { type: String, default: '' },
    channelTitle: { type: String, default: '' },
    connectedAt: { type: Date, default: null }
  }
};

/** Tokens never reach the client - only a "is it connected" shape does. */
export function redactConnectedAccounts(ca = {}) {
  const out = {};
  if (ca.linkedin) out.linkedin = { connected: Boolean(ca.linkedin.accessToken), name: ca.linkedin.name, connectedAt: ca.linkedin.connectedAt };
  if (ca.meta) out.meta = { connected: Boolean(ca.meta.pageAccessToken), pageName: ca.meta.pageName, instagramUsername: ca.meta.instagramUsername, connectedAt: ca.meta.connectedAt };
  if (ca.x) out.x = { connected: Boolean(ca.x.accessToken), username: ca.x.username, connectedAt: ca.x.connectedAt };
  if (ca.youtube) out.youtube = { connected: Boolean(ca.youtube.accessToken), channelTitle: ca.youtube.channelTitle, connectedAt: ca.youtube.connectedAt };
  return out;
}
