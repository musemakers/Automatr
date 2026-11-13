import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { snapshot, refresh, industries } from '../controllers/news.controller.js';

const router = Router();

router.get('/industries', industries);
router.get('/', requireAuth, snapshot);
router.post('/refresh', requireAuth, refresh);

export default router;
