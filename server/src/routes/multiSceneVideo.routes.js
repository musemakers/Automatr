import { Router } from 'express';
import { config, list, plan, generate, getJob } from '../controllers/multiSceneVideo.controller.js';
import { upload } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceBudget, restrictGeneration } from '../middleware/budgetGuard.js';
import { enforceStorage } from '../middleware/storageGuard.js';
import { requireFeature } from '../middleware/featureGuard.js';

const router = Router();
router.use(requireAuth);
router.use(requireFeature('multiSceneVideo'));

router.get('/config', config);
router.get('/', list);
router.post(
  '/plan',
  restrictGeneration('video'), enforceStorage,
  enforceBudget,
  upload.fields([
    { name: 'product', maxCount: 1 },
    { name: 'endLogo', maxCount: 1 },
    { name: 'marketLogos', maxCount: 6 }
  ]),
  plan
);
router.post('/:id/generate', restrictGeneration('video'), enforceStorage, enforceBudget, generate);
router.get('/:id', getJob);

export default router;
