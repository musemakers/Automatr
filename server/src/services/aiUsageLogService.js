import mongoose from 'mongoose';
import AiUsageLog from '../models/AiUsageLog.js';
import Customer from '../models/Customer.js';
import { effectiveVideoSeconds, estimateVideoCostUsdByProvider } from './costEstimateService.js';
import { seedanceRatePer1M } from '../constants/aiPricing.js';
import { getFxRateSync } from './pricingService.js';
import { getTenant } from '../tenant/context.js';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import path from 'node:path';
import { uploadRoot } from '../utils/storage.js';

/**
 * Turns the reference images handed to a model ({ filePath, filename, role }) into small records the usage log can keep:
 * the /uploads URL of the file, its name and its role. Files outside the upload folder are skipped (they cannot be served).
 */
export function describeReferenceFiles(images) {
  const out = [];
  try {
    for (const img of images || []) {
      const fp = typeof img === 'string' ? img : img?.filePath;
      if (!fp) continue;
      const rel = path.relative(uploadRoot, path.resolve(fp));
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      out.push({ url: `/uploads/${rel.split(path.sep).join('/')}`, name: String((typeof img === 'object' && img.filename) || path.basename(fp)).slice(0, 120), role: String((typeof img === 'object' && img.role) || '') });
      if (out.length >= 16) break;
    }
  } catch { /* logging must never break generation */ }
  return out;
}

// ---- Call traces -------------------------------------------------------------------------------
// The routers (router.js / videoRouter.js) know the exact model, size, attempts and timing of every
// call, but the ~25 places that write the usage row don't. So the routers drop a small "trace" on
// the request's tenant context, and logUsageSafely() attaches the oldest matching trace (same type
// and provider) to the row it writes. Parallel calls of the same kind carry the same shape, so
// matching them in order is accurate enough. Nothing here can throw.
export function recordCallTrace(trace) {
  try {
    const store = getTenant();
    if (!store || !trace?.type || !trace?.provider) return;
    const q = store.callTrace || (store.callTrace = []);
    q.push({ ...trace, at: Date.now() });
    if (q.length > 60) q.splice(0, q.length - 60);
  } catch { /* tracing must never break generation */ }
}

function takeTrace(type, provider) {
  const q = getTenant()?.callTrace;
  if (!q?.length) return null;
  const i = q.findIndex((t) => t.type === type && t.provider === provider);
  return i === -1 ? null : q.splice(i, 1)[0];
}

/**
 * Same as logUsage, but never throws - a logging failure should never
 * break the actual generation feature that triggered it. Also silently
 * no-ops if usageContext wasn't provided (e.g. an internal call with no
 * user/action to attribute it to) rather than writing an unattributed row.
 */
export async function logUsageSafely(usageContext, fields) {
  if (!usageContext || !usageContext.action) return;
  try {
    const trace = takeTrace(fields.type, fields.provider);
    let merged = { ...fields };
    if (trace) {
      const attempts = Math.max(1, Number(trace.attempts) || 1);
      const exact = (fields.type === 'image' || fields.type === 'video') && typeof trace.actualCostUsd === 'number' && trace.actualCostUsd >= 0;
      // exact = real token usage from the provider, already summed over every attempt; otherwise the flat estimate
      const unit = exact ? trace.actualCostUsd / attempts : Number(fields.estimatedCostUsd) || 0;
      merged = {
        ...trace,
        ...fields,
        attempts,
        unitCostUsd: unit,
        // regenerations (black-bar / colour checks) are real provider calls: price every attempt
        estimatedCostUsd: exact ? trace.actualCostUsd : fields.type === 'image' && attempts > 1 ? unit * attempts : unit
      };
      // video: bill the seconds / rate the provider was actually asked for, not a guess from env settings
      if (exact && fields.type === 'video' && trace.videoSeconds) merged.videoSeconds = trace.videoSeconds;
    } else {
      merged.unitCostUsd = Number(fields.estimatedCostUsd) || 0;
    }
    await logUsage({
      userId: usageContext.userId,
      userName: usageContext.userName,
      userEmail: usageContext.userEmail,
      action: usageContext.action,
      postId: usageContext.postId,
      ...merged
    });
  } catch (err) {
    console.warn('[ai:usage-log] failed to record usage:', err.message);
  }
}

/**
 * Records one real generation call. Called from router.js right after a
 * provider call succeeds (or right after determining nothing's configured,
 * with cost 0, so admins can see placeholder fallbacks happening too).
 * Never throws - a logging failure should never take down the actual
 * feature that triggered it; router.js wraps this in try/catch regardless,
 * but this is defensive on its own too.
 *
 * @param {{userId?: string, userName?: string, userEmail?: string, type: 'text'|'image'|'video', action: string, provider: string, estimatedCostUsd?: number, postId?: string}} entry
 */
export async function logUsage(entry) {
  const fx = getFxRateSync();
  await AiUsageLog.create({
    fxUsdToInr: fx,
    costInr: Math.round((entry.estimatedCostUsd || 0) * fx * 1e4) / 1e4,
    user: entry.userId || null,
    userName: entry.userName || '',
    userEmail: entry.userEmail || '',
    type: entry.type,
    action: entry.action,
    provider: entry.provider,
    estimatedCostUsd: entry.estimatedCostUsd || 0,
    videoSeconds: entry.videoSeconds || 0,
    externalJobId: entry.externalJobId || '',
    imageUrl: entry.imageUrl || '',
    post: entry.postId || null,
    customerName: getTenant()?.customer?.name || '',
    model: entry.model || '',
    size: entry.size || '',
    quality: entry.quality || '',
    inputTokens: entry.inputTokens || 0,
    outputTokens: entry.outputTokens || 0,
    tokensEstimated: Boolean(entry.tokensEstimated),
    attempts: entry.attempts || 1,
    referenceImages: entry.referenceImages || 0,
    referenceFiles: Array.isArray(entry.referenceFiles) ? entry.referenceFiles.slice(0, 16) : [],
    mode: entry.mode || '',
    durationMs: entry.durationMs || 0,
    purpose: entry.purpose || '',
    prompt: entry.type === 'text' ? '' : String(entry.prompt || '').slice(0, 20000),
    unitCostUsd: entry.unitCostUsd || 0,
    resolution: entry.resolution || '',
    rateUsd: entry.rateUsd || 0,
    imageInputTokens: entry.imageInputTokens || 0,
    costBasis: entry.costBasis || ''
  });
}

/**
 * Records one video generation job (one row per video). Called right after
 * videoRouter.submitVideoJob accepts a job - that's when the provider starts
 * billing, so a video that later fails or is never polled is still logged.
 * Never throws.
 */
export async function logVideoUsage(usageContext, { provider, externalJobId, requestedSeconds }) {
  const videoSeconds = effectiveVideoSeconds(provider, requestedSeconds);
  await logUsageSafely(usageContext, {
    type: 'video',
    provider,
    externalJobId,
    videoSeconds,
    estimatedCostUsd: estimateVideoCostUsdByProvider(provider, videoSeconds)
  });
}

/**
 * Stamps the locally-saved video URL onto its usage row once the job completes. For Seedance (token-billed) it also
 * replaces the up-front estimate with the real bill: usage.completion_tokens x price per 1M tokens. Never throws.
 * @param {{completionTokens?: number}} [usage] the `usage` field of the completed checkVideoJob result
 */
export async function attachVideoUrl(externalJobId, videoUrl, usage) {
  if (!externalJobId || !videoUrl) return;
  try {
    const $set = { videoUrl };
    const tokens = Number(usage?.completionTokens) || 0;
    if (tokens > 0) {
      const row = await AiUsageLog.findOne({ type: 'video', externalJobId }).lean();
      if (row && row.provider === 'seedance') {
        const cost = (tokens * seedanceRatePer1M(row.model)) / 1e6;
        Object.assign($set, {
          outputTokens: tokens,
          tokensEstimated: false,
          estimatedCostUsd: cost,
          unitCostUsd: cost,
          rateUsd: row.videoSeconds ? cost / row.videoSeconds : 0,
          costBasis: 'provider-tokens',
          costInr: Math.round(cost * (row.fxUsdToInr || getFxRateSync()) * 1e4) / 1e4
        });
      }
    }
    await AiUsageLog.updateOne({ type: 'video', externalJobId }, { $set });
  } catch (err) {
    console.warn('[ai:usage-log] failed to attach video url:', err.message);
  }
}

/** Seedance only charges for successfully generated videos - a failed job costs nothing. Never throws. */
export async function markVideoFailed(externalJobId) {
  if (!externalJobId) return;
  try {
    await AiUsageLog.updateOne(
      { type: 'video', provider: 'seedance', externalJobId },
      { $set: { estimatedCostUsd: 0, unitCostUsd: 0, rateUsd: 0, costInr: 0, costBasis: 'not-billed-failed' } }
    );
  } catch (err) {
    console.warn('[ai:usage-log] failed to mark video as not billed:', err.message);
  }
}

// Customer names live on the Customer, not on old usage rows (those were logged before the name was
// stored on the row, or renamed since), so always resolve the current name from the Customer itself.
async function customerNames(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return {};
  const docs = await Customer.find({ _id: { $in: list } }).select('name').lean();
  return Object.fromEntries(docs.map((c) => [String(c._id), c.name]));
}

const toObjectId = (v) => (v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

/**
 * Shared filter for the log list, the CSV export and the roll-ups.
 * customerId only has an effect for agency admins viewing "all customers"; in a single customer's
 * workspace the tenant plugin already scopes every query.
 */
function buildFilter({ type, userId, customerId, provider, model, action, from, to, sinceDays } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (userId) filter.user = userId;
  const cid = toObjectId(customerId);
  if (cid) filter.customer = cid;
  if (provider) filter.provider = provider;
  if (model) filter.model = model;
  if (action) filter.action = action;
  const range = {};
  if (sinceDays) range.$gte = new Date(Date.now() - Number(sinceDays) * 24 * 60 * 60 * 1000);
  if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) { const d = new Date(to); d.setHours(23, 59, 59, 999); range.$lte = d; }
  if (Object.keys(range).length) filter.createdAt = range;
  return filter;
}

/**
 * Paginated log listing for the admin usage page, newest first.
 * @param {{page?: number, limit?: number, type?: 'text'|'image'|'video', userId?: string, customerId?: string, provider?: string, model?: string, action?: string, from?: string, to?: string}} args
 */
export async function listLogs({ page = 1, limit = 50, ...rest } = {}) {
  const filter = buildFilter(rest);
  const fxNow = getFxRateSync();

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const [logs, total, sums] = await Promise.all([
    AiUsageLog.find(filter)
      .select('-prompt') // prompts are long: fetched per row via getLogDetail
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    AiUsageLog.countDocuments(filter),
    AiUsageLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          costUsd: { $sum: '$estimatedCostUsd' },
          // rupees: the rate stored on each row when it was generated; older rows (no stored INR) use today's rate
          costInr: { $sum: { $cond: [{ $gt: ['$fxUsdToInr', 0] }, '$costInr', { $multiply: ['$estimatedCostUsd', fxNow] }] } },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' }
        }
      }
    ])
  ]);

  const names = await customerNames(logs.map((l) => l.customer));
  for (const l of logs) if (l.customer && names[String(l.customer)]) l.customerName = names[String(l.customer)];

  return {
    logs,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
    totals: { costUsd: sums[0]?.costUsd || 0, costInr: sums[0]?.costInr || 0, inputTokens: sums[0]?.inputTokens || 0, outputTokens: sums[0]?.outputTokens || 0 }
  };
}

/** Up to `max` rows for CSV export, newest first, using the same filters as the list. */
export async function exportLogs(args = {}, max = 50000) {
  const rows = await AiUsageLog.find(buildFilter(args)).select('-prompt').sort({ createdAt: -1 }).limit(max).lean();
  const names = await customerNames(rows.map((r) => r.customer));
  for (const r of rows) if (r.customer && names[String(r.customer)]) r.customerName = names[String(r.customer)];
  return rows;
}

/**
 * One row per customer: spend, calls, tokens and activity - the "who is costing what" view.
 * Needs the all-customers context (X-Customer-Id: all) to see more than one customer.
 */
export async function listCustomersSummary(args = {}) {
  const rows = await AiUsageLog.aggregate([
    { $match: buildFilter(args) },
    {
      $group: {
        _id: '$customer',
        customerName: { $last: '$customerName' },
        totalCalls: { $sum: 1 },
        totalCostUsd: { $sum: '$estimatedCostUsd' },
        textCalls: { $sum: { $cond: [{ $eq: ['$type', 'text'] }, 1, 0] } },
        imageCalls: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
        videoCalls: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
        videoSeconds: { $sum: '$videoSeconds' },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        lastActivityAt: { $max: '$createdAt' }
      }
    },
    { $sort: { totalCostUsd: -1 } }
  ]);
  const names = await customerNames(rows.map((r) => r._id));
  return rows.map((r) => ({ ...r, customerId: r._id, customerName: names[String(r._id)] || r.customerName || '', _id: undefined }));
}

/** Spend by provider + exact model - which models are actually costing money. */
export async function listModelsSummary(args = {}) {
  const rows = await AiUsageLog.aggregate([
    { $match: buildFilter(args) },
    {
      $group: {
        _id: { type: '$type', provider: '$provider', model: '$model' },
        calls: { $sum: 1 },
        costUsd: { $sum: '$estimatedCostUsd' },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        videoSeconds: { $sum: '$videoSeconds' }
      }
    },
    { $sort: { costUsd: -1 } }
  ]);
  return rows.map((r) => ({ ...r._id, calls: r.calls, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, videoSeconds: r.videoSeconds }));
}
/**
 * One row per user who has any logged activity, with aggregate totals -
 * powers the admin usage page's user list. Sorted by most recent activity
 * first, so the busiest/most-recent users surface at the top.
 */
export async function listUsersSummary(args = {}) {
  const rows = await AiUsageLog.aggregate([
    { $match: buildFilter(args) },
    {
      $group: {
        _id: '$user',
        userName: { $last: '$userName' },
        userEmail: { $last: '$userEmail' },
        totalCalls: { $sum: 1 },
        totalCostUsd: { $sum: '$estimatedCostUsd' },
        textCalls: { $sum: { $cond: [{ $eq: ['$type', 'text'] }, 1, 0] } },
        imageCalls: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
        videoCalls: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
        videoSeconds: { $sum: '$videoSeconds' },
        lastActivityAt: { $max: '$createdAt' }
      }
    },
    { $sort: { lastActivityAt: -1 } }
  ]);

  return rows.map((r) => ({
    userId: r._id,
    userName: r.userName,
    userEmail: r.userEmail,
    totalCalls: r.totalCalls,
    totalCostUsd: r.totalCostUsd,
    textCalls: r.textCalls,
    imageCalls: r.imageCalls,
    videoCalls: r.videoCalls,
    videoSeconds: r.videoSeconds,
    lastActivityAt: r.lastActivityAt
  }));
}

/**
 * Aggregate totals for the admin usage page header - total spend, total
 * calls, and a breakdown by type, over an optional recent window.
 * @param {{sinceDays?: number}} args
 */
export async function getUsageSummary(args = {}) {
  const match = buildFilter(args);

  const [totals, byType] = await Promise.all([
    AiUsageLog.aggregate([
      { $match: match },
      { $group: { _id: null, totalCostUsd: { $sum: '$estimatedCostUsd' }, totalCalls: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' } } }
    ]),
    AiUsageLog.aggregate([
      { $match: match },
      { $group: { _id: '$type', totalCostUsd: { $sum: '$estimatedCostUsd' }, totalCalls: { $sum: 1 } } }
    ])
  ]);

  return {
    totalCostUsd: totals[0]?.totalCostUsd || 0,
    totalCalls: totals[0]?.totalCalls || 0,
    inputTokens: totals[0]?.inputTokens || 0,
    outputTokens: totals[0]?.outputTokens || 0,
    byType: Object.fromEntries(byType.map((t) => [t._id, { totalCostUsd: t.totalCostUsd, totalCalls: t.totalCalls }]))
  };
}


// ---- Per-generation detail for the agency (Admin -> AI usage -> "Options & prompt") -----------------
const FLOW_NAMES = { new: 'New Creative', adaptation: 'Creative Edit', resize: 'Size Adapt', hero: 'Subject Swap', headline: 'Headline Switch', convert: 'Convert to Video' };
const yn = (v) => (v ? 'Yes' : 'No');
const list = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : '');

/**
 * What a customer chose when a generation was made, plus the exact prompt the model received.
 * Options are read from the creative (post) the generation belongs to; the prompt is the one stored on the usage row
 * (generations made before prompts were stored fall back to the prompt saved on the matching design, when there is one).
 * Agency admins only (the route enforces it).
 */
export async function getLogDetail(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const log = await AiUsageLog.findById(id).lean();
  if (!log) return null;

  let prompt = log.prompt || '';
  let promptSource = prompt ? 'logged' : '';
  const options = [];
  const add = (group, label, value) => {
    if (value === undefined || value === null) return;
    const v = typeof value === 'string' ? value.trim() : String(value);
    if (v) options.push({ group, label, value: v });
  };

  const post = log.post ? await Post.findById(log.post).lean() : null;
  let design = null;
  if (post) {
    const b = post.creativeBrief || {};
    const tp = b.templatePreservation || {};
    // the design (and option) this generation produced, matched by its saved image
    const url = log.imageUrl || log.videoUrl;
    design = (post.designs || []).find((d) =>
      url && (d.imageUrl === url || d.originalImageUrl === url || (d.imageOptions || []).some((o) => o.imageUrl === url) ||
        (d.formatVariants || []).some((f) => f.imageUrl === url) || (d.carouselSlides || []).some((c) => c.imageUrl === url) ||
        (d.videoJobs || []).some((j) => j.externalJobId === log.externalJobId || j.videoUrl === url))) || null;

    add('Creative', 'Flow', FLOW_NAMES[post.creativeType] || post.creativeType);
    add('Creative', 'Purpose', post.purpose);
    add('Creative', 'Sizes / formats', list(post.mediums));
    add('Creative', 'Sub-brand', post.subBrandName);
    add('Brief', 'Context / notes', post.briefNote);
    add('Brief', 'Key message', b.primaryMessage);
    add('Brief', 'Must include', b.mustInclude);
    add('Brief', 'Must avoid', b.mustAvoid);
    add('Brief', 'Headline', b.headlineText);
    add('Brief', 'Sub-headline', b.includeSubHeadline === false ? '' : b.subHeadlineText);
    add('Brief', 'Headline rendered in the image', b.includeTypography === undefined ? '' : yn(b.includeTypography));
    add('Look & feel', 'Mood', list(b.moodTags));
    add('Look & feel', 'Style references', list(b.styleReferences));
    add('Look & feel', 'Lighting', b.lightingStyle);
    add('Look & feel', 'Composition', b.compositionStyle);
    add('Look & feel', 'Follow brand guidelines', b.followBrand === undefined ? '' : yn(b.followBrand));
    add('Look & feel', 'Use brand style', b.useBrandStyle ? 'Yes' : '');
    add('People', 'People', b.peopleMode && b.peopleMode !== 'auto' ? (b.peopleMode === 'none' ? 'No people' : 'Include people') : '');
    if (b.peopleMode === 'include') {
      add('People', 'How many', b.peopleCount);
      add('People', 'Age', list(b.peopleAge));
      add('People', 'Gender', b.peopleGender);
      add('People', 'Style', b.peopleStyle);
      add('People', 'Ethnicity', b.peopleEthnicity);
      add('People', 'Note', b.peopleNote);
    }
    if (post.creativeType === 'adaptation') {
      add('Edit', 'Keep logo', yn(tp.preserveLogo));
      add('Edit', 'Keep headline', tp.preservePrimaryHeadline === undefined ? '' : yn(tp.preservePrimaryHeadline));
      add('Edit', 'Keep key visual', yn(tp.preserveKeyVisual));
      add('Edit', 'Keep background', yn(tp.preserveBackground));
      add('Edit', 'Keep other text', yn(tp.preserveSecondaryText));
      add('Edit', 'Keep compliance text', yn(tp.preserveComplianceText));
      add('Edit', 'Layout', tp.layoutFlexible ? 'Flexible' : 'Strict');
      add('Edit', 'Change requested', tp.customInstruction);
      if ((tp.protectedRegions || []).length) add('Edit', 'Protected areas', `${tp.protectedRegions.length} drawn on the original`);
    }
    if (isCarousel(post)) add('Creative', 'Slides', b.slideCount);

    const ids = (post.selectedAssets || []).map(String);
    if (ids.length) {
      const assets = await BrandAsset.find({ _id: { $in: ids } }).select('originalName kind filename').lean().catch(() => []);
      const exact = new Set((post.exactAssetIds || []).map(String));
      add('References', 'Brand assets', assets.length
        ? assets.map((a) => `${`${a.originalName || a.filename || 'asset'}${a.kind && a.kind !== 'other' ? ' [' + a.kind + ']' : ''}`}${exact.has(String(a._id)) ? ' (kept exact)' : ''}`).join(', ')
        : `${ids.length} selected`);
    }
    if ((post.referenceCreatives || []).length) {
      add('References', 'Reference creatives', post.referenceCreatives.map((r) => `${r.originalName || r.filename} (${r.mode}${r.exact ? ', exact' : ''})`).join(', '));
    }
    if (design) {
      add('This result', 'Variant', design.label);
      add('This result', 'Creative direction', design.angle);
      add('This result', 'Caption / post copy', design.caption);
      const job = (design.videoJobs || []).find((j) => j.externalJobId === log.externalJobId);
      if (job) {
        add('This result', 'Motion style', job.motionStyle);
        add('This result', 'Video made from', job.sourceMode === 'animate_kv' ? 'The approved image (image-to-video)' : 'A new scene');
        add('This result', 'Animation ideas', list(job.ideaTitles));
        add('This result', 'Feedback applied', job.feedback);
        if (job.requestedSize?.w) add('This result', 'Requested size', `${job.requestedSize.w} × ${job.requestedSize.h}px`);
        if (!prompt && job.prompt) { prompt = job.prompt; promptSource = 'saved on the creative'; }
      }
      if (!prompt) {
        const opt = (design.imageOptions || []).find((o) => o.imageUrl === log.imageUrl);
        const saved = opt?.imagePrompt || (design.imageUrl === log.imageUrl ? design.imagePrompt : '') || design.imagePrompt;
        if (saved) { prompt = saved; promptSource = 'saved on the creative (the brief part only - this generation predates full prompt logging)'; }
      }
    }
  }
  add('Generation', 'Size', log.size);
  add('Generation', 'Quality', log.quality);
  add('Generation', 'Reference images sent', log.referenceImages || '');
  add('Generation', 'Tries', log.attempts > 1 ? log.attempts : '');

  return {
    id: String(log._id),
    type: log.type,
    action: log.action,
    at: log.createdAt,
    user: log.userName || log.userEmail || '',
    customerName: log.customerName || '',
    postTitle: post?.purpose || '',
    imageUrl: log.imageUrl || '',
    videoUrl: log.videoUrl || '',
    referenceFiles: (log.referenceFiles || []).filter((r) => r.url),
    referenceCount: log.referenceImages || 0,
    options,
    prompt,
    promptSource,
    hasPost: Boolean(post)
  };
}

function isCarousel(post) {
  return (post.mediums || []).some((m) => /carousel/i.test(String(m)));
}
