import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import Customer, { CUSTOMER_STATUSES, DELIVERY_MODES, cleanDesignOptions } from '../models/Customer.js';
import User, { DEFAULT_MEMBER_PERMISSIONS } from '../models/User.js';
import { createCustomer, usageByCustomer, monthSpendUsd, ensureCustomerFolders, generationUsage, billingCycle, customerCycle } from '../services/customerService.js';
import { assertSafeWebhookUrl, testDelivery } from '../services/deliveryService.js';
import { storageInfo, storageUsedBytes, DEFAULT_STORAGE_MB } from '../utils/storage.js';
import { emailConfigured, sendWelcomeEmail } from '../services/emailService.js';
import { unscoped } from '../tenant/context.js';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import { createBackup, listBackups, backupPath, backupDir, deleteBackupFile, purgeCustomer, importBackup, customerCounts } from '../services/customerBackupService.js';

const tempPassword = () => crypto.randomBytes(6).toString('hex').match(/.{1,4}/g).join('-');
// Sends the welcome email without ever failing the request: the account already exists, so
// the caller reports the outcome ({ requested, sent, error }) and the admin can share the
// password another way.
async function inviteByEmail({ user, customer, password }) {
  try {
    await sendWelcomeEmail({ to: user.email, name: user.name, customerName: customer.name, role: user.role, password });
    return { requested: true, sent: true };
  } catch (err) {
    console.error('[email] welcome email failed:', err.message);
    return { requested: true, sent: false, error: err.message };
  }
}

const fail = (res, err, next) => (err.status ? res.status(err.status).json({ error: err.message }) : err.code === 11000 ? res.status(409).json({ error: 'That value is already in use.' }) : next(err));

// null / '' = unlimited; otherwise a whole number >= 0.
function parseLimits(limits) {
  const out = {};
  for (const key of ['imagesPerMonth', 'videosPerMonth', 'imageGenerationsPerMonth', 'videoGenerationsPerMonth', 'storageMb']) {
    if (!(key in limits)) continue;
    const v = limits[key];
    if (key === 'storageMb') {
      if (v === null || v === '' || v === undefined) out[key] = DEFAULT_STORAGE_MB;
      else if (Number.isFinite(Number(v)) && Number(v) >= 1) out[key] = Math.round(Number(v));
      else return { error: 'Storage must be at least 1 MB (or empty for the 1 GB default).' };
      continue;
    }
    if (v === null || v === '' || v === undefined) out[key] = null;
    else if (Number.isInteger(Number(v)) && Number(v) >= 0) out[key] = Number(v);
    else return { error: 'Monthly image / video limits must be whole numbers (or empty for no limit).' };
  }
  return out;
}

const LIMIT_LABELS = {
  imageGenerationsPerMonth: 'Customer generations: images',
  videoGenerationsPerMonth: 'Customer generations: videos',
  imagesPerMonth: 'AI images (enforced)',
  videosPerMonth: 'AI videos (enforced)',
  storageMb: 'Storage (MB)'
};

/** Applies the parsed limits to the customer and writes what changed (old -> new) to the limits history. Caller saves. */
function applyLimits(customer, parsed, req, note = '') {
  const changes = [];
  for (const key of Object.keys(LIMIT_LABELS)) {
    if (!(key in parsed)) continue;
    const from = customer.limits?.[key] ?? null;
    const to = parsed[key] ?? null;
    if (from === to) continue;
    customer.limits[key] = to;
    changes.push({ field: key, from, to });
  }
  if (changes.length) {
    customer.limitChanges.push({ at: new Date(), by: req.user._id, byName: req.user.name || req.user.email || '', note: String(note || '').trim().slice(0, 200), changes });
  }
  return changes;
}

async function counts(customerId) {
  return unscoped(async () => {
    const [users, posts, assets] = await Promise.all([
      User.countDocuments({ customer: customerId }),
      Post.countDocuments({ customer: customerId }),
      BrandAsset.countDocuments({ customer: customerId })
    ]);
    return { users, posts, assets };
  });
}

// ------------------------------------------------------------------ agency-only

/** GET /api/admin/customers - every customer with headcount, content and this month's spend. */
export async function listCustomers(_req, res, next) {
  try {
    const [customers, usage] = await Promise.all([Customer.find({}).sort({ name: 1 }), usageByCustomer()]);
    const usageById = new Map(usage.map((u) => [String(u.customer.id), u]));
    const rows = await Promise.all(
      customers.map(async (c) => ({
        ...c.toPublicJSON(),
        topUps: (c.topUps || []).slice(-5).reverse().map((t) => ({ kind: t.kind, amount: t.amount, note: t.note, byName: t.byName, at: t.at })),
        counts: await counts(c._id),
        generation: await generationUsage(c, { cards: true }),
        storageUsage: (() => {
          const mb = Number.isFinite(c.limits?.storageMb) ? c.limits.storageMb : DEFAULT_STORAGE_MB;
          return { usedBytes: storageUsedBytes({ customer: c }), limitBytes: mb * 1024 * 1024 };
        })(),
        monthCostUsd: usageById.get(String(c._id))?.monthCostUsd || 0,
        totalCostUsd: usageById.get(String(c._id))?.totalCostUsd || 0
      }))
    );
    res.json({ customers: rows, storage: storageInfo(), email: { configured: emailConfigured() } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/customers/usage - per-customer usage roll-up. */
export async function customersUsage(_req, res, next) {
  try {
    res.json({ customers: await usageByCustomer() });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/customers
 * { name, slug?, industry?, country?, notes?, admin?: { name, email, password? } }
 * Creates the customer, its storage folder, and (optionally) its first customer admin.
 */
export async function createCustomerHandler(req, res, next) {
  try {
    const { name, slug, industry, country, notes, admin, limits, sendInvite, plan, features } = req.body;
    const parsedLimits = limits ? parseLimits(limits) : undefined;
    if (parsedLimits?.error) return res.status(400).json({ error: parsedLimits.error });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Customer name is required.' });

    if (admin?.email) {
      if (!admin.name) return res.status(400).json({ error: 'The customer admin needs a name.' });
      if (await User.exists({ email: String(admin.email).toLowerCase() })) {
        return res.status(409).json({ error: 'A user with that admin email already exists.' });
      }
    }

    const customer = await createCustomer({ name, slug, industry, country, notes, limits: parsedLimits, plan, features });
    let adminUser = null;
    let temporaryPassword;
    let invite;
    if (admin?.email) {
      temporaryPassword = admin.password ? undefined : tempPassword();
      adminUser = await User.create({
        name: admin.name,
        email: String(admin.email).toLowerCase(),
        passwordHash: await bcrypt.hash(admin.password || temporaryPassword, 10),
        role: 'customerAdmin',
        customer: customer._id,
        permissions: { ...DEFAULT_MEMBER_PERMISSIONS, manageTeam: true, manageIndustries: false },
        company: { name: customer.name, industry: customer.industry }
      });
      if (sendInvite) invite = await inviteByEmail({ user: adminUser, customer, password: admin.password || temporaryPassword });
    }
    res.status(201).json({ customer: customer.toPublicJSON(), admin: adminUser?.toSafeJSON(), temporaryPassword, invite });
  } catch (err) {
    fail(res, err, next);
  }
}

/**
 * POST /api/admin/customers/:id/users
 * { name, email, role?: 'customerAdmin' | 'member', password? }
 * Adds a user to the customer. Without a password a temporary one is generated and returned once.
 */
export async function createCustomerUser(req, res, next) {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const { name, email, role = 'customerAdmin', password, sendInvite } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    const cleanEmail = String(email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!['customerAdmin', 'member'].includes(role)) return res.status(400).json({ error: 'Role must be customerAdmin or member.' });
    if (password && String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (await User.exists({ email: cleanEmail })) return res.status(409).json({ error: 'A user with that email already exists.' });

    const temporaryPassword = password ? undefined : tempPassword();
    const user = await User.create({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash: await bcrypt.hash(password || temporaryPassword, 10),
      role,
      customer: customer._id,
      permissions: role === 'customerAdmin' ? { ...DEFAULT_MEMBER_PERMISSIONS, manageTeam: true, manageIndustries: false } : { ...DEFAULT_MEMBER_PERMISSIONS },
      company: { name: customer.name, industry: customer.industry }
    });
    const invite = sendInvite ? await inviteByEmail({ user, customer, password: password || temporaryPassword }) : undefined;
    res.status(201).json({ user: user.toSafeJSON(customer), temporaryPassword, invite });
  } catch (err) {
    fail(res, err, next);
  }
}

/**
 * POST /api/admin/customers/:id/top-up   { images?: n, videos?: n, note?: string }
 * Superadmin only. Adds extra image / video generations to this customer's current month. The
 * extra amount is added on top of the monthly limit and lapses when the cycle renews. Only
 * makes sense for a capped allowance (an unlimited one has nothing to top up).
 */
/**
 * GET /api/admin/customers/:id/top-ups - the full top-up ledger, newest first.
 * `active` = granted in the current billing cycle (so it still counts towards the allowance); older ones have lapsed.
 */
export async function topUpHistoryHandler(req, res, next) {
  try {
    const customer = await unscoped(() => Customer.findById(req.params.id).select('name createdAt topUps plan').lean());
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const cycle = customerCycle(customer);
    const entries = (customer.topUps || [])
      .map((t) => ({ id: String(t._id), kind: t.kind, amount: t.amount, note: t.note || '', byName: t.byName || '', at: t.at, active: new Date(t.at) >= cycle.start && new Date(t.at) < cycle.end }))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const sum = (kind, onlyActive) => entries.filter((e) => e.kind === kind && (!onlyActive || e.active)).reduce((n, e) => n + e.amount, 0);
    res.json({
      customerName: customer.name,
      cycle: { start: cycle.start, end: cycle.oneTime ? null : cycle.end, oneTime: cycle.oneTime },
      entries,
      totals: { images: sum('image'), videos: sum('video'), thisCycle: { images: sum('image', true), videos: sum('video', true) } }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/customers/:id/limits - set the four generation limits (customer generations and real AI generations, images and
 * videos). Empty = no figure / unlimited. Only the fields sent change, and every change is written to the limits history.
 */
export async function modifyLimits(req, res, next) {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const body = req.body || {};
    const pick = {};
    for (const k of ['imageGenerationsPerMonth', 'videoGenerationsPerMonth', 'imagesPerMonth', 'videosPerMonth']) if (k in body) pick[k] = body[k];
    const parsed = parseLimits(pick);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const changes = applyLimits(customer, parsed, req, body.note);
    if (!changes.length) return res.status(400).json({ error: 'Nothing changed. Edit at least one limit first.' });
    await customer.save();
    res.json({
      customer: customer.toPublicJSON(),
      generation: await generationUsage(customer, { cards: true }),
      changes: changes.map((c) => ({ label: LIMIT_LABELS[c.field], from: c.from, to: c.to }))
    });
  } catch (err) {
    fail(res, err, next);
  }
}

/** GET /api/admin/customers/:id/limits-history - limit changes plus earlier top-ups, newest first. */
export async function limitsHistoryHandler(req, res, next) {
  try {
    const customer = await unscoped(() => Customer.findById(req.params.id).select('name limitChanges topUps').lean());
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const entries = [
      ...(customer.limitChanges || []).map((e) => ({
        id: String(e._id), type: 'change', at: e.at, byName: e.byName || '', note: e.note || '',
        changes: (e.changes || []).map((c) => ({ label: LIMIT_LABELS[c.field] || c.field, from: c.from ?? null, to: c.to ?? null }))
      })),
      ...(customer.topUps || []).map((t) => ({
        id: String(t._id), type: 'topup', at: t.at, byName: t.byName || '', note: t.note || '',
        changes: [{ label: `${t.kind === 'video' ? 'AI videos' : 'AI images'} top-up (this month only)`, add: t.amount }]
      }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ customerName: customer.name, entries });
  } catch (err) {
    next(err);
  }
}

export async function topUpCustomer(req, res, next) {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const entries = [];
    for (const [field, kind, limitKey] of [['images', 'image', 'imagesPerMonth'], ['videos', 'video', 'videosPerMonth']]) {
      const raw = req.body?.[field];
      if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) continue;
      const amount = Number(raw);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
        return res.status(400).json({ error: `Top-up ${field} must be a whole number between 1 and 10,000.` });
      }
      if (customer.limits?.[limitKey] === null || customer.limits?.[limitKey] === undefined) {
        return res.status(400).json({ error: `${customer.name} has unlimited ${field} - set a monthly limit first, then top it up.` });
      }
      entries.push({ kind, amount });
    }
    if (!entries.length) return res.status(400).json({ error: 'Enter how many images and/or videos to add.' });

    const note = String(req.body?.note || '').trim().slice(0, 200);
    const at = new Date();
    // Atomic push so a concurrent edit of the customer can't overwrite the ledger.
    const updated = await Customer.findByIdAndUpdate(
      customer._id,
      { $push: { topUps: { $each: entries.map((e) => ({ ...e, note, by: req.user._id, byName: req.user.name || req.user.email || '', at })) } } },
      { new: true }
    );
    res.status(201).json({ customer: updated.toPublicJSON(), generation: await generationUsage(updated, { cards: true }) });
  } catch (err) {
    fail(res, err, next);
  }
}

/** PATCH /api/admin/customers/:id - name, status, industry, notes, budget (agency only). */
export async function updateCustomerHandler(req, res, next) {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const { name, status, industry, country, notes, budget, limits, plan, features } = req.body;
    if (limits) {
      const p = parseLimits(limits);
      if (p.error) return res.status(400).json({ error: p.error });
      applyLimits(customer, p, req);
    }

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
      customer.name = String(name).trim();
    }
    if (status !== undefined) {
      if (!CUSTOMER_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${CUSTOMER_STATUSES.join(', ')}` });
      customer.status = status;
    }
    if (plan !== undefined) {
      // Switching plan starts a fresh period: a new one-time package counts from today; back to Monthly clears the start date.
      const type = plan === 'one_time' ? 'one_time' : 'monthly';
      if (customer.plan?.type !== type) customer.plan = { type, startsAt: type === 'one_time' ? new Date() : null };
    }
    if (features && typeof features === 'object') {
      for (const k of ['billboards', 'multiSceneVideo', 'preciseFontText']) if (features[k] !== undefined) customer.features[k] = Boolean(features[k]);
      if (features.designOptions !== undefined) customer.features.designOptions = cleanDesignOptions(features.designOptions);
    }
    if (industry !== undefined) customer.industry = industry;
    if (country !== undefined) customer.country = String(country || '').trim().slice(0, 80);
    if (notes !== undefined) customer.notes = String(notes).slice(0, 2000);
    if (budget !== undefined) {
      const m = budget.monthlyUsd;
      if (m === null || m === '' || m === undefined) customer.budget.monthlyUsd = null;
      else if (Number.isFinite(Number(m)) && Number(m) >= 0) customer.budget.monthlyUsd = Number(m);
      else return res.status(400).json({ error: 'Monthly budget must be a number of dollars (or empty for no limit).' });
      if (budget.enforce !== undefined) customer.budget.enforce = Boolean(budget.enforce);
    }
    await customer.save();
    res.json({ customer: customer.toPublicJSON() });
  } catch (err) {
    fail(res, err, next);
  }
}

// -------------------------------------------- the active customer (agency or its own admin)

async function currentView(customer) {
  return {
    customer: customer.toPublicJSON(),
    counts: await counts(customer._id),
    generation: await generationUsage(customer, { cards: true }),
    monthCostUsd: await monthSpendUsd(customer._id),
    storage: {
      folder: customer.storage.folder,
      path: `customers/${customer.storage.folder}`,
      deliveryPath: `customers/${customer.storage.folder}/${customer.delivery.subfolder || 'delivered'}`,
      ...(({ source, persistent, writable }) => ({ source, persistent, writable }))(storageInfo())
    },
    deliveryModes: DELIVERY_MODES
  };
}

/** GET /api/admin/customer */
export async function getCurrentCustomer(req, res, next) {
  try {
    if (!req.customer) return res.status(400).json({ error: 'Pick a customer first.' });
    res.json(await currentView(req.customer));
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/customer
 * { name?, delivery?: { mode, autoOnPublish, subfolder, webhookUrl, webhookSecret?, clearWebhookSecret? } }
 * The customer's own admin may change its display name and delivery destination. Everything
 * else (budget, status, folder) stays with the agency.
 */
export async function updateCurrentCustomer(req, res, next) {
  try {
    const customer = await Customer.findById(req.customer?._id);
    if (!customer) return res.status(400).json({ error: 'Pick a customer first.' });
    const { name, delivery, industry } = req.body;

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
      customer.name = String(name).trim();
    }
    if (industry !== undefined && industry) customer.industry = industry;

    if (delivery) {
      const d = customer.delivery;
      if (delivery.mode !== undefined) {
        if (!DELIVERY_MODES.includes(delivery.mode)) return res.status(400).json({ error: `Delivery mode must be one of: ${DELIVERY_MODES.join(', ')}` });
        d.mode = delivery.mode;
      }
      if (delivery.autoOnPublish !== undefined) d.autoOnPublish = Boolean(delivery.autoOnPublish);
      if (delivery.subfolder !== undefined) {
        const sub = String(delivery.subfolder).trim() || 'delivered';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(sub)) return res.status(400).json({ error: 'Delivery subfolder may only contain letters, numbers, dashes and underscores.' });
        d.subfolder = sub;
      }
      if (delivery.webhookUrl !== undefined) {
        const url = String(delivery.webhookUrl).trim();
        if (url) await assertSafeWebhookUrl(url);
        d.webhookUrl = url;
      }
      if (delivery.clearWebhookSecret) d.webhookSecret = '';
      else if (delivery.webhookSecret) d.webhookSecret = String(delivery.webhookSecret).slice(0, 200);
      if (d.mode === 'webhook' && !d.webhookUrl) return res.status(400).json({ error: 'Enter the webhook URL to deliver to.' });
    }
    await customer.save();
    ensureCustomerFolders(customer);
    res.json(await currentView(customer));
  } catch (err) {
    fail(res, err, next);
  }
}

/** POST /api/admin/customer/delivery/test */
export async function testCurrentDelivery(req, res, next) {
  try {
    if (!req.customer) return res.status(400).json({ error: 'Pick a customer first.' });
    res.json(await testDelivery(await Customer.findById(req.customer._id)));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(502).json({ error: `Test failed: ${err.message}` });
  }
}

// ------------------------------------------------------------------ backup / delete / import (agency-only)

const who = (req) => req.user?.email || req.user?.name || '';

/** POST /api/admin/customers/:id/backup - writes a backup zip on the server; download it with GET /customer-backups/:file. */
export async function backupCustomerHandler(req, res, next) {
  try {
    const { file, bytes, manifest } = await createBackup(req.params.id, { by: who(req) });
    res.status(201).json({ backup: { file, bytes, createdAt: manifest.createdAt, counts: manifest.counts, files: manifest.files } });
  } catch (err) {
    fail(res, err, next);
  }
}

/**
 * DELETE /api/admin/customers/:id   { confirmName, backup?: boolean (default true) }
 * Permanently removes the customer, its users, posts, brand assets, usage log, reels, runs and files.
 * With backup the zip is written FIRST and nothing is deleted if that fails. Agency admins are never deleted,
 * only detached from the customer.
 */
export async function deleteCustomerHandler(req, res, next) {
  try {
    const customer = await unscoped(() => Customer.findById(req.params.id));
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    if (String(req.body?.confirmName || '').trim() !== customer.name.trim()) {
      return res.status(400).json({ error: 'Type the customer name exactly to confirm.' });
    }
    if ((await unscoped(() => Customer.countDocuments({}))) <= 1) {
      return res.status(400).json({ error: 'This is the only customer, so it cannot be deleted.' });
    }
    let backup = null;
    if (req.body?.backup !== false) {
      const made = await createBackup(customer._id, { by: who(req) });
      backup = { file: made.file, bytes: made.bytes, counts: made.manifest.counts, files: made.manifest.files };
    }
    await purgeCustomer(customer._id);
    res.json({ deleted: true, name: customer.name, backup });
  } catch (err) {
    fail(res, err, next);
  }
}

/** GET /api/admin/customers/:id/counts - what a delete would remove (for the confirmation dialog). */
export async function customerCountsHandler(req, res, next) {
  try {
    res.json({ counts: await customerCounts(req.params.id) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/customer-backups */
export function listBackupsHandler(_req, res, next) {
  try {
    res.json({ backups: listBackups(), dir: backupDir() });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/customer-backups/:file - download */
export function downloadBackupHandler(req, res, next) {
  try {
    const abs = backupPath(req.params.file);
    res.download(abs, req.params.file);
  } catch (err) {
    fail(res, err, next);
  }
}

/** DELETE /api/admin/customer-backups/:file */
export function deleteBackupHandler(req, res, next) {
  try {
    deleteBackupFile(req.params.file);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, next);
  }
}

/** POST /api/admin/customer-backups/:file/import - restore a backup already saved on the server. */
export async function importSavedBackupHandler(req, res, next) {
  try {
    res.status(201).json(await importBackup(backupPath(req.params.file), { slug: req.body?.slug }));
  } catch (err) {
    fail(res, err, next);
  }
}

const incoming = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { const d = path.join(backupDir(), 'incoming'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.zip`)
  }),
  limits: { fileSize: (Number(process.env.MAX_BACKUP_UPLOAD_MB) || 4096) * 1024 * 1024 }
});
export const uploadBackupFile = incoming.single('file');

/** POST /api/admin/customer-backups/import (multipart: file, slug?) - restore from an uploaded backup zip. */
export async function importUploadedBackupHandler(req, res, next) {
  const tmp = req.file?.path;
  try {
    if (!tmp) return res.status(400).json({ error: 'Choose a backup .zip to import.' });
    res.status(201).json(await importBackup(tmp, { slug: req.body?.slug }));
  } catch (err) {
    fail(res, err, next);
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
  }
}
