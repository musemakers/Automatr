import { storageUsedBytes, DEFAULT_STORAGE_MB } from '../utils/storage.js';

/**
 * Blocks any generation (HTTP 403, code STORAGE_FULL) once the customer's files have used up the storage quota, so no
 * new image or video can be made until old assets are deleted. Measured fresh from disk on every call (a deleted
 * asset frees space straight away). Use ahead of every route that creates or generates a creative. Must run after requireAuth.
 */
export function enforceStorage(req, res, next) {
  try {
    if (!req.tenant?.customer) return next(); // agency admin with no customer selected: nothing to measure
    const mb = req.tenant.customer.limits?.storageMb;
    const limitBytes = (Number.isFinite(mb) ? mb : DEFAULT_STORAGE_MB) * 1024 * 1024;
    const usedBytes = storageUsedBytes(req.tenant, { fresh: true });
    if (limitBytes && usedBytes >= limitBytes) {
      return res.status(403).json({
        error: 'Your storage is full. Delete some old assets from Saved Documents to free up space, then try again.',
        code: 'STORAGE_FULL',
        usedBytes,
        limitBytes
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
