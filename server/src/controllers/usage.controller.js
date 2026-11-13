import mongoose from 'mongoose';
import AiUsageLog from '../models/AiUsageLog.js';
import Post from '../models/Post.js';
import GenerationRecord from '../models/GenerationRecord.js';
import { syncGenerationRecords } from '../services/generationRecordService.js';
import User from '../models/User.js';
import { generationUsage, customerCycle } from '../services/customerService.js';
import { getFormat } from '../constants/postFormats.js';

// CUSTOMER USAGE ("Usage" in the left panel): what the signed-in person's workspace has generated, one row per
// generation. This is the customer-facing view, so it deliberately leaves out what the agency pays: no costs, no
// providers, no model names, no tokens. (The agency's own spend log stays under Admin -> AI usage.)
//
//  - A customer admin (and an agency admin who has opened the customer) sees the whole workspace.
//  - A member sees only their own rows.
//  - Work done by agency staff inside the workspace is not listed for customer users (same rule as the monthly allowance).

const ACTION_LABELS = {
  caption: 'Caption',
  copy_directions: 'Creative directions',
  design_variants: 'Design variants',
  headline: 'Headline',
  copy_modify: 'Copy edit',
  suggestion_look_and_feel: 'Look & feel suggestion',
  suggestion_message: 'Message suggestion',
  image_generate: 'Image',
  image_options: 'Image options',
  image_port_format: 'Resize to another size',
  image_modify: 'Image edit',
  video_generate: 'Video',
  video_port_format: 'Video resize',
  multiscene_video: 'Multi-scene video'
};
const FLOW_LABELS = {
  new: 'New Creative',
  adaptation: 'Creative Edit',
  resize: 'Size Adapt',
  hero: 'Subject Swap',
  headline: 'Headline Switch',
  convert: 'Convert to Video',
  multiscene: 'Multi-scene Video'
};
const humanize = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const TYPE_LABELS = { image: 'Image', video: 'Video', text: 'Text' };

const toDate = (v, endOfDay = false) => {
  if (!v || Number.isNaN(Date.parse(v))) return null;
  const d = new Date(v);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * What the customer sees as "generated": each card in Saved Documents -> Completed is one creative session, so it counts
 * as ONE generation however many images/options/sizes it took to get there. A document is an image generation if it
 * produced any image, and a video generation if it produced any finished video (Convert to Video documents count as
 * video only). The Images / Videos lists and the "This month" numbers on the Usage page are all built from these
 * sessions, so they always match the Completed cards. Display only: the monthly limit still counts every image / video
 * actually made (generationUsage, the generation log), so e.g. 6 generations shown here can sit against 10 images used.
 * Cards carry no timestamp of their own, so a document counts on the day it was created.
 */
async function loadSessions(req, isAgency, isStaff, range = {}) {
  const filter = {}; // the tenant plugin adds the customer
  if (range.from || range.to) filter.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { [range.toOp || '$lte']: range.to } : {}) };
  if (!isAgency) filter.user = { $nin: await User.find({ role: 'admin' }).distinct('_id') };
  if (!isStaff) filter.user = req.user._id;
  // Documents still in Saved Documents: make sure each of their generations has its stored row (cheap: only missing rows are written).
  const posts = await Post.find(filter).select('creativeType purpose mediums user createdAt designs customer').sort({ createdAt: -1 }).limit(3000).lean();
  await syncGenerationRecords(posts);
  const postById = new Map(posts.map((p) => [String(p._id), p]));
  // Everything the customer sees as generated comes from the stored GenerationRecord rows, so it no longer depends on
  // the document still existing (a deleted asset keeps its row).
  const records = await GenerationRecord.find(filter).sort({ createdAt: -1 }).lean();
  const sessions = records.map((r) => {
    const live = postById.get(String(r.post));
    const post = live || { _id: r.post, creativeType: r.creativeType, purpose: r.purpose, mediums: r.mediums, user: r.user, createdAt: r.createdAt };
    let imageUrl = '';
    let videoUrl = '';
    for (const d of live?.designs || []) {
      if (!imageUrl) imageUrl = d.imageUrl || (d.imageOptions || []).find((o) => o?.imageUrl)?.imageUrl || (d.formatVariants || []).find((v) => v?.imageUrl)?.imageUrl || '';
      if (!videoUrl) videoUrl = (d.videoJobs || []).find((j) => j?.status === 'completed' && j.videoUrl)?.videoUrl || '';
    }
    return { post, imageUrl: r.kind === 'image' ? imageUrl : '', videoUrl: r.kind === 'video' ? videoUrl : '', hasImage: r.kind === 'image', hasVideo: r.kind === 'video' };
  });
  return sessions;
}

/** GET /api/ai/usage?type=&from=&to=&page=&limit= */
export async function customerUsage(req, res, next) {
  try {
    if (!req.customer) return res.json({ available: false });

    const isAgency = req.user?.role === 'admin';
    const isStaff = isAgency || req.user?.role === 'customerAdmin';
    const from = toDate(req.query.from);
    const to = toDate(req.query.to, true);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const type = req.query.type === 'video' ? 'video' : 'image'; // the Usage page lists images and videos only

    // "This month" numbers: completed documents (sessions) created in the billing cycle, images and videos separately.
    const cycle = customerCycle(req.customer); // this month, or everything since a one-time package started
    const [usage, cycleSessions, windowSessions] = await Promise.all([
      generationUsage(req.customer, { cards: true }), // cards: also counts the customer-facing generations for the bar
      loadSessions(req, isAgency, isStaff, { from: cycle.start, to: cycle.end, toOp: '$lt' }),
      loadSessions(req, isAgency, isStaff, { from, to })
    ]);
    const completedCards = {
      images: { count: cycleSessions.filter((x) => x.hasImage).length },
      videos: { count: cycleSessions.filter((x) => x.hasVideo).length }
    };

    // The list: one row per completed document of the chosen type, newest first.
    const mine = windowSessions.filter((x) => (type === 'video' ? x.hasVideo : x.hasImage));
    const total = mine.length;
    const pageRows = mine.slice((page - 1) * limit, page * limit);
    const userIds = [...new Set(pageRows.map((x) => String(x.post.user || '')).filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name email').lean() : [];
    const userById = Object.fromEntries(users.map((u) => [String(u._id), u.name || u.email || '']));

    res.json({
      available: true,
      scope: isStaff ? 'workspace' : 'mine',
      customerName: req.customer.name,
      // Used for the monthly-limit checks (every image / video actually made). Not shown as the "generated" numbers.
      allowance: { plan: usage.plan, images: usage.images, videos: usage.videos, cycleStart: usage.cycleStart, resetsAt: usage.cycleEnd },
      completedCards,
      // The bar on the Usage page: customer generations used vs the generation limit the agency set (null limit = no bar).
      customerGenerations: usage.customerGenerations,
      totals: { all: total, images: windowSessions.filter((x) => x.hasImage).length, videos: windowSessions.filter((x) => x.hasVideo).length },
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      logs: pageRows.map((x) => ({
        id: `${x.post._id}:${type}`,
        at: x.post.createdAt,
        user: userById[String(x.post.user)] || '',
        type,
        typeLabel: TYPE_LABELS[type],
        activity: type === 'video' ? 'Video generation' : 'Image generation',
        flow: FLOW_LABELS[x.post.creativeType] || 'Custom creative',
        post: { id: String(x.post._id), title: x.post.purpose || '' },
        size: x.post.mediums?.[0] ? getFormat(x.post.mediums[0])?.label || '' : '',
        videoSeconds: 0,
        status: 'done',
        imageUrl: type === 'image' ? x.imageUrl : '',
        videoUrl: type === 'video' ? x.videoUrl : ''
      }))
    });
  } catch (err) {
    next(err);
  }
}
