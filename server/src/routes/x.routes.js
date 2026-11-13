import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getConnectUrl, callback, status, disconnect } from '../controllers/x.controller.js';

const router = Router();

// Public: hit directly by X's browser redirect.
router.get('/callback', callback);

router.use(requireAuth);
router.get('/connect-url', requirePermission('manageBrand'), getConnectUrl);
router.get('/status', status);
router.post('/disconnect', requirePermission('manageBrand'), disconnect);

export default router;
