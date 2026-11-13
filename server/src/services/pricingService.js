import PricingConfig from '../models/PricingConfig.js';
import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  VIDEO_PROVIDERS,
  IMAGE_RESOLUTIONS,
  defaultPricing,
  DEFAULT_USD_TO_INR
} from '../constants/usageEstimator.js';

// Store + in-memory cache for admin-approved pricing. Deliberately has NO
// dependency on the AI routers so costEstimateService.js (which designService
// imports) can read it synchronously without creating an import cycle.

const KEY = 'global';
let cache = null; // merged pricing, only when an admin has saved real prices
let fxCache = null; // saved ₹ per US$ (null = use DEFAULT_USD_TO_INR)

const isPrice = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Deep-merges stored rates over the defaults, ignoring anything that isn't a valid number. */
function mergeOverDefaults(stored = {}) {
  const out = defaultPricing();
  for (const p of IMAGE_PROVIDERS) {
    for (const r of IMAGE_RESOLUTIONS) {
      const v = stored.image?.[p]?.[r.id];
      if (isPrice(v)) out.image[p][r.id] = v;
    }
  }
  for (const p of TEXT_PROVIDERS) {
    for (const k of ['input', 'output']) {
      const v = stored.text?.[p]?.[k];
      if (isPrice(v)) out.text[p][k] = v;
    }
  }
  for (const p of VIDEO_PROVIDERS) {
    const v = stored.video?.[p]?.perSecond;
    if (isPrice(v)) out.video[p].perSecond = v;
  }
  return out;
}

/** The full pricing view for the admin page: effective rates + provenance. */
export async function getPricing() {
  const doc = await PricingConfig.findOne({ key: KEY }).lean();
  const pricing = mergeOverDefaults(doc || {});
  const savedFx = typeof doc?.usdToInr === 'number' && doc.usdToInr > 0 ? doc.usdToInr : null;
  return {
    pricing,
    fx: { usdToInr: savedFx ?? DEFAULT_USD_TO_INR, updatedAt: savedFx ? doc.fxUpdatedAt || null : null, isDefault: savedFx === null },
    meta: {
      source: doc?.source || 'default',
      fetchedAt: doc?.fetchedAt || null,
      updatedAt: doc?.updatedAt || null,
      modelIds: doc?.modelIds || {},
      sources: doc?.sources || [],
      notes: doc?.notes || ''
    }
  };
}

/**
 * Saves admin-approved pricing. Only valid, non-negative numbers for known
 * providers/resolutions are kept; everything else is dropped (so a bad AI
 * response or a typo can never poison the estimator).
 */
export async function savePricing({ pricing, source = 'manual', modelIds, sources, notes, updatedBy, usdToInr }) {
  const clean = mergeOverDefaults(pricing || {});
  const fx = Number(usdToInr);
  const fxOk = Number.isFinite(fx) && fx >= 1 && fx <= 1000;
  const doc = await PricingConfig.findOneAndUpdate(
    { key: KEY },
    {
      $set: {
        image: clean.image,
        text: clean.text,
        video: clean.video,
        source: source === 'ai' ? 'ai' : 'manual',
        fetchedAt: source === 'ai' ? new Date() : undefined,
        modelIds: modelIds || {},
        sources: Array.isArray(sources) ? sources.slice(0, 40) : [],
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
        updatedBy: updatedBy || '',
        ...(fxOk ? { usdToInr: fx, fxUpdatedAt: new Date() } : {})
      }
    },
    { upsert: true, new: true }
  ).lean();
  cache = mergeOverDefaults(doc);
  fxCache = typeof doc?.usdToInr === 'number' && doc.usdToInr > 0 ? doc.usdToInr : null;
  return getPricing();
}

/** Back to the static ballpark numbers. */
export async function resetPricing() {
  await PricingConfig.deleteOne({ key: KEY });
  cache = null;
  fxCache = null;
  return getPricing();
}

/** Loads the cache at startup / after changes. Never throws. */
export async function loadPricingCache() {
  try {
    const doc = await PricingConfig.findOne({ key: KEY }).lean();
    cache = doc && doc.source !== 'default' ? mergeOverDefaults(doc) : null;
    fxCache = typeof doc?.usdToInr === 'number' && doc.usdToInr > 0 ? doc.usdToInr : null;
  } catch (err) {
    console.warn('[pricing] could not load saved pricing, using built-in ballparks:', err.message);
    cache = null;
    fxCache = null;
  }
}

/** The ₹ per US$ rate in force right now (saved on the Usage Estimator page, else the built-in default). Stored on every usage row. */
export function getFxRateSync() {
  return fxCache || DEFAULT_USD_TO_INR;
}

/** Sync read for costEstimateService: saved pricing, or null when the admin hasn't saved any. */
export function getSavedPricingSync() {
  return cache;
}
