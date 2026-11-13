import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// What is left behind when an asset (document) is deleted from Saved Documents. The files and the document itself are
// gone, but the customer-facing Usage numbers (generations, images, videos) must not drop because someone tidied up,
// so one small row per deleted document keeps its place in the count. It holds no files and no copy: only what the
// Usage page needs (who, when it was made, which tool, whether it produced an image / a video).
const deletedAssetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdAt: { type: Date, required: true, index: true }, // when the original document was created (the day it counts on)
    deletedAt: { type: Date, default: Date.now },
    creativeType: { type: String, default: 'new' },
    purpose: { type: String, default: '' },
    mediums: { type: [String], default: [] },
    hasImage: { type: Boolean, default: false },
    hasVideo: { type: Boolean, default: false }
  },
  { timestamps: false }
);
deletedAssetSchema.plugin(tenantPlugin);

export default mongoose.model('DeletedAsset', deletedAssetSchema);
