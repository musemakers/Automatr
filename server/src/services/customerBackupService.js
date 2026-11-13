import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import mongoose from 'mongoose';
import Customer, { SLUG_RE } from '../models/Customer.js';
import User from '../models/User.js';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import AiUsageLog from '../models/AiUsageLog.js';
import MultiSceneJob from '../models/MultiSceneJob.js';
import CustomFeatureRun from '../models/CustomFeatureRun.js';
import CustomFeature from '../models/CustomFeature.js';
import AiPipeline from '../models/AiPipeline.js';
import { uploadRoot } from '../utils/storage.js';
import { unscoped } from '../tenant/context.js';
import { APP_VERSION } from '../version.js';

// CUSTOMER BACKUP / RESTORE / DELETE
//
// A backup is ONE .zip:
//
//   manifest.json      format + version, who/when, counts, file totals, and a `schema` section (the field names of
//                      every collection at backup time) so a future import can tell if the data shape has moved on
//   customer.json      the customer record (brand kit, competitors, social connections, settings, budget, ...)
//   users.json         the customer's users (NOT agency admins - those belong to the agency)
//   posts.json, brandAssets.json, aiUsage.json, multiSceneJobs.json, customFeatureRuns.json, aiPipelines.json
//   files/customer/…   everything in the customer's storage folder (uploads/customers/<folder>/…)
//   files/root/…       older files from before multi-customer that this customer's data points at (uploads/<file>)
//
// The .json files are MongoDB Extended JSON (exact ObjectIds and dates), so an import puts the same ids back and
// every link between posts, users and assets keeps working.
//
// SECURITY: users.json holds password hashes and customer.json holds webhook / social tokens. Treat the zip like a
// database dump - keep it private.

export const BACKUP_FORMAT = 'automatr-customer-backup';
export const BACKUP_VERSION = 1;

const { EJSON } = mongoose.mongo.BSON;
const ejson = (v) => EJSON.stringify(v, { relaxed: false });

// key = file name inside the zip + key in the manifest. users are listed first so a restore can skip clashes early.
const COLLECTIONS = [
  { key: 'users', model: User, filter: (id) => ({ customer: id, role: { $ne: 'admin' } }) },
  { key: 'posts', model: Post, filter: (id) => ({ customer: id }) },
  { key: 'brandAssets', model: BrandAsset, filter: (id) => ({ customer: id }) },
  { key: 'aiUsage', model: AiUsageLog, filter: (id) => ({ customer: id }) },
  { key: 'multiSceneJobs', model: MultiSceneJob, filter: (id) => ({ customer: id }) },
  { key: 'customFeatureRuns', model: CustomFeatureRun, filter: (id) => ({ customer: id }) },
  { key: 'aiPipelines', model: AiPipeline, filter: (id) => ({ customer: id }) }
];

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Where backups are kept on the server. BACKUP_DIR, else a "backups" folder next to the uploads folder (same volume). */
export function backupDir() {
  const dir = process.env.BACKUP_DIR ? path.resolve(process.cwd(), process.env.BACKUP_DIR) : path.join(path.dirname(uploadRoot), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const BACKUP_FILE_RE = /^[a-z0-9][a-z0-9._-]*\.zip$/i;
export function backupPath(file) {
  if (!BACKUP_FILE_RE.test(String(file || ''))) throw fail(400, 'Invalid backup file name.');
  const abs = path.join(backupDir(), file);
  if (!fs.existsSync(abs)) throw fail(404, 'That backup was not found.');
  return abs;
}

const within = (base, target) => {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const customerFolderPath = (folder) => (SLUG_RE.test(String(folder || '')) ? path.join(uploadRoot, 'customers', folder) : null);

function walkFiles(dir, base = dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(abs, base, out);
    else if (e.isFile()) out.push({ abs, rel: path.relative(base, abs).split(path.sep).join('/'), size: fs.statSync(abs).size });
  }
  return out;
}

/** Old-style files (uploads/<file>) that the customer's data points at - they are outside the customer's folder. */
function legacyRefs(text) {
  const found = new Set();
  for (const m of text.matchAll(/\/uploads\/(?!customers\/)([^\s"'<>)\\?#]+)/g)) found.add(decodeURIComponent(m[1]));
  const files = [];
  for (const name of found) {
    const abs = path.join(uploadRoot, name);
    if (within(uploadRoot, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) files.push({ abs, rel: name.split(path.sep).join('/'), size: fs.statSync(abs).size });
  }
  return files;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/** Row counts for one customer (used by the delete confirmation and the manifest). */
export async function customerCounts(customerId) {
  return unscoped(async () => {
    const out = {};
    await Promise.all(COLLECTIONS.map(async (c) => { out[c.key] = await c.model.countDocuments(c.filter(customerId)); }));
    const folder = customerFolderPath((await Customer.findById(customerId).select('storage').lean())?.storage?.folder);
    const files = walkFiles(folder);
    out.files = files.length;
    out.fileBytes = files.reduce((n, f) => n + f.size, 0);
    return out;
  });
}

/**
 * Writes a backup zip for one customer into the server backups folder.
 * @returns {{ file: string, bytes: number, manifest: object }}
 */
export async function createBackup(customerId, { by = '' } = {}) {
  const customer = await unscoped(() => Customer.findById(customerId).lean());
  if (!customer) throw fail(404, 'Customer not found.');

  const docs = {};
  await unscoped(async () => {
    for (const c of COLLECTIONS) docs[c.key] = await c.model.find(c.filter(customer._id)).lean();
  });
  const texts = { customer: ejson(customer) };
  for (const c of COLLECTIONS) texts[c.key] = ejson(docs[c.key]);

  const folder = customerFolderPath(customer.storage?.folder);
  const ownFiles = walkFiles(folder);
  const allText = Object.values(texts).join('\n');
  const rootFiles = legacyRefs(allText);

  const counts = {};
  for (const c of COLLECTIONS) counts[c.key] = docs[c.key].length;
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: by,
    appVersion: APP_VERSION,
    customer: { id: String(customer._id), name: customer.name, slug: customer.slug, folder: customer.storage?.folder || '' },
    counts,
    files: { customerFolder: ownFiles.length, legacyRoot: rootFiles.length, bytes: [...ownFiles, ...rootFiles].reduce((n, f) => n + f.size, 0) },
    // The data shape at backup time. An importer compares this with its own models before restoring.
    schema: {
      customer: Object.keys(Customer.schema.paths),
      ...Object.fromEntries(COLLECTIONS.map((c) => [c.key, Object.keys(c.model.schema.paths)]))
    }
  };

  const file = `${customer.slug}-${stamp()}.zip`;
  const abs = path.join(backupDir(), file);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    out.on('error', reject);
    zip.on('error', reject);
    zip.on('warning', (w) => { if (w.code !== 'ENOENT') reject(w); });
    zip.pipe(out);
    zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    zip.append(texts.customer, { name: 'customer.json' });
    for (const c of COLLECTIONS) zip.append(texts[c.key], { name: `${c.key}.json` });
    for (const f of ownFiles) zip.file(f.abs, { name: `files/customer/${f.rel}` });
    for (const f of rootFiles) zip.file(f.abs, { name: `files/root/${f.rel}` });
    zip.finalize();
  }).catch((err) => {
    try { fs.rmSync(abs, { force: true }); } catch { /* ignore */ }
    throw err;
  });

  const bytes = fs.statSync(abs).size;
  fs.writeFileSync(`${abs}.json`, JSON.stringify({ ...manifest, bytes, file }, null, 2));
  return { file, bytes, manifest };
}

/** Backups saved on the server, newest first. */
export function listBackups() {
  const dir = backupDir();
  const rows = [];
  for (const name of fs.readdirSync(dir)) {
    if (!BACKUP_FILE_RE.test(name)) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(`${abs}.json`, 'utf-8')); } catch { /* no sidecar: show what the file system knows */ }
    rows.push({
      file: name,
      bytes: st.size,
      createdAt: meta.createdAt || st.mtime.toISOString(),
      customerName: meta.customer?.name || name.replace(/-\d{8}-\d{6}\.zip$/i, ''),
      counts: meta.counts || null,
      files: meta.files || null
    });
  }
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function deleteBackupFile(file) {
  const abs = backupPath(file);
  fs.rmSync(abs, { force: true });
  fs.rmSync(`${abs}.json`, { force: true });
}

/** Removes every row (and optionally the files) belonging to a customer, then the customer. No backup is made here. */
export async function purgeCustomer(customerId, { removeFiles = true } = {}) {
  const customer = await unscoped(() => Customer.findById(customerId).lean());
  if (!customer) return;
  await unscoped(async () => {
    for (const c of COLLECTIONS) {
      if (c.key === 'users') continue;
      await c.model.deleteMany({ customer: customer._id }); // naming `customer` explicitly keeps the tenant plugin out of it
    }
    await User.deleteMany({ customer: customer._id, role: { $ne: 'admin' } });
    await User.updateMany({ customer: customer._id, role: 'admin' }, { $set: { customer: null } }); // agency staff stay, just unassigned
    await CustomFeature.updateMany({ 'availability.customers': customer._id }, { $pull: { 'availability.customers': customer._id } });
    await Customer.deleteOne({ _id: customer._id });
  });
  const folder = customerFolderPath(customer.storage?.folder);
  if (removeFiles && folder && within(path.join(uploadRoot, 'customers'), folder)) fs.rmSync(folder, { recursive: true, force: true });
}

const readJson = (zip, name, fallback) => {
  const entry = zip.getEntry(name);
  if (!entry) return fallback;
  return zip.readAsText(entry);
};

/**
 * Restores a backup zip as a new customer (same ids as before). Refuses to touch an existing customer.
 *  - If the slug or storage folder is already taken, a free one is picked and links to files are rewritten.
 *  - Users whose email (or id) already exists are skipped and listed in the result.
 *  - If anything fails part-way, everything this import added is removed again.
 */
export async function importBackup(zipPath, { slug } = {}) {
  let zip;
  try { zip = new AdmZip(zipPath); } catch { throw fail(400, 'That file is not a valid backup (could not open the zip).'); }

  let manifest;
  try { manifest = JSON.parse(readJson(zip, 'manifest.json', 'null')); } catch { manifest = null; }
  if (!manifest || manifest.format !== BACKUP_FORMAT) throw fail(400, 'That file is not an AUTOMATr customer backup.');
  if (!Number.isInteger(manifest.version) || manifest.version > BACKUP_VERSION) {
    throw fail(400, `This backup was made by a newer version of AUTOMATr (backup format ${manifest.version}). Update the app, then import it.`);
  }

  const customerText = readJson(zip, 'customer.json', null);
  if (!customerText) throw fail(400, 'The backup is missing customer.json.');
  const customer = EJSON.parse(customerText);
  if (!customer?._id || !customer.name) throw fail(400, 'The backup\'s customer record is incomplete.');

  const existing = await unscoped(() => Customer.findById(customer._id).select('name').lean());
  if (existing) throw fail(409, `A customer with this backup's id already exists ("${existing.name}"). Delete it first if you want to restore the backup over it.`);

  const oldFolder = customer.storage?.folder || '';
  const wantSlug = String(slug || customer.slug || '').toLowerCase();
  if (!SLUG_RE.test(wantSlug)) throw fail(400, 'The slug must be 2-48 characters: lowercase letters, numbers and dashes.');

  // A free slug and a free storage folder (suffix -restored, -restored-2, ...)
  const taken = async (s) => Boolean(await unscoped(() => Customer.exists({ $or: [{ slug: s }, { 'storage.folder': s }] }))) || fs.existsSync(path.join(uploadRoot, 'customers', s));
  let newSlug = wantSlug;
  for (let i = 1; await taken(newSlug); i += 1) newSlug = `${wantSlug.slice(0, 36)}-restored${i > 1 ? `-${i}` : ''}`;
  const newFolder = newSlug;

  const rewrite = (text) => (oldFolder && oldFolder !== newFolder ? text.split(`/uploads/customers/${oldFolder}/`).join(`/uploads/customers/${newFolder}/`) : text);

  // Parse everything BEFORE writing anything, so a damaged backup fails cleanly.
  const parsed = {};
  for (const c of COLLECTIONS) {
    const text = readJson(zip, `${c.key}.json`, '[]');
    try { parsed[c.key] = EJSON.parse(rewrite(text)); } catch { throw fail(400, `The backup's ${c.key}.json could not be read.`); }
    if (!Array.isArray(parsed[c.key])) throw fail(400, `The backup's ${c.key}.json is not a list.`);
  }
  const customerDoc = EJSON.parse(rewrite(customerText));
  customerDoc.slug = newSlug;
  customerDoc.storage = { ...(customerDoc.storage || {}), folder: newFolder };

  const result = { customer: { id: String(customerDoc._id), name: customerDoc.name, slug: newSlug, folder: newFolder }, restored: {}, skipped: {}, skippedUsers: [], files: 0, renamed: newSlug !== customer.slug };

  const wroteFiles = [];
  try {
    await unscoped(async () => {
      // users: skip emails / ids that already exist
      const users = parsed.users;
      const clash = await User.find({ $or: [{ email: { $in: users.map((u) => u.email) } }, { _id: { $in: users.map((u) => u._id) } }] }).select('email').lean();
      const clashEmails = new Set(clash.map((u) => String(u.email).toLowerCase()));
      const clashIds = new Set(clash.map((u) => String(u._id)));
      parsed.users = users.filter((u) => {
        const bad = clashEmails.has(String(u.email).toLowerCase()) || clashIds.has(String(u._id));
        if (bad) result.skippedUsers.push(u.email);
        return !bad;
      });

      await Customer.collection.insertOne(customerDoc);
      for (const c of COLLECTIONS) {
        const rows = parsed[c.key];
        result.restored[c.key] = 0;
        result.skipped[c.key] = 0;
        if (!rows.length) continue;
        try {
          const r = await c.model.collection.insertMany(rows, { ordered: false });
          result.restored[c.key] = r.insertedCount;
        } catch (err) {
          // Duplicate ids (e.g. a pipeline that already exists) are skipped; anything else aborts the import.
          const errors = err.writeErrors || err.result?.getWriteErrors?.() || [];
          if (!errors.length || errors.some((e) => (e.code ?? e.err?.code) !== 11000)) throw err;
          result.skipped[c.key] = errors.length;
          result.restored[c.key] = rows.length - errors.length;
        }
      }
    });

    // files
    const customerBase = path.join(uploadRoot, 'customers', newFolder);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const n = entry.entryName;
      let target = null;
      if (n.startsWith('files/customer/')) target = path.join(customerBase, n.slice('files/customer/'.length));
      else if (n.startsWith('files/root/')) target = path.join(uploadRoot, n.slice('files/root/'.length));
      else continue;
      const base = n.startsWith('files/customer/') ? customerBase : uploadRoot;
      if (!within(base, target)) continue; // never write outside the upload folders
      if (n.startsWith('files/root/') && fs.existsSync(target)) continue; // keep what is already there
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
      wroteFiles.push(target);
      result.files += 1;
    }
    fs.mkdirSync(customerBase, { recursive: true });
    return result;
  } catch (err) {
    // Undo: rows (when the customer record was written), the new folder, and legacy files this import wrote.
    try { await purgeCustomer(customerDoc._id, { removeFiles: false }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(uploadRoot, 'customers', newFolder), { recursive: true, force: true }); } catch { /* best effort */ }
    for (const f of wroteFiles) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
    throw err.status ? err : fail(500, `Import failed and was rolled back: ${err.message}`);
  }
}
