import Customer from '../models/Customer.js';
import User from '../models/User.js';
import Post from '../models/Post.js';
import AiUsageLog from '../models/AiUsageLog.js';
import { unscoped } from '../tenant/context.js';
import { generationUsage } from '../services/customerService.js';

const DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_TREND = 14;

const monthStartOf = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const pct = (used, cap) => (cap ? used / cap : null);

function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * GET /api/admin/dashboard  (agency admins only)
 *
 * One roll-up across every customer for the agency super admin's home page: headline numbers,
 * a per-customer table (people, content, spend, budget, generation caps), a spend trend, top
 * models, a merged recent-activity feed and a list of things that need attention.
 */
export async function agencyDashboard(_req, res, next) {
  try {
    const now = new Date();
    const monthStart = monthStartOf(now);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const trendStart = new Date(now.getTime() - (DAYS_IN_TREND - 1) * DAY);
    trendStart.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * DAY);

    const payload = await unscoped(async () => {
      const customers = await Customer.find({}).sort({ name: 1 }).lean();

      const [usageRows, userRows, postRows, trendRows, modelRows, prevMonthRows, recentPosts, recentUsage, pendingPosts, fallbackRows, generations] =
        await Promise.all([
          AiUsageLog.aggregate([
            {
              $group: {
                _id: '$customer',
                totalCalls: { $sum: 1 },
                totalCostUsd: { $sum: '$estimatedCostUsd' },
                monthCalls: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0] } },
                monthCostUsd: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, '$estimatedCostUsd', 0] } },
                textCalls: { $sum: { $cond: [{ $eq: ['$type', 'text'] }, 1, 0] } },
                imageCalls: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
                videoCalls: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } },
                lastActivityAt: { $max: '$createdAt' }
              }
            }
          ]),
          User.aggregate([
            { $match: { customer: { $ne: null } } },
            {
              $group: {
                _id: '$customer',
                users: { $sum: 1 },
                active: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } },
                admins: { $sum: { $cond: [{ $eq: ['$role', 'customerAdmin'] }, 1, 0] } }
              }
            }
          ]),
          Post.aggregate([
            {
              $group: {
                _id: '$customer',
                posts: { $sum: 1 },
                monthPosts: { $sum: { $cond: [{ $gte: ['$createdAt', monthStart] }, 1, 0] } },
                inReview: { $sum: { $cond: [{ $eq: ['$status', 'in_review'] }, 1, 0] } },
                published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
                lastPostAt: { $max: '$createdAt' }
              }
            }
          ]),
          AiUsageLog.aggregate([
            { $match: { createdAt: { $gte: trendStart } } },
            {
              $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, type: '$type' },
                costUsd: { $sum: '$estimatedCostUsd' },
                calls: { $sum: 1 }
              }
            }
          ]),
          AiUsageLog.aggregate([
            { $match: { createdAt: { $gte: monthStart } } },
            {
              $group: {
                _id: { type: '$type', provider: '$provider', model: '$model' },
                calls: { $sum: 1 },
                costUsd: { $sum: '$estimatedCostUsd' }
              }
            },
            { $sort: { costUsd: -1 } },
            { $limit: 6 }
          ]),
          AiUsageLog.aggregate([
            { $match: { createdAt: { $gte: prevMonthStart, $lt: monthStart } } },
            { $group: { _id: null, costUsd: { $sum: '$estimatedCostUsd' }, calls: { $sum: 1 } } }
          ]),
          Post.find({}).sort({ createdAt: -1 }).limit(15).select('user customer status purpose mediums creativeType createdAt').populate('user', 'name email').lean(),
          AiUsageLog.find({}).sort({ createdAt: -1 }).limit(25).select('customer customerName userName userEmail type action provider model estimatedCostUsd createdAt').lean(),
          Post.find({ status: 'in_review' }).sort({ 'approval.requestedAt': 1, createdAt: 1 }).limit(8).select('user customer purpose mediums approval createdAt').populate('user', 'name').lean(),
          AiUsageLog.aggregate([
            { $match: { provider: 'placeholder', createdAt: { $gte: weekAgo } } },
            { $group: { _id: '$customer', n: { $sum: 1 } } }
          ]),
          Promise.all(customers.map((c) => generationUsage(c).catch(() => null)))
        ]);

      const byId = (rows, key = '_id') => new Map(rows.map((r) => [String(r[key]), r]));
      const usageBy = byId(usageRows);
      const usersBy = byId(userRows);
      const postsBy = byId(postRows);
      const fallbackBy = byId(fallbackRows);
      const nameOf = new Map(customers.map((c) => [String(c._id), c.name]));

      // ---- per customer ------------------------------------------------------------------------
      const rows = customers.map((c, i) => {
        const id = String(c._id);
        const u = usageBy.get(id) || {};
        const us = usersBy.get(id) || {};
        const p = postsBy.get(id) || {};
        const gen = generations[i];
        const budget = c.budget?.monthlyUsd ?? null;
        const lastActivityAt = [u.lastActivityAt, p.lastPostAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
        return {
          id,
          name: c.name,
          slug: c.slug,
          status: c.status,
          industry: c.industry,
          createdAt: c.createdAt,
          users: us.users || 0,
          activeUsers: us.active || 0,
          customerAdmins: us.admins || 0,
          posts: p.posts || 0,
          monthPosts: p.monthPosts || 0,
          inReview: p.inReview || 0,
          published: p.published || 0,
          monthCostUsd: u.monthCostUsd || 0,
          totalCostUsd: u.totalCostUsd || 0,
          monthCalls: u.monthCalls || 0,
          totalCalls: u.totalCalls || 0,
          textCalls: u.textCalls || 0,
          imageCalls: u.imageCalls || 0,
          videoCalls: u.videoCalls || 0,
          budget: { monthlyUsd: budget, enforce: Boolean(c.budget?.enforce), used: pct(u.monthCostUsd || 0, budget) },
          generation: gen && {
            cycleStart: gen.cycleStart,
            cycleEnd: gen.cycleEnd,
            images: gen.images,
            videos: gen.videos
          },
          delivery: { mode: c.delivery?.mode || 'none', lastDeliveredAt: c.delivery?.lastDeliveredAt || null, lastError: c.delivery?.lastError || '' },
          placeholderCalls7d: fallbackBy.get(id)?.n || 0,
          lastActivityAt
        };
      });

      // ---- headline numbers --------------------------------------------------------------------
      const sum = (fn) => rows.reduce((t, r) => t + fn(r), 0);
      const monthCostUsd = sum((r) => r.monthCostUsd);
      const prevCost = prevMonthRows[0]?.costUsd || 0;
      const kpis = {
        customers: { total: rows.length, active: rows.filter((r) => r.status === 'active').length, suspended: rows.filter((r) => r.status === 'suspended').length, archived: rows.filter((r) => r.status === 'archived').length },
        users: { total: sum((r) => r.users), active: sum((r) => r.activeUsers) },
        posts: { month: sum((r) => r.monthPosts), total: sum((r) => r.posts), inReview: sum((r) => r.inReview), published: sum((r) => r.published) },
        spend: {
          monthUsd: monthCostUsd,
          prevMonthUsd: prevCost,
          totalUsd: sum((r) => r.totalCostUsd),
          budgetUsd: sum((r) => r.budget.monthlyUsd || 0),
          budgetedCustomers: rows.filter((r) => r.budget.monthlyUsd != null).length
        },
        generations: {
          monthCalls: sum((r) => r.monthCalls),
          images: sum((r) => r.generation?.images.used || 0),
          videos: sum((r) => r.generation?.videos.used || 0)
        }
      };

      // ---- spend trend (UTC days, zero-filled) ------------------------------------------------
      const trend = [];
      for (let i = 0; i < DAYS_IN_TREND; i += 1) {
        const key = dayKey(trendStart.getTime() + i * DAY);
        trend.push({ day: key, text: 0, image: 0, video: 0, total: 0, calls: 0 });
      }
      const trendByDay = new Map(trend.map((t) => [t.day, t]));
      for (const r of trendRows) {
        const t = trendByDay.get(r._id.day);
        if (!t) continue;
        if (t[r._id.type] !== undefined) t[r._id.type] += r.costUsd;
        t.total += r.costUsd;
        t.calls += r.calls;
      }

      const topModels = modelRows.map((m) => ({ ...m._id, calls: m.calls, costUsd: m.costUsd }));

      // ---- recent activity (posts + AI generations, newest first) ----------------------------
      const activity = [
        ...recentPosts.map((p) => ({
          kind: 'post',
          at: p.createdAt,
          customerId: p.customer ? String(p.customer) : null,
          customerName: nameOf.get(String(p.customer)) || '',
          who: p.user?.name || p.user?.email || 'Unknown user',
          title: `Created a ${p.creativeType === 'new' ? '' : `${p.creativeType} `}post${p.purpose ? ` - ${p.purpose}` : ''}`,
          detail: (p.mediums || []).join(', '),
          status: p.status
        })),
        ...recentUsage.map((l) => ({
          kind: 'ai',
          at: l.createdAt,
          customerId: l.customer ? String(l.customer) : null,
          customerName: nameOf.get(String(l.customer)) || l.customerName || '',
          who: l.userName || l.userEmail || 'System',
          title: `${l.type} generation - ${String(l.action || '').replace(/_/g, ' ')}`,
          detail: [l.provider, l.model].filter(Boolean).join(' / '),
          type: l.type,
          costUsd: l.estimatedCostUsd || 0
        }))
      ]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 40);

      const pendingApprovals = pendingPosts.map((p) => ({
        id: String(p._id),
        customerId: p.customer ? String(p.customer) : null,
        customerName: nameOf.get(String(p.customer)) || '',
        who: p.user?.name || '',
        purpose: p.purpose || '',
        approver: p.approval?.approverName || '',
        since: p.approval?.requestedAt || p.createdAt
      }));

      // ---- things that need attention ----------------------------------------------------------
      const alerts = [];
      const add = (severity, customer, title, detail) => alerts.push({ severity, customerId: customer.id, customerName: customer.name, title, detail });
      for (const r of rows) {
        if (r.status === 'archived') continue;
        const b = r.budget;
        if (b.monthlyUsd != null && b.used != null) {
          if (b.used >= 1) add('high', r, 'Over monthly budget', `${Math.round(b.used * 100)}% of the cap used${b.enforce ? ' - generation is blocked' : ' - not enforced, spend keeps growing'}`);
          else if (b.used >= 0.8) add('medium', r, 'Close to monthly budget', `${Math.round(b.used * 100)}% of the cap used`);
        }
        for (const [label, g] of [['image', r.generation?.images], ['video', r.generation?.videos]]) {
          if (!g || g.limit == null) continue;
          if (g.used >= g.limit) add('high', r, `${label[0].toUpperCase()}${label.slice(1)} limit reached`, `${g.used} of ${g.limit} ${label}s used this cycle`);
          else if (g.limit > 0 && g.used / g.limit >= 0.8) add('medium', r, `${label[0].toUpperCase()}${label.slice(1)} limit nearly reached`, `${g.used} of ${g.limit} ${label}s used this cycle`);
        }
        if (r.delivery.lastError) add('medium', r, 'Last delivery failed', r.delivery.lastError.slice(0, 160));
        if (r.placeholderCalls7d > 0) add('medium', r, 'Generations falling back to placeholders', `${r.placeholderCalls7d} placeholder call(s) in the last 7 days - a provider key may be missing`);
        if (r.status === 'active' && r.users === 0) add('low', r, 'No users yet', 'This customer has no team members');
        else if (r.status === 'active' && (!r.lastActivityAt || now - new Date(r.lastActivityAt) > 14 * DAY)) add('low', r, 'No recent activity', r.lastActivityAt ? `Last activity ${Math.floor((now - new Date(r.lastActivityAt)) / DAY)} days ago` : 'Nothing has been generated yet');
        if (r.status === 'suspended') add('low', r, 'Workspace suspended', 'Users of this customer cannot sign in');
      }
      for (const p of pendingApprovals) {
        if (now - new Date(p.since) > 3 * DAY) {
          alerts.push({ severity: 'low', customerId: p.customerId, customerName: p.customerName, title: 'Approval waiting over 3 days', detail: `${p.purpose || 'Post'}${p.approver ? ` - waiting on ${p.approver}` : ''}` });
        }
      }
      const rank = { high: 0, medium: 1, low: 2 };
      alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

      return { generatedAt: now, kpis, customers: rows, trend, topModels, activity, pendingApprovals, alerts };
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

const GALLERY_SOURCE = { new: 'New Creative', adaptation: 'Creative Edit', headline: 'Headline Switch', hero: 'Subject Swap', resize: 'Size Adapt', convert: 'Convert to Video', multiscene: 'Multi-scene video' };

/**
 * GET /api/admin/dashboard/gallery  (agency admins only)
 * The latest images and videos generated across every customer, newest first (up to 96), for the super admin's landing page.
 * Each item: { id, type: 'image'|'video', url, title, source, customerId, customerName, at }.
 */
export async function agencyGallery(_req, res, next) {
  try {
    const items = await unscoped(async () => {
      const [posts, customers] = await Promise.all([
        Post.find({}).sort({ updatedAt: -1 }).limit(120).select('customer designs creativeType createdAt updatedAt').lean(),
        Customer.find({}).select('name').lean()
      ]);
      const names = new Map(customers.map((c) => [String(c._id), c.name]));
      const seen = new Set();
      const out = [];
      for (const post of posts) {
        const source = GALLERY_SOURCE[post.creativeType] || 'Creative';
        const at = post.updatedAt || post.createdAt;
        const add = (type, url, d) => {
          if (!url || seen.has(url)) return;
          seen.add(url);
          out.push({
            id: `${post._id}:${out.length}`,
            type,
            url,
            title: String(d.headlineText || d.directionTitle || d.label || source).slice(0, 80),
            source,
            customerId: String(post.customer || ''),
            customerName: names.get(String(post.customer)) || '',
            at
          });
        };
        for (const d of post.designs || []) {
          add('image', d.imageUrl, d);
          // Every design option that was generated, including the ones nobody picked (the picked one is d.imageUrl above, so it leads).
          for (const o of d.imageOptions || []) add('image', o?.imageUrl, d);
          for (const s of d.carouselSlides || []) add('image', s.imageUrl, d);
          for (const v of d.formatVariants || []) if (v.status !== 'pending' && v.status !== 'failed') add('image', v.imageUrl, d);
          for (const j of d.videoJobs || []) if (j.status === 'completed') add('video', j.videoUrl, d);
        }
      }
      return out.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 96);
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
