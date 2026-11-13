import * as router from './ai/router.js';
import * as newsSearch from './ai/newsSearch.js';
import { resolveMarket } from './ai/newsSearch.js';
import IndustrySegment from '../models/IndustrySegment.js';
import { getSettings } from './appSettingsService.js';

// Used when a segment exists but has no curated tickers/news yet (e.g. a
// newly admin-created segment), or when the requested industry doesn't
// match any segment at all. Kept intentionally generic/broad-market rather
// than borrowing another industry's numbers.
const GENERIC_FALLBACK = {
  tickers: [
    { symbol: 'SPY', price: 512.4, change: 0.4 },
    { symbol: 'DIA', price: 388.1, change: 0.2 },
    { symbol: 'QQQ', price: 421.7, change: 0.6 },
    { symbol: 'VTI', price: 245.9, change: 0.3 },
    { symbol: 'IWM', price: 198.2, change: -0.3 }
  ],
  news: [
    { title: 'Short-form video continues to outperform static posts across most sectors', desc: 'Engagement data broadly favors 15-30 second clips over single images this quarter.', source: 'TRENDWATCH', time: '4H AGO', image: 'https://picsum.photos/seed/trendwatch-shortform/160/160' },
    { title: 'Founder-led and behind-the-scenes content is outperforming polished campaigns', desc: 'Audiences are responding to authenticity over production value across categories.', source: 'MARKET SCAN', time: '9H AGO', image: 'https://picsum.photos/seed/marketscan-founderled/160/160' },
    { title: 'Save rate is becoming a stronger signal than likes for planning content', desc: 'Marketers are increasingly optimizing for saves and shares over surface-level engagement.', source: 'RETAIL PULSE', time: '1D AGO', image: 'https://picsum.photos/seed/retailpulse-saverate/160/160' }
  ]
};

async function fetchLiveQuote(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.c !== 'number' || data.c === 0) return null;
    const change = data.pc ? ((data.c - data.pc) / data.pc) * 100 : 0;
    return { symbol, price: data.c, change: Number(change.toFixed(1)) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live news cache: avoids hitting the (paid, ~few-second) web search API on
// every single page load. Cached per industry in memory for NEWS_LIVE_CACHE_
// MINUTES (default 30). Resets on server restart and isn't shared across
// multiple server instances - fine for this app's scale, but worth knowing.
// ---------------------------------------------------------------------------
const liveNewsCache = new Map(); // `${industry}|${market}` -> { items, fetchedAt }  (market in the key so a country change never serves the old country's news)
const LIVE_CACHE_MS = (Number(process.env.NEWS_LIVE_CACHE_MINUTES) || 30) * 60 * 1000;

async function getLiveNewsCached(industry, { fresh = false, country = '' } = {}) {
  const key = `${industry}|${resolveMarket(country).name.toLowerCase()}`;
  const cached = liveNewsCache.get(key);
  if (!fresh && cached && Date.now() - cached.fetchedAt < LIVE_CACHE_MS) {
    return cached.items;
  }

  const items = await newsSearch.fetchLiveIndustryNews({ industry, count: 3, country });
  liveNewsCache.set(key, { items, fetchedAt: Date.now() });
  return items;
}

/**
 * Returns ticker + news for an industry.
 *
 * News: by default, tries real live news first (Claude web search, cached
 * ~30 min per industry - see getLiveNewsCached above), so what most people
 * see day-to-day is real reporting, not curated sample data. Falls back to
 * the admin-editable IndustrySegment collection (or a generic broad-market
 * dataset) if live news isn't configured/selected, or if the live fetch
 * fails for any reason - so the page never comes up empty.
 *
 * Tickers: always from the curated/admin data, with live Finnhub quotes
 * layered on top if FINNHUB_API_KEY is set.
 */
export async function getIndustrySnapshot(industry, { fresh = false, country = '' } = {}) {
  const segment = await IndustrySegment.findOne({ name: industry, active: true }).lean();

  const curated = {
    tickers: segment?.tickers?.length ? segment.tickers : GENERIC_FALLBACK.tickers,
    news: segment?.news?.length ? segment.news : GENERIC_FALLBACK.news
  };

  let news = curated.news;
  let newsSource = 'curated';

  const settings = await getSettings();
  if (settings.newsProvider === 'anthropic' && newsSearch.isConfigured()) {
    try {
      const liveItems = await getLiveNewsCached(industry, { fresh, country });
      if (liveItems.length) {
        news = liveItems.map((item) => ({ ...item, source: `${item.source} (via web search)` }));
        newsSource = 'live';
      } else {
        console.warn(`[news] Live search returned nothing for "${industry}", showing curated news instead.`);
      }
    } catch (err) {
      console.warn(`[news] Live search failed for "${industry}", showing curated news instead:`, err.message);
    }
  }

  if (newsSource !== 'live') {
    console.warn(`[news] Showing CURATED (non-live) news for "${industry}" - newsProvider="${settings.newsProvider}", ANTHROPIC_API_KEY ${newsSearch.isConfigured() ? 'set' : 'MISSING'}.`);
  }

  const base = { tickers: curated.tickers, news, newsSource };

  if (!process.env.FINNHUB_API_KEY) {
    return base;
  }

  const liveTickers = await Promise.all(
    base.tickers.map(async (t) => (await fetchLiveQuote(t.symbol)) || t)
  );

  return { ...base, tickers: liveTickers };
}

/**
 * Fetches one fresh news item for the industry, on top of the curated feed.
 *
 * The provider is chosen by the admin (Admin -> AI Settings), not by the
 * caller - this keeps cost/behavior centrally controlled rather than
 * per-request. Anthropic is currently the only provider with a *live*
 * implementation (real web search, cited sources - see ai/newsSearch.js).
 * Providers without one fall back to the older speculative-blurb generator,
 * clearly labeled as AI-generated rather than verified reporting.
 */
export async function generateFreshTrendBlurb(industry, country = '') {
  const settings = await getSettings();
  const provider = settings.newsProvider;

  if (provider === 'anthropic' && newsSearch.isConfigured()) {
    try {
      const items = await newsSearch.fetchLiveIndustryNews({ industry, count: 1, country });
      if (items.length) {
        const item = items[0];
        return { ...item, source: `${item.source} (via web search)` };
      }
      console.warn(`[news] Anthropic web search returned no usable items for "${industry}", falling back to speculative blurb.`);
    } catch (err) {
      console.warn(`[news] Anthropic web search failed for "${industry}", falling back to speculative blurb:`, err.message);
    }
    // Falls through to the speculative generator below rather than
    // surfacing an error to the user.
  }

  return generateSpeculativeBlurb(industry, provider, country);
}

/**
 * Older behavior kept as a fallback: asks a text model (no web access) to
 * write a plausible-sounding trend observation. Always clearly labeled as
 * AI-generated speculation, never presented as verified reporting.
 */
async function generateSpeculativeBlurb(industry, model = 'auto', country = '') {
  const market = resolveMarket(country).name;
  const prompt = [
    `You cover social media marketing trends for the ${industry} industry in ${market}.`,
    `Keep it specific to the ${market} market and audience; do not reference other countries.`,
    'Write one short, plausible, specific trend observation a marketer could act on this week.',
    'Format as JSON only: {"title": "...", "desc": "..."}. No markdown, no commentary.'
  ].join(' ');

  const { text, modelUsed } = await router.generateText({ model, prompt, maxTokens: 150 });

  try {
    const cleaned = text.replace(/^```json|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const slug = (parsed.title || 'ai-signal').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    return {
      title: parsed.title,
      desc: parsed.desc,
      source: `AI SIGNAL - speculative (${modelUsed})`,
      time: 'JUST NOW',
      image: `https://picsum.photos/seed/${encodeURIComponent(slug)}/160/160`
    };
  } catch {
    return null;
  }
}
