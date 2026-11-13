import { Router } from 'express';
import { register, login, me, updateMe, industries, forgotPassword, resetPassword, resetAvailable } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);
router.get('/industries', industries);
router.get('/forgot-password/status', resetAvailable);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
