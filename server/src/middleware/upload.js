import multer from 'multer';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { uploadRoot, uploadDir, storageInfo } from '../utils/storage.js';
import { runWithTenant } from '../tenant/context.js';

// File locations are decided in utils/storage.js (per-customer folders under one
// persistent root). This module only wires them into multer.
export { storageInfo };

// multer decides the destination from req.tenant (set by requireAuth), NOT from
// AsyncLocalStorage: multer's callbacks fire from the request stream, where the
// async context is not reliably carried.
const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, uploadDir(req.tenant)),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
  'application/pdf'
]);

// A brand package: Brand Assets also accepts a ZIP (a design-system export or a folder of logos and photos).
// Only the brand route uses this uploader; every other upload stays images and PDFs.
const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip', 'application/octet-stream']);
const brandFileFilter = (_req, file, cb) => {
  const isZip = path.extname(file.originalname || '').toLowerCase() === '.zip' && ZIP_TYPES.has(file.mimetype);
  if (!isZip && !ALLOWED_MIME.has(file.mimetype)) return cb(new Error(`Unsupported file type: ${file.mimetype}`));
  cb(null, true);
};

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
  cb(null, true);
};
// Upload limit is 100 MB. MAX_UPLOAD_MB can raise it but never lower it below 100 (an old lower value on Railway is ignored).
const MAX_UPLOAD_MB = Math.max(Number(process.env.MAX_UPLOAD_MB) || 0, 100);
const limits = { fileSize: MAX_UPLOAD_MB * 1024 * 1024 };

// After multer has parsed the body, the handler would otherwise run outside the
// customer context (queries unscoped, files in the wrong folder). Re-enter it.
function keepTenant(middleware) {
  return (req, res, next) =>
    middleware(req, res, (err) => {
      if (err) return next(err);
      return runWithTenant(req.tenant || null, () => next());
    });
}
function scoped(instance) {
  return {
    single: (...a) => keepTenant(instance.single(...a)),
    array: (...a) => keepTenant(instance.array(...a)),
    fields: (...a) => keepTenant(instance.fields(...a)),
    any: (...a) => keepTenant(instance.any(...a)),
    none: (...a) => keepTenant(instance.none(...a))
  };
}

export const upload = scoped(multer({ storage, limits, fileFilter }));

/** Brand Assets uploads: images, PDFs and brand package ZIPs. */
export const uploadBrandFiles = scoped(multer({ storage, limits, fileFilter: brandFileFilter }));

// Same validation, but keeps the file in memory - for endpoints that only read the bytes once.
export const uploadMemory = scoped(multer({ storage: multer.memoryStorage(), limits, fileFilter }));

/** Past published assets for the style learner: images only, kept in memory (they are read once, never stored). */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
export const uploadPastAssets = scoped(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 24 },
    fileFilter: (_req, file, cb) => (IMAGE_MIME.has(file.mimetype) ? cb(null, true) : cb(new Error(`Only PNG, JPG or WebP images can be read (got ${file.mimetype}).`)))
  })
);

/** A font file (.ttf / .otf) for the brand's headline or body font: read once from memory, then stored by the font service. */
export const uploadFontFile = scoped(
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => (/\.(ttf|otf|woff2?|ttc)$/i.test(file.originalname || '') ? cb(null, true) : cb(new Error('Upload a .ttf or .otf font file.')))
  })
);

/** The upload ROOT (all customers + legacy files). Static serving and old imports use this. */
export const uploadDirPath = uploadRoot;
