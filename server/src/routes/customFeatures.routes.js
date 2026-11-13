import { Router } from 'express';
import { requireAuth, requireAgency } from '../middleware/auth.js';
import { enforceBudget, blockSuperadminCreation } from '../middleware/budgetGuard.js';
import { enforceStorage } from '../middleware/storageGuard.js';
import { upload } from '../middleware/upload.js';
import { referenceUpload } from '../middleware/referenceUpload.js';
import * as ctrl from '../controllers/customFeatures.controller.js';

// Custom features ("Brief Studio").
//   /api/custom-features/admin/...   agency super admin only: design from a brief, test, publish to customers
//   /api/custom-features/...         everyone: use the published features switched on for their workspace
//
// ORDER MATTERS: /admin/* and /runs/* are registered before /:id so they are never read as an id.
const router = Router();
router.use(requireAuth);

// ---- Agency super admin ---------------------------------------------------------------------
router.get('/admin', requireAgency, ctrl.adminList);
router.post('/admin', requireAgency, referenceUpload, ctrl.adminCreate);
router.get('/admin/:id', requireAgency, ctrl.adminGet);
router.patch('/admin/:id', requireAgency, ctrl.adminUpdate);
router.delete('/admin/:id', requireAgency, ctrl.adminRemove);
router.post('/admin/:id/redesign', requireAgency, referenceUpload, ctrl.adminRedesign);
router.post('/admin/:id/refine', requireAgency, ctrl.adminRefine);
router.post('/admin/:id/test', requireAgency, enforceBudget, upload.any(), ctrl.adminTest);
router.get('/admin/:id/test-runs', requireAgency, ctrl.adminTestRuns);
router.post('/admin/:id/publish', requireAgency, ctrl.adminPublish);
router.post('/admin/:id/unpublish', requireAgency, ctrl.adminUnpublish);

// ---- Using a published feature ------------------------------------------------------------------
router.get('/', ctrl.listAvailable);
router.get('/runs/:runId', ctrl.getRun);
router.post('/runs/:runId/compose', ctrl.composeRun);
router.post('/runs/:runId/retry', blockSuperadminCreation, enforceStorage, ctrl.outputGuard, enforceBudget, ctrl.retryRun);
router.get('/:id', ctrl.getAvailable);
router.get('/:id/runs', ctrl.listRuns);
router.post('/:id/runs', blockSuperadminCreation, enforceStorage, ctrl.outputGuard, enforceBudget, upload.any(), ctrl.startRun);

export default router;
