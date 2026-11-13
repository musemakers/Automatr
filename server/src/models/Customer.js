import mongoose from 'mongoose';
import { brandKitFields, subBrandKitFields, competitorFields, connectedAccountFields } from './schemas/workspaceFields.js';

export const CUSTOMER_STATUSES = ['active', 'suspended', 'archived'];
export const DELIVERY_MODES = ['none', 'folder', 'webhook'];
// Folder names double as directory names on disk, so keep them boring.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
// How many design options this customer's creatives show on New Creative's last screen (set by the agency when creating or editing a customer).
export const DESIGN_OPTION_CHOICES = [1, 2, 3];
export const DEFAULT_DESIGN_OPTIONS = 1;
export const cleanDesignOptions = (v) => (DESIGN_OPTION_CHOICES.includes(Number(v)) ? Number(v) : DEFAULT_DESIGN_OPTIONS);

// A Customer is one client workspace. Everything that used to be "per user" and
// really meant "per client" lives here: brand kit, competitors, social accounts,
// model settings, file storage folder, delivery destination, budget. Users,
// posts, brand assets, usage logs and reels point at a customer (see
// tenant/tenantPlugin.js), so customers are isolated from each other.
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: SLUG_RE },
    status: { type: String, enum: CUSTOMER_STATUSES, default: 'active' },
    industry: { type: String, default: 'Technology' },
    // Optional. Blank = not specified (competitor detection then looks at India-based competitors).
    country: { type: String, default: '', trim: true, maxlength: 80 },
    notes: { type: String, default: '', maxlength: 2000 },

    // Model settings. null = inherit the agency-wide default (AppSetting).
    settings: {
      newsProvider: { type: String, default: null },
      copyModel: { type: String, default: null },
      imageModel: { type: String, default: null },
      visionModel: { type: String, default: null },
      videoModel: { type: String, default: null },
      hideCosts: { type: Boolean, default: null }
    },

    // Where this customer's files live: <upload root>/customers/<folder>/.
    // Fixed at creation (files already written keep their URLs).
    storage: {
      folder: { type: String, required: true, match: SLUG_RE }
    },

    // Where finished creatives are delivered.
    //  none    - nothing is delivered automatically
    //  folder  - copies are written to <storage folder>/<subfolder>/<post id>/
    //  webhook - a signed JSON POST to the customer's own URL (their DAM, Zapier, ...)
    delivery: {
      mode: { type: String, enum: DELIVERY_MODES, default: 'none' },
      autoOnPublish: { type: Boolean, default: false },
      subfolder: { type: String, default: 'delivered' },
      webhookUrl: { type: String, default: '' },
      webhookSecret: { type: String, default: '' },
      lastDeliveredAt: { type: Date, default: null },
      lastError: { type: String, default: '' }
    },

    // Monthly AI spend cap in USD (estimated). Set by the agency.
    budget: {
      monthlyUsd: { type: Number, default: null, min: 0 },
      enforce: { type: Boolean, default: false }
    },

    // Optional features the agency switches on per customer (Admin -> Customers -> create / edit). Off unless ticked.
    //  billboards      - the "Billboards" group in the size picker and the billboard print-file export
    //  multiSceneVideo - Multi-scene Video (Generate Media -> Made for You)
    //  preciseFontText - headline + sub-headline are drawn in code with the exact brand font files over a text-free image
    features: {
      billboards: { type: Boolean, default: false },
      multiSceneVideo: { type: Boolean, default: false },
      preciseFontText: { type: Boolean, default: false },
      // 1, 2 or 3 designs per creative (the first N of the three visual approaches). One unless the agency raises it.
      designOptions: { type: Number, enum: DESIGN_OPTION_CHOICES, default: DEFAULT_DESIGN_OPTIONS }
    },

    // Agency-only switches. When on, only agency admins (superadmins) can run that kind of
    // generation in this customer's workspace; the customer's own admin and members can't.
    restrictions: {
      imageGenSuperadminOnly: { type: Boolean, default: false },
      videoGenSuperadminOnly: { type: Boolean, default: false }
    },

    // Monthly generation caps (null = unlimited). The month runs from the day-of-month the
    // customer was created (see billingCycle in customerService.js). Agency admins are never
    // capped and their generations don't count against these.
    // Plan: 'monthly' = the limits below renew every month (the month starts on the day the customer was created);
    // 'one_time' = a one-time package: the limits are a fixed total from `startsAt` and never renew (top-ups add to the total).
    plan: {
      type: { type: String, enum: ['monthly', 'one_time'], default: 'monthly' },
      startsAt: { type: Date, default: null }
    },
    limits: {
      imagesPerMonth: { type: Number, default: null, min: 0 },
      videosPerMonth: { type: Number, default: null, min: 0 },
      // What the customer SEES as generated (completed cards on their Usage page: one per creative, however many AI images it
      // took). Set by the super admin next to the AI limits above so the two can be planned together. null = no figure set.
      imageGenerationsPerMonth: { type: Number, default: null, min: 0 },
      videoGenerationsPerMonth: { type: Number, default: null, min: 0 },
      // File storage quota in MB (1 GB by default). Shown on Saved Documents.
      storageMb: { type: Number, default: 1024, min: 0 }
    },

    // Top-ups: extra images / videos a superadmin grants on top of the monthly limits. A top-up
    // counts toward the cycle it was granted in and lapses when that cycle renews (see
    // generationUsage in customerService.js). Kept as a ledger so every grant is auditable.
    topUps: [
      {
        kind: { type: String, enum: ['image', 'video'], required: true },
        amount: { type: Number, required: true, min: 1 },
        note: { type: String, default: '', maxlength: 200 },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        byName: { type: String, default: '' },
        at: { type: Date, default: Date.now }
      }
    ],

    // Limits history: every change a superadmin makes to the generation limits (and storage), newest last. Agency-only ledger.
    limitChanges: [
      {
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        byName: { type: String, default: '' },
        note: { type: String, default: '', maxlength: 200 },
        changes: [{ field: { type: String, required: true }, from: { type: Number, default: null }, to: { type: Number, default: null }, _id: false }]
      }
    ],

    // Languages this workspace writes post copy, headlines and sub-headlines in (Brand Assets -> Languages).
    // defaultLanguage '' = English, which is also what is used when no language has been added.
    languages: { type: [String], default: [] },
    defaultLanguage: { type: String, default: '' },

    // Shared workspace data (moved off User).
    brandKit: brandKitFields,
    // Sub-brands (product lines / divisions) with their own brand guideline. The main brand is the default;
    // a New Creative picks a sub-brand from its brief (see services/subBrandService.js).
    subBrands: [
      {
        name: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, default: '', maxlength: 300 },
        keywords: { type: [String], default: [] },
        brandKit: subBrandKitFields,
        createdAt: { type: Date, default: Date.now }
      }
    ],
    competitors: competitorFields,
    competitorsDetectedAt: { type: Date, default: null },
    connectedAccounts: connectedAccountFields
  },
  { timestamps: true }
);

customerSchema.methods.toPublicJSON = function toPublicJSON() {
  const o = this.toObject();
  delete o.connectedAccounts;
  delete o.brandKit;
  delete o.subBrands;
  delete o.competitors;
  delete o.topUps; // agency-only ledger; the customers list returns it explicitly
  delete o.limitChanges; // agency-only ledger
  if (o.delivery) {
    o.delivery.hasWebhookSecret = Boolean(o.delivery.webhookSecret);
    delete o.delivery.webhookSecret;
  }
  return o;
};

/** Small shape embedded in the session user + customer switcher. */
customerSchema.methods.toSummary = function toSummary() {
  return {
    id: this._id,
    name: this.name,
    slug: this.slug,
    status: this.status,
    industry: this.industry,
    country: this.country || '',
    features: { billboards: Boolean(this.features?.billboards), multiSceneVideo: Boolean(this.features?.multiSceneVideo), preciseFontText: Boolean(this.features?.preciseFontText), designOptions: cleanDesignOptions(this.features?.designOptions) },
    restrictions: {
      imageGenSuperadminOnly: Boolean(this.restrictions?.imageGenSuperadminOnly),
      videoGenSuperadminOnly: Boolean(this.restrictions?.videoGenSuperadminOnly)
    }
  };
};

export default mongoose.model('Customer', customerSchema);
