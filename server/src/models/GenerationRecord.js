import mongoose from 'mongoose';
import tenantPlugin from '../tenant/tenantPlugin.js';

// ONE ROW PER GENERATION the customer sees on the Dashboard and Usage page: a completed card in Saved Documents that
// produced an image (kind 'image') or a finished video (kind 'video'). Stored on its own so the numbers never depend
// on the asset still existing, on files, or on re-reading the whole document: deleting an asset only flips
// `assetDeleted`, the generation stays counted.
//
//   customer + user          who it belongs to (customer is stamped by the tenant plugin)
//   post                     the document it came from (may no longer exist)
//   kind                     'image' | 'video'
//   createdAt                the day the generation counts on (the document's creation day)
//   creativeType, purpose, mediums   what the Usage list shows for it
//   assetDeleted             true once the document was deleted from Saved Documents
//
// Counting examples (all scoped to the customer automatically):
//   GenerationRecord.countDocuments({ kind: 'image', createdAt: { $gte: start, $lt: end } })
const generationRecordSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    post: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
    kind: { type: String, enum: ['image', 'video'], required: true },
    createdAt: { type: Date, required: true, index: true },
    creativeType: { type: String, default: 'new' },
    purpose: { type: String, default: '' },
    mediums: { type: [String], default: [] },
    assetDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: false }
);
generationRecordSchema.index({ post: 1, kind: 1 }, { unique: true });
generationRecordSchema.plugin(tenantPlugin);

export default mongoose.model('GenerationRecord', generationRecordSchema);
