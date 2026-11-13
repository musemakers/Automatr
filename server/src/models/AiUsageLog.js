import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// One document per actual generation call (text or image) that goes
// through router.js - see aiUsageLogService.js for how entries get here.
// Deliberately denormalizes userName/userEmail onto the log itself (rather
// than only storing a ref) so the admin log view never breaks or shows
// "unknown user" if a user account is later deleted, and so listing logs
// doesn't need a populate() join on every request.
const aiUsageLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },
    userEmail: { type: String, default: '' },

    type: { type: String, enum: ['text', 'image', 'video'], required: true },
    // A short machine-readable label for which feature triggered this call -
    // e.g. 'caption', 'headline', 'copy_modify', 'suggestion_look_and_feel',
    // 'suggestion_message', 'image_generate', 'image_options', 'image_port_format'.
    action: { type: String, required: true },

    // The literal provider that served the request ('openai', 'anthropic',
    // 'gemini', 'seedream', or 'placeholder' if no provider was configured
    // and a placeholder was used instead - logged with cost 0 so admins can
    // see how often generations are silently falling back to placeholders).
    provider: { type: String, required: true },

    estimatedCostUsd: { type: Number, default: 0 },

    // Only populated for type:'image' when a real (non-placeholder) image
    // was actually generated - the server-relative /uploads/... path, same
    // as Post.designs[].imageUrl. Lets the admin usage page show an actual
    // image gallery per user, not just metadata rows.
    imageUrl: { type: String, default: '' },

    // Only populated for type:'video'. One log row per video job submitted.
    // videoSeconds is the duration the provider was actually asked to render
    // (after each provider's snap to 5s/10s buckets), which is what the cost
    // estimate is based on. externalJobId ties the row to
    // Post.designs[].videoJobs[].externalJobId; videoUrl is filled in later
    // once the finished video has been downloaded locally.
    videoSeconds: { type: Number, default: 0 },
    externalJobId: { type: String, default: '' },
    videoUrl: { type: String, default: '' },

    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },

    // ---- Detail captured for the agency's spend log (all optional: older rows don't have them) ----
    customerName: { type: String, default: '' }, // denormalized so the all-customers view needs no join
    model: { type: String, default: '' }, // exact model id sent to the provider, e.g. gpt-image-2.5-flare
    size: { type: String, default: '' }, // image: requested pixel size / quality hint; video: aspect ratio
    quality: { type: String, default: '' },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    tokensEstimated: { type: Boolean, default: false }, // true = ~4 characters per token, not provider-reported
    attempts: { type: Number, default: 1 }, // image: 1 + regenerations (black-bar / colour checks); cost is multiplied by this
    referenceImages: { type: Number, default: 0 },
    // The reference images actually sent with this call (new rows only): where each lives under /uploads, its original name and the role it
    // played (brand look-and-feel reference, preferred layout, template, or a plain product / asset image). Shown in Admin -> AI usage.
    referenceFiles: [{ _id: false, url: { type: String, default: '' }, name: { type: String, default: '' }, role: { type: String, default: '' } }],
    mode: { type: String, default: '' }, // e.g. text-to-video / image-to-video
    durationMs: { type: Number, default: 0 },
    purpose: { type: String, default: '' }, // short label of what the call was for
    // The exact prompt sent to the image / video model (after every instruction block was added), so the agency can see precisely what a
    // customer's generation was asked to do. Images and videos only; rows written before this existed have none. Shown in Admin -> AI usage.
    prompt: { type: String, default: '' },
    unitCostUsd: { type: Number, default: 0 }, // cost of ONE attempt (estimatedCostUsd = unitCostUsd x attempts)

    // ---- Exact-cost inputs (new rows only) ----
    resolution: { type: String, default: '' }, // video: the resolution actually requested (e.g. 720p / 1080p)
    rateUsd: { type: Number, default: 0 }, // video: effective USD per second used for this row
    imageInputTokens: { type: Number, default: 0 }, // image: the part of inputTokens that were image tokens (edits / references)
    // How estimatedCostUsd was produced: 'provider-tokens' (real usage x token price), 'rate-card' (exact per-second /
    // per-image price), 'tokens-estimated' (video, until the job finishes), 'flat-estimate' (rough per-image table),
    // 'not-billed-failed' (provider does not charge failed jobs). Empty on rows written before this existed.
    costBasis: { type: String, default: '' },
    // INR at the moment of generation, so past rupee figures never drift when the exchange rate is edited later.
    fxUsdToInr: { type: Number, default: 0 },
    costInr: { type: Number, default: 0 }
  },
  { timestamps: true }
);

aiUsageLogSchema.index({ createdAt: -1 });
aiUsageLogSchema.index({ user: 1, createdAt: -1 });
aiUsageLogSchema.index({ externalJobId: 1 }, { sparse: true });

aiUsageLogSchema.plugin(tenantPlugin);
aiUsageLogSchema.index({ customer: 1, createdAt: -1 });
aiUsageLogSchema.index({ provider: 1, model: 1, createdAt: -1 });

export default mongoose.model('AiUsageLog', aiUsageLogSchema);
