import { searchJsonArray, searchAvailable } from './webSearch.js';

// The customer's country is free text ("India", "UAE", "United Kingdom"...). Resolve it to a
// market name (used in the prompt) and an ISO code (used to bias the search). Blank = India,
// which is the app's default market.
const ALIASES = { uk: 'GB', 'u.k.': 'GB', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US', uae: 'AE', england: 'GB', scotland: 'GB', wales: 'GB', 'south korea': 'KR', russia: 'RU', vietnam: 'VN', turkey: 'TR', 'türkiye': 'TR' };
let nameToCode = null;
function buildNameMap() {
  const map = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of L) for (const b of L) {
      const code = a + b;
      const name = dn.of(code);
      if (name && name !== code && !map.has(name.toLowerCase())) map.set(name.toLowerCase(), code);
    }
  } catch { /* Intl.DisplayNames unavailable - fall back to aliases only */ }
  return map;
}
export function resolveMarket(country) {
  const raw = String(country || '').trim();
  if (!raw) return { name: 'India', code: 'IN' };
  const key = raw.toLowerCase();
  if (!nameToCode) nameToCode = buildNameMap();
  let code = ALIASES[key] || nameToCode.get(key) || (/^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : '');
  let name = raw;
  if (code) {
    try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || raw; } catch { /* keep raw */ }
  }
  return { name, code };
}

// Web search goes through webSearch.js: Anthropic first, then OpenAI, then Gemini if the earlier one fails.
export function isConfigured() {
  return searchAvailable();
}

/**
 * Asks Claude, with web search enabled, for real and current social-media /
 * marketing-relevant news for the given industry. Returns an array of items
 * shaped like the rest of the app's news items ({ title, desc, source, time, url }),
 * built only from what the search actually turned up (no invented facts).
 *
 * @param {{ industry: string, count?: number }} args
 */
export async function fetchLiveIndustryNews({ industry, count = 3, country = '' }) {
  const market = resolveMarket(country);
  const isIndia = market.code === 'IN';

  const prompt = [
    `Search the web for real, current news relevant to a social media marketer working in the "${industry}" industry in ${market.name.toUpperCase()}.`,
    isIndia
      ? 'Restrict everything to India: only include stories about the Indian market, Indian brands, Indian consumers, Indian regulation, or platform/product changes explicitly affecting users or marketers in India, preferably from Indian outlets (e.g. Economic Times, Mint, Business Standard, Moneycontrol, afaqs!, Exchange4media, The Hindu BusinessLine, Hindustan Times, Inc42, YourStory). Skip purely global or other-country stories, and prefer INR figures and Indian context.'
      : `Restrict everything to ${market.name}: only include stories about the ${market.name} market, brands, consumers and regulation, or platform/product changes explicitly affecting users or marketers in ${market.name}, preferably from respected local outlets. Skip purely global stories and stories about other countries, and use local currency and local context. Do not include Indian news unless ${market.name} is India.`,
    `Find up to ${count} distinct, recent items (product launches, platform/algorithm changes, campaign trends, notable competitor moves, etc).`,
    'After searching, respond with ONLY a JSON array (no markdown fences, no commentary) of objects shaped exactly like:',
    '[{"title": "short headline", "desc": "one sentence of context", "source": "publisher or outlet name", "time": "e.g. 2H AGO, 1D AGO", "url": "the exact, direct URL of the page you found this on"}]',
    'Every item must be grounded in what you actually found via search - do not invent or speculate, and do not guess at a URL if you are not certain of it (omit the field instead). If you find fewer than the requested count, return fewer.'
  ].join(' ');

  const parsed = await searchJsonArray({ prompt, country: market.code, purpose: `industry news (${market.name})` });

  return parsed
    .filter((item) => item && item.title)
    .slice(0, count)
    .map((item) => ({
      title: item.title,
      desc: item.desc || '',
      source: item.source || 'WEB SEARCH',
      time: item.time || 'RECENTLY',
      // Claude's web search tool returns text/citations, not photos, so
      // there's no real source image available here. Use the same kind of
      // decorative stock-photo placeholder as curated items (see
      // industrySegmentsService.js) rather than showing a blank thumbnail -
      // seeded by the headline so the same story always gets the same image.
      image: `https://picsum.photos/seed/${encodeURIComponent(slugify(item.title))}/160/160`,
      url: isValidHttpUrl(item.url) ? item.url : ''
    }));
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
