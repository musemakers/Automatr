import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getConnectUrl, callback, status, disconnect } from '../controllers/meta.controller.js';

const router = Router();

// Public: hit directly by Meta's browser redirect - see the controller's
// top comment for how the user is identified via the signed `state` param.
router.get('/callback', callback);

router.use(requireAuth);
router.get('/connect-url', requirePermission('manageBrand'), getConnectUrl);
router.get('/status', status);
router.post('/disconnect', requirePermission('manageBrand'), disconnect);

export default router;
