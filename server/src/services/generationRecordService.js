import mongoose from 'mongoose';
import GenerationRecord from '../models/GenerationRecord.js';
import Post from '../models/Post.js';
import { unscoped } from '../tenant/context.js';

/** Which generations a document has produced: image (not for Convert to Video documents) and / or video. */
export function kindsOfPost(p) {
  const designs = p.designs || [];
  const kinds = [];
  const hasImage =
    p.creativeType !== 'convert' &&
    designs.some((d) => d.imageUrl || (d.imageOptions || []).some((o) => o?.imageUrl) || (d.formatVariants || []).some((v) => v?.imageUrl));
  const hasVideo = designs.some((d) => (d.videoJobs || []).some((j) => j?.status === 'completed' && j.videoUrl));
  if (hasImage) kinds.push('image');
  if (hasVideo) kinds.push('video');
  return kinds;
}

/**
 * Makes sure every generation in these documents has its own stored row. Only rows that are missing are written, so
 * calling it often is cheap. Run when Usage is read and just before a document is deleted.
 */
export async function syncGenerationRecords(posts) {
  const list = (posts || []).filter(Boolean);
  if (!list.length) return;
  const existing = await GenerationRecord.find({ post: { $in: list.map((p) => p._id) } }).select('post kind').lean();
  const have = new Set(existing.map((r) => `${r.post}:${r.kind}`));
  const ops = [];
  for (const p of list) {
    for (const kind of kindsOfPost(p)) {
      if (have.has(`${p._id}:${kind}`)) continue;
      ops.push({
        updateOne: {
          filter: { post: p._id, kind },
          update: { $setOnInsert: { customer: p.customer, user: p.user, createdAt: p.createdAt, creativeType: p.creativeType, purpose: p.purpose || '', mediums: p.mediums || [], assetDeleted: false } },
          upsert: true
        }
      });
    }
  }
  if (ops.length) await GenerationRecord.bulkWrite(ops, { ordered: false });
}

/** A document is being deleted: keep its generations, mark them as deleted. */
export async function markAssetsDeleted(posts) {
  const list = (posts || []).filter(Boolean);
  if (!list.length) return;
  await syncGenerationRecords(list);
  await GenerationRecord.updateMany({ post: { $in: list.map((p) => p._id) } }, { $set: { assetDeleted: true, deletedAt: new Date() } });
}

/**
 * Generations the customer sees in a billing cycle: completed cards, images and videos counted separately, exactly as the
 * Usage page counts them (work by agency staff left out). Brings the stored rows up to date first, so the figure is right
 * even for a customer who has not opened their Usage page yet. For the admin screens (limits next to AI usage).
 */
export async function countCustomerGenerations(customerId, cycle, excludeUserIds = []) {
  return unscoped(async () => {
    const cid = new mongoose.Types.ObjectId(String(customerId));
    const range = { $gte: cycle.start, $lt: cycle.end };
    const posts = await Post.find({ customer: cid, createdAt: range, user: { $nin: excludeUserIds } })
      .select('creativeType purpose mediums user createdAt designs customer').limit(3000).lean();
    await syncGenerationRecords(posts);
    const rows = await GenerationRecord.aggregate([
      { $match: { customer: cid, createdAt: range, user: { $nin: excludeUserIds } } },
      { $group: { _id: '$kind', n: { $sum: 1 } } }
    ]);
    const n = (k) => rows.find((r) => r._id === k)?.n || 0;
    return { image: n('image'), video: n('video') };
  });
}
