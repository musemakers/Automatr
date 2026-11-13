import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getCompetitors, detectCompetitors, saveCompetitors, getCompetitorNews } from '../controllers/competitors.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', getCompetitors);
router.post('/detect', detectCompetitors);
router.put('/', saveCompetitors);
router.get('/news', getCompetitorNews);

export default router;
