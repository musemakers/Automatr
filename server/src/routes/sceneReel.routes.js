import { Router } from 'express';
import { config, uploadRef, suggest, create, list, getOne, retry, redoScene } from '../controllers/sceneReel.controller.js';
import { upload } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceBudget, restrictGeneration, blockSuperadminCreation } from '../middleware/budgetGuard.js';
import { enforceStorage } from '../middleware/storageGuard.js';
import { requireFeature } from '../middleware/featureGuard.js';

const router = Router();
router.use(requireAuth);
router.use(requireFeature('multiSceneVideo'));

router.get('/config', config);
router.get('/', list);
router.post('/upload', blockSuperadminCreation, enforceStorage, upload.single('file'), uploadRef);
router.post('/suggest', blockSuperadminCreation, enforceBudget, suggest);
router.post('/', restrictGeneration('video'), enforceStorage, enforceBudget, create);
router.get('/:id', getOne);
router.post('/:id/retry', restrictGeneration('video'), enforceStorage, enforceBudget, retry);
router.post('/:id/scenes/:sceneId/redo', restrictGeneration('video'), enforceStorage, enforceBudget, redoScene);

export default router;
