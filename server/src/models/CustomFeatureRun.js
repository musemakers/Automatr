import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// One document per run of a custom feature (a test run by the agency, or a real run by a customer's
// person). Runs ARE customer-scoped (tenantPlugin) like posts and reels. Progress is written here by the
// background pipeline (services/ai/customFeatureService.js); the browser only polls.
const variantSchema = new mongoose.Schema(
  { url: { type: String, default: '' }, note: { type: String, default: '' } },
  { _id: false }
);

const stepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'running', 'done', 'failed'], default: 'pending' },
    prompt: { type: String, default: '' }, // the filled-in template, WITHOUT the generation-time guard text
    variants: { type: [variantSchema], default: [] },
    selected: { type: Number, default: 0 },
    note: { type: String, default: '' }
  },
  { _id: false }
);

const customFeatureRunSchema = new mongoose.Schema(
  {
    feature: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomFeature', required: true, index: true },
    featureName: { type: String, default: '' },
    featureVersion: { type: Number, default: 1 },
    isTest: { type: Boolean, default: false },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['running', 'review', 'composing', 'completed', 'failed'], default: 'running' },
    stage: { type: String, default: '' },
    error: { type: String, default: '' },
    inputs: { type: Object, default: {} },
    // File NAMES (inside the customer's upload folder) per image field, not absolute paths.
    files: { type: Object, default: {} },
    // The spec as it was when the run started, so later edits never break an old run.
    specSnapshot: { type: Object, default: {} },
    steps: { type: [stepSchema], default: [] },
    finalUrl: { type: String, default: '' }
  },
  { timestamps: true }
);

customFeatureRunSchema.plugin(tenantPlugin);

export default mongoose.model('CustomFeatureRun', customFeatureRunSchema);
