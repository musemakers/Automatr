import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { search, status } from '../controllers/stockPhotos.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/status', status);
router.get('/search', search);

export default router;
