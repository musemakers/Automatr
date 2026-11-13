import { Router } from 'express';
import { config, startExport, getExport, downloadExportFile, downloadLink, downloadByToken } from '../controllers/billboard.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceBudget, blockSuperadminCreation } from '../middleware/budgetGuard.js';
import { enforceStorage } from '../middleware/storageGuard.js';
import { requireFeature } from '../middleware/featureGuard.js';

const router = Router();
// Signed link used by the browser's own download (no Authorization header on a plain link), so it sits before requireAuth.
router.get('/dl/:token', downloadByToken);

router.use(requireAuth);
router.use(requireFeature('billboards'));

router.get('/config', config);
router.post('/export', blockSuperadminCreation, enforceStorage, enforceBudget, startExport);
router.get('/export/:id', getExport);
router.get('/export/:id/file/:name', downloadExportFile);
router.get('/export/:id/file/:name/link', downloadLink);

export default router;
