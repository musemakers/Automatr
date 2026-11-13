import { searchJsonArray, searchAvailable } from './ai/webSearch.js';

// Web search goes through ai/webSearch.js: Anthropic first, then OpenAI, then Gemini if the earlier one fails.
export function isConfigured() {
  return searchAvailable();
}

// ---------------------------------------------------------------------------
// Competitor news cache - same pattern as industryData.js's live news cache:
// avoids re-running the (paid, several-second) web search on every dashboard
// load. Cached per user for COMPETITOR_NEWS_CACHE_MINUTES (default 240 = 4
// hours), keyed by user id + the exact competitor list so a manual edit to
// the list is picked up immediately rather than serving stale results for a
// different set of brands. Resets on server restart and isn't shared across
// multiple server instances - fine for this app's scale, same tradeoff the
// news cache already makes.
// ---------------------------------------------------------------------------
const competitorNewsCache = new Map(); // cacheKey -> { items, fetchedAt }
const CACHE_MS = (Number(process.env.COMPETITOR_NEWS_CACHE_MINUTES) || 240) * 60 * 1000;

function cacheKeyFor(userId, competitors) {
  const names = competitors.map((c) => c.name).sort().join('|');
  return `${userId}:${names}`;
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Response did not contain a parseable list.');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error('Response JSON was not an array.');
  return parsed;
}

function extractText(response) {
  return (response.content || [])
    .filter((block) => block.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Identifies the top 5 real competitor brands for a given company/industry,
 * via Claude with web search enabled (same infra as newsSearch.js's
 * industry news) so the list reflects the actual current market rather
 * than the model's training-data guess of who "usually" competes there.
 * Competitors are limited to one country: the customer's, or India when none was specified.
 * @param {{ industry: string, companyName?: string, country?: string }} args
 * @returns {Promise<Array<{name: string, website: string, oneLiner: string}>>}
 */
export async function detectCompetitors({ industry, companyName = '', country = '' }) {
  const market = String(country || '').trim() || 'India';


  const prompt = [
    `Search the web to identify the top 5 real, current competitor brands in the "${industry}" industry that are based in or primarily operate in ${market}`,
    companyName ? `for a company called "${companyName}" (do not include ${companyName} itself in the list).` : '.',
    `Only include brands headquartered in or actively selling in ${market}; do not list global or foreign brands that have no real presence there.`,
    'Prioritize brands that are genuinely comparable in size/market position where possible, not just the single largest player repeated - a realistic competitive set a marketer would actually benchmark against.',
    'After searching, respond with ONLY a JSON array (no markdown fences, no commentary) of exactly 5 objects shaped like:',
    '[{"name": "Brand Name", "website": "https://example.com", "oneLiner": "one short sentence on what makes them a competitor"}]',
    'Every entry must be a real, verifiable brand you found via search - do not invent one to fill the list.'
  ].join(' ');

  const parsed = await searchJsonArray({ prompt, retryHint: 'exactly 5 objects', country: '', purpose: 'detecting competitors' });

  return parsed
    .filter((item) => item && item.name)
    .slice(0, 5)
    .map((item) => ({
      name: String(item.name).trim(),
      website: typeof item.website === 'string' ? item.website.trim() : '',
      oneLiner: typeof item.oneLiner === 'string' ? item.oneLiner.trim() : ''
    }));
}

/**
 * Finds recent news/mentions for a specific list of competitor brands -
 * same web-search-grounded approach as fetchLiveIndustryNews, but scoped to
 * named competitors instead of the industry in general, so results read as
 * "here's what your competitors are actually doing" rather than generic
 * industry news. Not cached itself - see getCompetitorNewsCached below,
 * which is what callers should actually use.
 * @param {{ competitors: Array<{name: string}>, count?: number }} args
 */
async function fetchCompetitorNewsUncached({ competitors, count = 6 }) {
  if (!competitors?.length) return [];

  const names = competitors.map((c) => c.name);

  const prompt = [
    `Search the web for recent news, launches, campaigns, or notable moves from these specific companies: ${names.join(', ')}.`,
    `Find up to ${count} distinct, recent items total across all of them (product launches, marketing campaigns, funding, notable social/PR moments, etc) - a mix across the different companies where possible, not all from one.`,
    'After searching, respond with ONLY a JSON array (no markdown fences, no commentary) of objects shaped exactly like:',
    '[{"competitor": "which of the given company names this is about", "title": "short headline", "desc": "one sentence of context", "source": "publisher or outlet name", "time": "e.g. 2H AGO, 1D AGO", "url": "the exact, direct URL of the page you found this on"}]',
    'Every item must be grounded in what you actually found via search - do not invent or speculate, and do not guess at a URL if you are not certain of it (omit the field instead). If you find fewer than the requested count, return fewer.'
  ].join(' ');

  const parsed = await searchJsonArray({ prompt, purpose: 'competitor news' });

  return parsed
    .filter((item) => item && item.title)
    .slice(0, count)
    .map((item) => ({
      competitor: item.competitor || '',
      title: item.title,
      desc: item.desc || '',
      source: item.source || 'WEB SEARCH',
      time: item.time || 'RECENTLY',
      image: `https://picsum.photos/seed/${encodeURIComponent(slugify(item.title))}/160/160`,
      url: isValidHttpUrl(item.url) ? item.url : ''
    }));
}

/**
 * Cached entry point for competitor news - what the controller actually
 * calls. Returns cached results (with their original fetch time) if still
 * fresh for this exact user+competitor-list combination; otherwise runs a
 * fresh web search and caches it. Pass `force: true` to bypass the cache
 * regardless of freshness (used by the dashboard's manual "Refresh" button).
 * @param {{ userId: string, competitors: Array<{name: string}>, count?: number, force?: boolean }} args
 * @returns {Promise<{ items: Array, fetchedAt: number, cached: boolean }>}
 */
export async function getCompetitorNewsCached({ userId, competitors, count = 6, force = false }) {
  if (!competitors?.length) return { items: [], fetchedAt: null, cached: false };

  const key = cacheKeyFor(userId, competitors);
  const cached = competitorNewsCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return { items: cached.items, fetchedAt: cached.fetchedAt, cached: true };
  }

  let items;
  try {
    items = await fetchCompetitorNewsUncached({ competitors, count });
  } catch (err) {
    // Every provider failed: keep showing the last results (even if older than the cache window) rather than an error.
    if (cached?.items?.length) return { items: cached.items, fetchedAt: cached.fetchedAt, cached: true, stale: true };
    throw err;
  }
  const fetchedAt = Date.now();
  competitorNewsCache.set(key, { items, fetchedAt });
  return { items, fetchedAt, cached: false };
}

function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
}
