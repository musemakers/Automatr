import multer from 'multer';

// One optional reference image or video for Brief Studio (super admin). Kept in memory (analysed once and
// never saved); deliberately separate from middleware/upload.js so customer uploads keep their stricter rules.
const MAX_MB = Math.max(Number(process.env.MAX_REFERENCE_MB) || 0, 100);
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);

const instance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new Error('The reference must be a PNG, JPG or WebP image, or an MP4, WebM or MOV video.')))
});

/** Accepts `reference` as multipart; plain JSON bodies pass straight through. Errors come back as JSON 400s. */
export function referenceUpload(req, res, next) {
  instance.single('reference')(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `That file is too large (max ${MAX_MB} MB).` : err.message || 'Could not read the reference file.';
    return res.status(400).json({ error: msg });
  });
}
