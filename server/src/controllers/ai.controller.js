import { generationUsage } from '../services/customerService.js';
import { providerStatus } from '../services/ai/router.js';
import { getSettings } from '../services/appSettingsService.js';
import * as costEstimateService from '../services/costEstimateService.js';
import { analyzeTemplateElements } from '../services/ai/templateAnalysisService.js';
import { detectHeadlineLines } from '../services/ai/headlineTextService.js';
import { detectHero, suggestHeroIdeas } from '../services/ai/heroImageService.js';
import { generateHeadlineVariations, improveTextOptions } from '../services/ai/captionService.js';

/**
 * GET /api/ai/generation-allowance - what the signed-in workspace has left this month:
 * images / videos used, the monthly caps (null = unlimited) and when the cycle resets.
 */
export async function generationAllowance(req, res, next) {
  try {
    if (!req.customer) return res.json({ available: false });
    const usage = await generationUsage(req.customer);
    const r = req.customer.restrictions || {};
    res.json({
      available: true,
      isAgency: req.user?.role === 'admin',
      customerName: req.customer.name,
      images: { ...usage.images, agencyOnly: Boolean(r.imageGenSuperadminOnly) },
      videos: { ...usage.videos, agencyOnly: Boolean(r.videoGenSuperadminOnly) },
      cycleStart: usage.cycleStart,
      resetsAt: usage.cycleEnd
    });
  } catch (err) {
    next(err);
  }
}

export function status(_req, res) {
  res.json({ providers: providerStatus() });
}

/**
 * Rough USD estimates for every distinct kind of AI-triggering button in
 * the app, resolved against whatever model is actually currently in effect
 * (an admin's pinned copyModel/imageModel, falling back to a reasonable
 * default for "auto"). These are estimates only, not real billing figures
 * - see constants/aiPricing.js for the caveat and the actual numbers.
 */
export async function costEstimates(_req, res, next) {
  try {
    const settings = await getSettings();
    const imageModel = settings.imageModel && settings.imageModel !== 'auto' ? settings.imageModel : 'gpt';
    const copyModel = settings.copyModel && settings.copyModel !== 'auto' ? settings.copyModel : 'gpt';

    const estimate = (usd, model) => ({ usd, model });
    // CostTag (client/src/components/ui.jsx) already renders nothing when
    // given anything other than a real {usd, model} object, so hiding costs
    // workspace-wide is just a matter of returning null here instead of a
    // real estimate for every field - no per-page changes needed anywhere
    // costs are displayed.
    const hidden = Boolean(settings.hideCosts);
    const maybe = (usd, model) => (hidden ? null : estimate(usd, model));

    res.json({
      note: hidden
        ? 'Cost estimates are hidden for this workspace (Admin > AI Settings).'
        : 'Rough estimates only - actual provider pricing varies and changes over time.',
      hideCosts: hidden,
      // Image generation, by the same quality tiers used throughout the app.
      imageStandard: maybe(costEstimateService.estimateImageCostUsd(imageModel, 'standard'), imageModel),
      imageHigh: maybe(costEstimateService.estimateImageCostUsd(imageModel, 'high'), imageModel),
      // Small text tasks: AI Suggestion (Look & feel / Message), copy
      // regeneration, and headline suggestion each have a different
      // expected input/output size, so they get separate estimates rather
      // than sharing one generic "text" number.
      suggestion: maybe(costEstimateService.estimateTextCostUsd(copyModel, { inputTokens: 400, outputTokens: 150 }), copyModel),
      caption: maybe(costEstimateService.estimateTextCostUsd(copyModel, { inputTokens: 350, outputTokens: 120 }), copyModel),
      headline: maybe(costEstimateService.estimateTextCostUsd(copyModel, { inputTokens: 200, outputTokens: 30 }), copyModel),
      // Video generation doesn't have an admin-pinned default model the
      // way image/text do (see AI_VIDEO_PRIORITY in videoRouter.js) - Veo
      // is the first in the default priority order, and ~6s is a typical
      // short-form clip length, so that's the representative estimate shown.
      video: maybe(costEstimateService.estimateVideoCostUsd('veo', 6), 'veo (~6s)')
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Analyzes an uploaded (not-yet-persisted) template image for Creative
 * Adaptation and returns which preservable elements it detects (logo, key
 * visual, secondary text, compliance text, decorative graphics) - used to
 * populate the preservation-choice checkboxes in the client before the
 * person commits to a generation. Uses memory-storage upload (see
 * uploadMemory in middleware/upload.js) since the file itself never needs
 * to be saved just to analyze it - the actual template upload that gets
 * persisted happens separately via POST /posts/:id/references.
 */
export async function analyzeTemplate(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const result = await analyzeTemplateElements({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (result.skipped) {
      // Not a hard failure - the client falls back to "assume everything
      // should be preserved" when detection isn't available.
      return res.json({ detected: false, reason: result.reason });
    }

    res.json({ detected: true, modelUsed: result.modelUsed, elements: result.elements });
  } catch (err) {
    next(err);
  }
}

/**
 * Creative Adaptation only: given the headline text detected in an
 * uploaded template plus the new brief, returns several alternative
 * headlines to pick from - grounded in the original's actual wording/
 * style rather than the AI silently choosing one per copy direction.
 * Requires auth (unlike status/cost-estimates/analyze-template above)
 * since brand voice depends on knowing who's asking - see requireAuth on
 * this specific route in ai.routes.js.
 */
export async function headlineVariations(req, res, next) {
  try {
    const { originalHeadline, purpose, briefNote } = req.body;
    if (!originalHeadline || !originalHeadline.trim()) {
      return res.status(400).json({ error: 'originalHeadline is required.' });
    }
    // purpose is optional for "Edit Headline Only" (there is no brief there) -
    // fall back to a plain reword request.
    const effectivePurpose = purpose && purpose.trim() ? purpose : 'Reword this line so it reads fresh while keeping the same message, length and tone';

    const { variations, modelUsed, note } = await generateHeadlineVariations({
      originalHeadline: originalHeadline.trim(),
      purpose: effectivePurpose,
      briefNote,
      improve: Boolean(req.body.improve),
      user: req.user
    });

    res.json({ variations, modelUsed, note });
  } catch (err) {
    next(err);
  }
}

/**
 * "Edit Headline Only": reads the headline and sub-headline(s) printed on an
 * uploaded creative (memory upload - nothing is persisted). Never a hard
 * failure: when detection is unavailable the client lets the person type the
 * text lines in by hand.
 */
export async function analyzeHeadline(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const result = await detectHeadlineLines({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (result.skipped) return res.json({ detected: false, lines: [], reason: result.reason });
    res.json({ detected: true, modelUsed: result.modelUsed, lines: result.lines });
  } catch (err) {
    next(err);
  }
}

/**
 * "Change Hero Image Only": names the hero subject of an uploaded creative
 * (memory upload - nothing is persisted). Never a hard failure: when detection
 * is unavailable the client lets the person describe the hero by hand.
 */
export async function analyzeHero(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const result = await detectHero({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (result.skipped) return res.json({ detected: false, reason: result.reason });
    res.json({ detected: result.hero.hasHero, modelUsed: result.modelUsed, hero: result.hero, reason: result.hero.hasHero ? undefined : 'No clear hero image was found.' });
  } catch (err) {
    next(err);
  }
}

/** A handful of alternative hero ideas for the "describe a new hero" option. */
export async function heroIdeas(req, res, next) {
  try {
    const current = String(req.body.current || '').trim().slice(0, 200);
    if (!current) return res.status(400).json({ error: 'current is required.' });
    const direction = String(req.body.direction || '').trim().slice(0, 200);
    const position = String(req.body.position || '').trim().slice(0, 160);
    const background = String(req.body.background || '').trim().slice(0, 160);
    let exclude = [];
    try {
      const parsed = JSON.parse(req.body.exclude || '[]');
      if (Array.isArray(parsed)) exclude = parsed.filter((v) => typeof v === 'string').map((v) => v.slice(0, 220)).slice(0, 40);
    } catch { /* ignore malformed exclude list */ }
    const image = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : null;
    const { ideas, modelUsed, note } = await suggestHeroIdeas({ current, position, background, direction, image, exclude });
    res.json({ ideas, modelUsed, note });
  } catch (err) {
    next(err);
  }
}

/** Improve for any typed instruction box: three rewrites, never the same text back. */
export async function improveText(req, res, next) {
  try {
    const text = String(req.body.text || '').trim().slice(0, 1200);
    if (!text) return res.status(400).json({ error: 'text is required.' });
    const kind = String(req.body.kind || 'instruction').trim().slice(0, 80);
    const context = String(req.body.context || '').trim().slice(0, 600);
    const { options, modelUsed, note } = await improveTextOptions({ text, kind, context, user: req.user });
    res.json({ options, modelUsed, note });
  } catch (err) {
    next(err);
  }
}
