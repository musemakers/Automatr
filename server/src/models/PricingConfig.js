import mongoose from 'mongoose';

// Singleton document holding the admin-approved provider pricing used by the
// Admin -> Usage Estimator (and, once saved, the "~$0.0X" cost tags). Rates are
// stored as plain nested objects keyed by provider id so adding a provider
// never needs a migration. When no document exists (or a provider/field is
// missing) services/pricingService.js falls back to the static ballpark
// numbers in constants/aiPricing.js, so nothing breaks before first save.
//
//   image:  { openai: { '1K': usd, '2K': usd, '4K': usd }, ... }   USD per generated image
//   text:   { openai: { input: usd, output: usd }, ... }            USD per 1,000,000 tokens
//   video:  { veo: { perSecond: usd }, ... }                         USD per second of video
const pricingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    image: { type: mongoose.Schema.Types.Mixed, default: {} },
    text: { type: mongoose.Schema.Types.Mixed, default: {} },
    video: { type: mongoose.Schema.Types.Mixed, default: {} },

    // 'ai' = fetched by the AI price lookup then approved, 'manual' = edited by hand.
    source: { type: String, enum: ['default', 'ai', 'manual'], default: 'default' },
    fetchedAt: { type: Date, default: null },
    // Exact model ids the fetched prices were looked up for (so a later model
    // change is visibly "out of date" in the UI).
    modelIds: { type: mongoose.Schema.Types.Mixed, default: {} },
    // [{ label, url, note }] - where each figure came from, shown to the admin.
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notes: { type: String, default: '' },
    // Rupees per US dollar for the INR view; null = use DEFAULT_USD_TO_INR.
    usdToInr: { type: Number, default: null },
    fxUpdatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' }
  },
  { timestamps: true }
);

export default mongoose.model('PricingConfig', pricingSchema);
