import { getSettings, getGlobalSettings, updateNewsProvider, updateCopyModel, updateImageModel, updateVisionModel, updateVideoModel, updateHideCosts } from '../services/appSettingsService.js';
import { NEWS_PROVIDERS, LIVE_NEWS_PROVIDERS, COPY_MODELS, IMAGE_MODELS, VIDEO_MODELS, VISION_MODELS, PROVIDER_CAPABILITIES } from '../models/AppSetting.js';
import { providerStatus, describeActiveModels } from '../services/ai/router.js';
import { providerStatus as videoProviderStatus, describeActiveVideoModels } from '../services/ai/videoRouter.js';
import * as newsSearch from '../services/ai/newsSearch.js';
import * as aiUsageLogService from '../services/aiUsageLogService.js';
import { getPricing, savePricing, resetPricing } from '../services/pricingService.js';
import { getEstimatorConfig, estimateUsage, resolveActiveProviders, modelIdFor, configuredProviders } from '../services/estimatorService.js';
import * as pricingFetch from '../services/ai/pricingFetchService.js';
import { listBlanketRules, saveBlanketRule, resetBlanketRule } from '../services/blanketRulesService.js';
import { RULE_GROUPS } from '../constants/blanketRules.js';

// Model settings are per customer: a customer admin edits their own workspace; an agency admin
// edits whichever customer they have selected, or - with ?scope=global - the agency-wide
// defaults every customer inherits. A body of { reset: true } puts a setting back to "inherit".
const scopeOpts = (req) => (req.query.scope === 'global' && req.user?.role === 'admin' ? { scope: 'global' } : undefined);
const settingsFor = (req) => (scopeOpts(req) ? getGlobalSettings() : getSettings());
const valueOrReset = (req, v) => (req.body?.reset === true ? null : v);
const overriddenOf = (settings) => settings.overriddenFields || [];

export async function getNewsSettings(req, res, next) {
  try {
    const settings = await settingsFor(req);
    const configured = providerStatus(); // { openai: bool, anthropic: bool, gemini: bool }
    res.json({
      newsProvider: settings.newsProvider,
      overridden: overriddenOf(settings),
      providers: NEWS_PROVIDERS.map((p) => ({
        id: p,
        configured: Boolean(configured[p]),
        live: LIVE_NEWS_PROVIDERS.includes(p) // has a real web-search implementation
      }))
    });
  } catch (err) {
    next(err);
  }
}

export async function updateNewsSettings(req, res, next) {
  try {
    const newsProvider = valueOrReset(req, req.body.newsProvider);
    if (newsProvider === undefined) return res.status(400).json({ error: 'newsProvider is required.' });

    if (newsProvider === 'anthropic' && !newsSearch.isConfigured()) {
      return res.status(400).json({
        error: 'Anthropic is not configured on this server. Add ANTHROPIC_API_KEY to server/.env first.'
      });
    }

    const settings = await updateNewsProvider(newsProvider, scopeOpts(req));
    res.json({ newsProvider: settings.newsProvider });
  } catch (err) {
    if (err.message?.startsWith('Unknown news provider')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * Workspace-wide default models for generating post copy and images.
 * Regular users no longer see a per-post model picker - this is the one
 * place both are set.
 */
export async function getGenerationSettings(req, res, next) {
  try {
    const settings = await settingsFor(req);
    const configured = providerStatus();
    const copyProviderOf = { gpt: 'openai', claude: 'anthropic', gemini: 'gemini' };
    const imageProviderOf = { gpt: 'openai', gemini: 'gemini', seedream: 'seedream' };
    res.json({
      copyModel: settings.copyModel,
      models: COPY_MODELS.map((m) => ({
        id: m,
        // "auto" always works (it just picks whatever's configured);
        // specific providers need their own key configured.
        configured: m === 'auto' || Boolean(configured[copyProviderOf[m]])
      })),
      imageModel: settings.imageModel,
      imageModels: IMAGE_MODELS.map((m) => ({
        id: m,
        configured: m === 'auto' || Boolean(configured[imageProviderOf[m]])
      })),
      visionModel: settings.visionModel || 'auto',
      visionModels: VISION_MODELS.map((m) => ({
        id: m,
        configured: m === 'auto' || Boolean(configured[copyProviderOf[m]]) // same keys as text: GPT / Claude / Gemini all read images
      })),
      hideCosts: Boolean(settings.hideCosts),
      overridden: overriddenOf(settings),
      activeVisionModels: describeActiveModels('vision', settings.visionModel || 'auto'),
      activeCopyModels: describeActiveModels('text', settings.copyModel),
      activeImageModels: describeActiveModels('image', settings.imageModel)
    });
  } catch (err) {
    next(err);
  }
}

export async function updateGenerationSettings(req, res, next) {
  try {
    const { copyModel, hideCosts } = req.body;
    if (copyModel === undefined && hideCosts === undefined && req.body.reset !== true) {
      return res.status(400).json({ error: 'copyModel or hideCosts is required.' });
    }

    let settings;
    if (req.body.reset === true) {
      // Back to "use the agency default" for whichever of the two was named (or both).
      if (copyModel !== undefined || hideCosts === undefined) settings = await updateCopyModel(null, scopeOpts(req));
      if (hideCosts !== undefined || copyModel === undefined) settings = await updateHideCosts(null, scopeOpts(req));
    } else {
      if (copyModel !== undefined) settings = await updateCopyModel(copyModel, scopeOpts(req));
      if (hideCosts !== undefined) settings = await updateHideCosts(hideCosts, scopeOpts(req));
    }

    res.json({ copyModel: settings.copyModel, hideCosts: Boolean(settings.hideCosts), activeCopyModels: describeActiveModels('text', settings.copyModel) });
  } catch (err) {
    if (err.message?.startsWith('Unknown copy model')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

export async function updateVisionModelSettings(req, res, next) {
  try {
    const visionModel = valueOrReset(req, req.body.visionModel);
    if (visionModel === undefined || visionModel === '') return res.status(400).json({ error: 'visionModel is required.' });

    const settings = await updateVisionModel(visionModel, scopeOpts(req));
    res.json({ visionModel: settings.visionModel || 'auto', activeVisionModels: describeActiveModels('vision', settings.visionModel || 'auto') });
  } catch (err) {
    if (err.message?.startsWith('Unknown vision model')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

export async function updateImageModelSettings(req, res, next) {
  try {
    const imageModel = valueOrReset(req, req.body.imageModel);
    if (imageModel === undefined || imageModel === '') return res.status(400).json({ error: 'imageModel is required.' });

    const settings = await updateImageModel(imageModel, scopeOpts(req));
    res.json({ imageModel: settings.imageModel, activeImageModels: describeActiveModels('image', settings.imageModel) });
  } catch (err) {
    if (err.message?.startsWith('Unknown image model')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * Workspace-wide default model for generating post videos, same pattern as
 * getGenerationSettings/updateImageModelSettings above. "gemini" here means
 * Veo, which rides on GEMINI_API_KEY - so its configured check reuses the
 * text/image provider status rather than videoRouter's, since they share a
 * key. Kling, Runway, and Seedance have their own separate keys, checked
 * via videoRouter's own providerStatus().
 */
export async function getVideoModelSettings(req, res, next) {
  try {
    const settings = await settingsFor(req);
    const configured = providerStatus(); // { openai, anthropic, gemini, seedream }
    const videoConfigured = videoProviderStatus(); // { veo, kling, runway, seedance }
    const isConfiguredFor = {
      gemini: Boolean(configured.gemini), // Veo uses GEMINI_API_KEY
      kling: Boolean(videoConfigured.kling),
      runway: Boolean(videoConfigured.runway),
      seedance: Boolean(videoConfigured.seedance)
    };
    res.json({
      videoModel: settings.videoModel,
      overridden: overriddenOf(settings),
      videoModels: VIDEO_MODELS.map((m) => ({
        id: m,
        configured: m === 'auto' || Boolean(isConfiguredFor[m])
      })),
      activeVideoModels: describeActiveVideoModels(settings.videoModel)
    });
  } catch (err) {
    next(err);
  }
}

export async function updateVideoModelSettings(req, res, next) {
  try {
    const videoModel = valueOrReset(req, req.body.videoModel);
    if (videoModel === undefined || videoModel === '') return res.status(400).json({ error: 'videoModel is required.' });

    const settings = await updateVideoModel(videoModel, scopeOpts(req));
    res.json({ videoModel: settings.videoModel, activeVideoModels: describeActiveVideoModels(settings.videoModel) });
  } catch (err) {
    if (err.message?.startsWith('Unknown video model')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * Full exhaustive view of every provider the router knows about, what each
 * one can actually do (text/image/vision), and whether its API key is
 * configured on this server right now - lets an admin see the whole
 * picture in one place instead of piecing it together from two dropdowns.
 */
export async function getProviderMatrix(_req, res, next) {
  try {
    const configured = { ...providerStatus(), ...videoProviderStatus() };
    const matrix = Object.entries(PROVIDER_CAPABILITIES).map(([id, caps]) => ({
      id,
      label: caps.label,
      text: caps.text,
      image: caps.image,
      vision: caps.vision,
      video: caps.video,
      configured: Boolean(configured[id])
    }));
    res.json({ providers: matrix });
  } catch (err) {
    next(err);
  }
}

// Query params shared by every usage endpoint: window (sinceDays or from/to), customer, type,
// provider/model/action, user. The page sends X-Customer-Id: all so an agency admin sees every customer.
const usageFilter = (q) => ({
  type: q.type || undefined,
  userId: q.userId || undefined,
  customerId: q.customerId || undefined,
  provider: q.provider || undefined,
  model: q.model || undefined,
  action: q.action || undefined,
  from: q.from || undefined,
  to: q.to || undefined,
  sinceDays: q.sinceDays ? Number(q.sinceDays) : undefined
});

/**
 * One row per user with logged activity, for the admin usage page's user
 * list - clicking a row then filters getUsageLogs by that userId.
 */
export async function getUsageByUsers(req, res, next) {
  try {
    const users = await aiUsageLogService.listUsersSummary(usageFilter(req.query));
    res.json({ users });
  } catch (err) {
    next(err);
  }
}
export async function getUsageLogs(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await aiUsageLogService.listLogs({ page, limit, ...usageFilter(req.query) });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
/** One generation: what was selected + the exact prompt (agency admins only). */
export async function getUsageLogDetail(req, res, next) {
  try {
    const detail = await aiUsageLogService.getLogDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'That generation was not found.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
}
export async function getUsageSummary(req, res, next) {
  try {
    const summary = await aiUsageLogService.getUsageSummary(usageFilter(req.query));
    res.json(summary);
  } catch (err) {
    next(err);
  }
}
/** Spend per customer (agency admin, all-customers view). */
export async function getUsageByCustomers(req, res, next) {
  try {
    res.json({ customers: await aiUsageLogService.listCustomersSummary(usageFilter(req.query)) });
  } catch (err) {
    next(err);
  }
}
/** Spend per provider + exact model. */
export async function getUsageByModels(req, res, next) {
  try {
    res.json({ models: await aiUsageLogService.listModelsSummary(usageFilter(req.query)) });
  } catch (err) {
    next(err);
  }
}

const csvCell = (v) => {
  const t = v == null ? '' : String(v);
  // neutralise spreadsheet formulas in user-controlled text
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Full detail log as CSV (same filters as the list) - for invoicing and audits. */
export async function exportUsageCsv(req, res, next) {
  try {
    const rows = await aiUsageLogService.exportLogs(usageFilter(req.query));
    const head = ['Time (UTC)', 'Customer', 'User', 'Email', 'Type', 'Action', 'Purpose', 'Provider', 'Model', 'Size / aspect', 'Quality', 'Mode', 'Input tokens', 'Output tokens', 'Tokens estimated', 'Reference images', 'Attempts', 'Video seconds', 'Duration ms', 'Unit cost USD', 'Total cost USD', 'Post id', 'Output URL'];
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([
        new Date(r.createdAt).toISOString(), r.customerName, r.userName, r.userEmail, r.type, r.action, r.purpose, r.provider, r.model, r.size, r.quality, r.mode,
        r.inputTokens || 0, r.outputTokens || 0, r.tokensEstimated ? 'yes' : '', r.referenceImages || 0, r.attempts || 1, r.videoSeconds || 0, r.durationMs || 0,
        (r.unitCostUsd ?? r.estimatedCostUsd ?? 0).toFixed(5), (r.estimatedCostUsd || 0).toFixed(5), r.post || '', r.imageUrl || r.videoUrl || ''
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ai-usage-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Usage Estimator + AI pricing (Admin -> Usage Estimator)
// ---------------------------------------------------------------------------

/** Everything the estimator page needs on load: choices, active models, current rates. */
export async function getEstimatorSettings(_req, res, next) {
  try {
    res.json(await getEstimatorConfig());
  } catch (err) {
    next(err);
  }
}

/** Pure arithmetic over the saved rates - safe to call on every slider move. */
export async function postUsageEstimate(req, res, next) {
  try {
    res.json(await estimateUsage(req.body || {}));
  } catch (err) {
    next(err);
  }
}

/**
 * Asks the AI (Claude + live web search) for current list prices of the
 * models this workspace has selected. Returns a PROPOSAL only - nothing is
 * saved until the admin reviews it and calls savePricingSettings.
 * body.includeAll = also price every other configured model (for what-ifs).
 */
export async function fetchPricingProposal(req, res, next) {
  try {
    if (!pricingFetch.isConfigured()) {
      return res.status(400).json({ error: 'Price lookup needs Anthropic (it does the web search). Add ANTHROPIC_API_KEY to server/.env first.' });
    }
    const active = await resolveActiveProviders();
    const includeAll = Boolean(req.body?.includeAll);
    const all = includeAll ? configuredProviders() : { text: [], image: [], video: [] };
    const uniq = (list) => [...new Set(list)];
    const toTargets = (kind, providers) =>
      uniq(providers)
        .map((provider) => ({ provider, model: modelIdFor(kind, provider) }))
        .filter((t) => t.model);

    const targets = {
      text: toTargets('text', [active.copy, active.vision, active.template, ...all.text]),
      image: toTargets('image', [active.image, ...all.image]),
      video: toTargets('video', [active.video, ...all.video])
    };
    const result = await pricingFetch.fetchPricingForModels(targets);
    res.json({ ...result, targets });
  } catch (err) {
    next(err);
  }
}

/** Saves the admin-approved (and possibly hand-edited) rates. */
export async function savePricingSettings(req, res, next) {
  try {
    const { pricing, source, modelIds, sources, notes, usdToInr } = req.body || {};
    if (!pricing || typeof pricing !== 'object') return res.status(400).json({ error: 'pricing is required.' });
    res.json(await savePricing({ pricing, source, modelIds, sources, notes, usdToInr, updatedBy: req.user?.email || '' }));
  } catch (err) {
    next(err);
  }
}

/** Back to the built-in ballpark prices. */
export async function resetPricingSettings(_req, res, next) {
  try {
    res.json(await resetPricing());
  } catch (err) {
    next(err);
  }
}

export async function getSavedPricing(_req, res, next) {
  try {
    res.json(await getPricing());
  } catch (err) {
    next(err);
  }
}

// ---- Blanket instructions: the standing text the app adds to AI prompts (agency-wide, agency admins only) ----
export async function getBlanketRules(req, res, next) {
  try {
    res.json({ groups: RULE_GROUPS, rules: await listBlanketRules() });
  } catch (err) {
    next(err);
  }
}

export async function updateBlanketRule(req, res, next) {
  try {
    const { enabled, text } = req.body || {};
    res.json({ rules: await saveBlanketRule(req.params.key, { enabled, text }) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export async function resetBlanketRuleSetting(req, res, next) {
  try {
    res.json({ rules: await resetBlanketRule(req.params.key) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
