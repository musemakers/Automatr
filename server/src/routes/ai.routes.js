import { Router } from 'express';
import { status, costEstimates, generationAllowance, analyzeTemplate, analyzeHeadline, analyzeHero, heroIdeas, headlineVariations, improveText } from '../controllers/ai.controller.js';
import { customerUsage } from '../controllers/usage.controller.js';
import { uploadMemory } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { enforceBudget } from '../middleware/budgetGuard.js';

const router = Router();

router.get('/status', status);
// Everything except /status needs a logged-in user now: model choice, cost display and
// spend are per customer.
router.get('/cost-estimates', requireAuth, costEstimates);
router.get('/generation-allowance', requireAuth, generationAllowance);
// Customer-facing usage log: every generation in the workspace (no costs / models - those stay in Admin -> AI usage).
router.get('/usage', requireAuth, customerUsage);
router.post('/analyze-template', requireAuth, enforceBudget, uploadMemory.single('file'), analyzeTemplate);
router.post('/analyze-headline', requireAuth, enforceBudget, uploadMemory.single('file'), analyzeHeadline);
router.post('/analyze-hero', requireAuth, enforceBudget, uploadMemory.single('file'), analyzeHero);
router.post('/hero-ideas', requireAuth, enforceBudget, uploadMemory.single('file'), heroIdeas);
// Needs req.user for brand-voice context (see headlineVariations in
// ai.controller.js) - the other routes above don't need auth since they
// carry no user-specific data, so requireAuth is scoped to just this one
// rather than applied to the whole router.
router.post('/headline-variations', requireAuth, enforceBudget, headlineVariations);
router.post('/improve-text', requireAuth, enforceBudget, improveText);

export default router;
