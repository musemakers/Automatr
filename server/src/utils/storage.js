import path from 'node:path';
import fs from 'node:fs';
import { getTenant } from '../tenant/context.js';

// WHERE EVERY FILE THE APP WRITES LIVES. Only paths like "/uploads/..." are stored in
// MongoDB - the bytes are on disk here, so this MUST be persistent storage in
// production (Railway volume) or every redeploy wipes past creations.
//
//   root     <UPLOAD_DIR | $RAILWAY_VOLUME_MOUNT_PATH/uploads | ./uploads>
//   customer <root>/customers/<customer.storage.folder>/   <- all NEW files for that customer
//   legacy   <root>/<file>                                  <- files from before multi-customer; still served
//
// Root resolution order: UPLOAD_DIR, Railway volume, ./uploads.
function resolveUploadRoot() {
  if (process.env.UPLOAD_DIR) return { dir: path.resolve(process.cwd(), process.env.UPLOAD_DIR), source: 'UPLOAD_DIR' };
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return { dir: path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads'), source: 'railway-volume' };
  return { dir: path.resolve(process.cwd(), 'uploads'), source: 'local-disk' };
}
const resolved = resolveUploadRoot();
export const uploadRoot = resolved.dir;
fs.mkdirSync(uploadRoot, { recursive: true });

export function storageInfo() {
  let writable = true;
  try { fs.accessSync(uploadRoot, fs.constants.W_OK); } catch { writable = false; }
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const persistent = !onRailway || Boolean(volume && path.resolve(uploadRoot).startsWith(path.resolve(volume)));
  return { dir: uploadRoot, source: resolved.source, writable, onRailway, persistent };
}

const SAFE_FOLDER = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** Folder name for a customer ('' when there is none, i.e. legacy/unscoped). */
function folderOf(customer) {
  const f = customer?.storage?.folder || customer?.slug || '';
  return SAFE_FOLDER.test(f) ? f : '';
}

const customerOf = (tenant) => (tenant === undefined ? getTenant()?.customer : tenant?.customer) || null;

/** Absolute directory new files for the current (or given) customer go in. Created on demand. */
export function uploadDir(tenant) {
  const folder = folderOf(customerOf(tenant));
  const dir = folder ? path.join(uploadRoot, 'customers', folder) : uploadRoot;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** URL prefix for new files: "/uploads/customers/<folder>" (or "/uploads" when unscoped). */
export function uploadUrlPrefix(tenant) {
  const folder = folderOf(customerOf(tenant));
  return folder ? `/uploads/customers/${folder}` : '/uploads';
}

/** Public URL path for a file name written into the current customer's folder. */
export const uploadUrl = (filename, tenant) => `${uploadUrlPrefix(tenant)}/${filename}`;

const inside = (base, target) => {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Absolute path of a stored file, from either a URL path ("/uploads/customers/acme/x.png",
 * "/uploads/x.png") or a bare file name. URL paths resolve exactly (never guessing); bare
 * names try the current customer's folder first, then the legacy root. Refuses to leave the
 * upload root.
 */
export function resolveUploadPath(urlOrName, tenant) {
  const raw = String(urlOrName || '');
  if (!raw) return '';
  if (raw.startsWith('/uploads/')) {
    const abs = path.resolve(uploadRoot, raw.slice('/uploads/'.length));
    return inside(uploadRoot, abs) ? abs : '';
  }
  const name = path.basename(raw);
  const inCustomer = path.join(uploadDir(tenant), name);
  if (fs.existsSync(inCustomer)) return inCustomer;
  const legacy = path.join(uploadRoot, name);
  return fs.existsSync(legacy) ? legacy : inCustomer;
}

// ---- Storage usage (Saved Documents indicator) ---------------------------------------
export const DEFAULT_STORAGE_MB = 1024; // 1 GB per customer unless the agency sets limits.storageMb

function dirBytes(dir, skip = new Set()) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(p);
    else if (e.isFile()) { try { total += fs.statSync(p).size; } catch { /* file vanished */ } }
  }
  return total;
}

const usageCache = new Map(); // folder -> { at, bytes }
/** Bytes on disk for the current (or given) customer's folder; cached for 30s. */
export function storageUsedBytes(tenant, { fresh = false } = {}) {
  const folder = folderOf(customerOf(tenant));
  const key = folder || '__root__';
  const hit = usageCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 30000) return hit.bytes;
  const bytes = folder ? dirBytes(path.join(uploadRoot, 'customers', folder)) : dirBytes(uploadRoot, new Set(['customers']));
  usageCache.set(key, { at: Date.now(), bytes });
  return bytes;
}
