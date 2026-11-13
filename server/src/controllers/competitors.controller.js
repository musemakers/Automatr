import Customer from '../models/Customer.js';
import * as competitorService from '../services/competitorService.js';

/** [requireAuth] Current saved competitor list + whether detection is available. */
export async function getCompetitors(req, res, next) {
  try {
    res.json({
      configured: competitorService.isConfigured(),
      competitors: req.user.competitors || [],
      detectedAt: req.user.competitorsDetectedAt || null
    });
  } catch (err) {
    next(err);
  }
}

/**
 * [requireAuth] Runs AI+web-search detection and saves the result as the
 * user's competitor list, replacing whatever was there before. Separate
 * from saveCompetitors (manual edit) so the client can offer both "detect
 * for me" and "let me type them in" without conflating the two.
 */
export async function detectCompetitors(req, res, next) {
  try {
    if (!competitorService.isConfigured()) {
      return res.status(400).json({
        error: 'Competitor detection needs an AI provider with web search (Anthropic, OpenAI or Gemini). Add its API key in server/.env.'
      });
    }
    const competitors = await competitorService.detectCompetitors({
      industry: req.customer.industry || req.user.company?.industry || 'Technology',
      companyName: req.customer.name || req.user.company?.name || '',
      country: req.customer.country || '' // blank = India (see competitorService)
    });

    // Competitors belong to the customer workspace, shared by its whole team.
    const user = await Customer.findByIdAndUpdate(
      req.customer._id,
      { $set: { competitors, competitorsDetectedAt: new Date() } },
      { new: true }
    );

    res.json({ competitors: user.competitors, detectedAt: user.competitorsDetectedAt });
  } catch (err) {
    if (err.searchUnavailable) return res.status(err.status || 503).json({ error: err.message });
    next(err);
  }
}

/** [requireAuth] Manual save - add/remove/rename entries, up to 5. */
export async function saveCompetitors(req, res, next) {
  try {
    const { competitors } = req.body;
    if (!Array.isArray(competitors)) return res.status(400).json({ error: 'competitors must be an array.' });

    const cleaned = competitors
      .filter((c) => c && typeof c.name === 'string' && c.name.trim())
      .slice(0, 5)
      .map((c) => ({ name: c.name.trim(), website: typeof c.website === 'string' ? c.website.trim() : '' }));

    const user = await Customer.findByIdAndUpdate(req.customer._id, { $set: { competitors: cleaned } }, { new: true });
    res.json({ competitors: user.competitors });
  } catch (err) {
    next(err);
  }
}

/**
 * [requireAuth] Recent news/mentions for the saved competitor list.
 * Cached ~4 hours per user+competitor-list (see competitorService.js) to
 * avoid re-running a paid web search on every dashboard load - pass
 * ?refresh=true to force a fresh search regardless of cache age.
 */
export async function getCompetitorNews(req, res, next) {
  try {
    if (!req.user.competitors?.length) {
      return res.json({ items: [], fetchedAt: null, cached: false });
    }
    if (!competitorService.isConfigured()) {
      return res.status(400).json({ error: 'Competitor news needs an AI provider with web search (Anthropic, OpenAI or Gemini). Add its API key in server/.env.' });
    }
    const { items, fetchedAt, cached, stale = false } = await competitorService.getCompetitorNewsCached({
      userId: req.customer._id.toString(), // cache key: one search per customer, not per user
      competitors: req.user.competitors,
      count: 6,
      force: req.query.refresh === 'true'
    });
    res.json({ items, fetchedAt, cached, stale });
  } catch (err) {
    if (err.searchUnavailable) return res.status(err.status || 503).json({ error: err.message });
    next(err);
  }
}
