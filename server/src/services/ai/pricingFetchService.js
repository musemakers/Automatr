import Anthropic from '@anthropic-ai/sdk';
import { IMAGE_RESOLUTIONS, PROVIDER_LABELS } from '../../constants/usageEstimator.js';

// Looks up CURRENT list prices for the exact models this workspace has
// selected, using Claude with live web search (same mechanism as the news
// feed - see newsSearch.js). It only ever PROPOSES prices: nothing is stored
// until an admin reviews and saves them (see admin.settings.controller.js).
// AI-read prices can be wrong or out of date, so every figure carries its
// source URL and a confidence flag, and out-of-range values are discarded.

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Sanity ceilings - anything above is almost certainly a misread (e.g. per-1K vs per-1M, cents vs dollars).
const MAX_TEXT_PER_1M = 500;
const MAX_IMAGE_USD = 50;
const MAX_VIDEO_PER_SECOND = 20;

const validUrl = (u) => {
  try {
    const p = new URL(String(u).trim());
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : '';
  } catch {
    return '';
  }
};
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null);

/**
 * @param {{ text: Array<{provider:string, model:string}>, image: Array<{provider:string, model:string}>, video: Array<{provider:string, model:string}> }} targets
 * @returns {Promise<{ proposed: {text:object, image:object, video:object}, sources: object[], warnings: string[], modelIds: object }>}
 */
export async function fetchPricingForModels(targets) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Price lookup needs Anthropic (it does the web search). Add ANTHROPIC_API_KEY to server/.env first.');

  const model = process.env.PRICING_FETCH_MODEL || process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-4-5';
  const describe = (list) => (list.length ? list.map((t) => `- provider key "${t.provider}": ${PROVIDER_LABELS[t.provider] || t.provider}, exact model id "${t.model}"`).join('\n') : '(none)');

  const prompt = [
    `Today is ${new Date().toISOString().slice(0, 10)}. Use web search to find the CURRENT official list prices (USD) for these exact AI models. Prefer each vendor's own pricing page or docs over third-party sites.`,
    '',
    'TEXT models (price per 1,000,000 tokens, standard on-demand tier: not batch, not cached, normal context length):',
    describe(targets.text),
    '',
    'IMAGE models (price per generated image at three output sizes: 1K ~1024px, 2K ~2048px, 4K ~4096px on the long edge). If a vendor bills by tokens or by quality tier, convert to a per-image USD figure for a typical general-purpose image at that size, using the highest quality setting the vendor offers by default, and say how you converted in "note". If a size is not offered, use null for it.',
    describe(targets.image),
    '',
    'VIDEO models (price per second of generated video, WITHOUT audio, at 720p; if billed per token or per clip, convert to USD per second and say how in "note"):',
    describe(targets.video),
    '',
    'Also find today\'s USD to INR exchange rate (rupees per 1 US dollar) from a reputable source (RBI reference rate, a bank or a major currency site).',
    'If the exact model id has no published price, use the closest published sibling and say so in "note" with confidence "low". Never guess silently.',
    'When finished searching, respond with ONLY one JSON object (no markdown fences, no commentary) shaped exactly like:',
    '{"text": {"<provider key>": {"model": "...", "inputPer1M": 0.0, "outputPer1M": 0.0, "sourceUrl": "https://...", "note": "...", "confidence": "high|medium|low"}},',
    ' "image": {"<provider key>": {"model": "...", "perImage": {"1K": 0.0, "2K": 0.0, "4K": 0.0}, "sourceUrl": "https://...", "note": "...", "confidence": "high|medium|low"}},',
    ' "video": {"<provider key>": {"model": "...", "perSecond": 0.0, "sourceUrl": "https://...", "note": "...", "confidence": "high|medium|low"}}}',
    'Add one more top-level key: "fx": {"usdToInr": 0.0, "sourceUrl": "https://..."}.',
    'Include only the provider keys listed above. Numbers must be plain USD numbers (no currency symbols). Every figure must come from what you actually found.'
  ].join('\n');

  const messages = [{ role: 'user', content: prompt }];
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }];
  const textOf = (res) => (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

  // Web search turns can pause mid-way on long lookups - keep going (bounded).
  let response = await anthropic.messages.create({ model, max_tokens: 8000, tools, messages });
  for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
    messages.push({ role: 'assistant', content: response.content });
    response = await anthropic.messages.create({ model, max_tokens: 8000, tools, messages });
  }

  const parse = (text) => {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('The price lookup did not return readable JSON.');
    return JSON.parse(text.slice(start, end + 1));
  };

  let raw;
  const first = textOf(response);
  try {
    raw = parse(first);
  } catch (err) {
    console.warn('[pricingFetch] first response not parseable, retrying once:', err.message, '| raw:', first.slice(0, 400));
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: 'Stop searching. Based on what you already found, respond right now with ONLY the JSON object described earlier - no markdown fences, no commentary.' });
    const retry = await anthropic.messages.create({ model, max_tokens: 3000, messages });
    raw = parse(textOf(retry));
  }

  const proposed = { text: {}, image: {}, video: {} };
  const sources = [];
  const warnings = [];
  const addSource = (kind, provider, entry, modelId) => {
    sources.push({
      label: `${PROVIDER_LABELS[provider] || provider} - ${entry?.model || modelId}`,
      kind,
      url: validUrl(entry?.sourceUrl),
      note: typeof entry?.note === 'string' ? entry.note.slice(0, 400) : '',
      confidence: ['high', 'medium', 'low'].includes(entry?.confidence) ? entry.confidence : 'low'
    });
  };
  const drop = (what) => warnings.push(`Ignored ${what}: missing or outside the expected range.`);

  for (const t of targets.text) {
    const e = raw?.text?.[t.provider];
    if (!e) { warnings.push(`No price returned for ${PROVIDER_LABELS[t.provider]} text.`); continue; }
    const input = num(e.inputPer1M, MAX_TEXT_PER_1M);
    const output = num(e.outputPer1M, MAX_TEXT_PER_1M);
    if (input === null || output === null) { drop(`${PROVIDER_LABELS[t.provider]} text price`); continue; }
    proposed.text[t.provider] = { input, output };
    addSource('text', t.provider, e, t.model);
  }
  for (const t of targets.image) {
    const e = raw?.image?.[t.provider];
    if (!e) { warnings.push(`No price returned for ${PROVIDER_LABELS[t.provider]} images.`); continue; }
    const row = {};
    for (const r of IMAGE_RESOLUTIONS) {
      const v = num(e.perImage?.[r.id], MAX_IMAGE_USD);
      if (v !== null) row[r.id] = v;
    }
    if (!Object.keys(row).length) { drop(`${PROVIDER_LABELS[t.provider]} image price`); continue; }
    proposed.image[t.provider] = row;
    addSource('image', t.provider, e, t.model);
  }
  for (const t of targets.video) {
    const e = raw?.video?.[t.provider];
    if (!e) { warnings.push(`No price returned for ${PROVIDER_LABELS[t.provider]} video.`); continue; }
    const perSecond = num(e.perSecond, MAX_VIDEO_PER_SECOND);
    if (perSecond === null) { drop(`${PROVIDER_LABELS[t.provider]} video price`); continue; }
    proposed.video[t.provider] = { perSecond };
    addSource('video', t.provider, e, t.model);
  }

  let fx = null;
  const rate = num(raw?.fx?.usdToInr, 1000);
  if (rate !== null && rate >= 20) fx = { usdToInr: rate, sourceUrl: validUrl(raw?.fx?.sourceUrl) };
  else warnings.push('No usable USD to INR rate returned - the current rate was left unchanged.');

  const modelIds = {
    text: Object.fromEntries(targets.text.map((t) => [t.provider, t.model])),
    image: Object.fromEntries(targets.image.map((t) => [t.provider, t.model])),
    video: Object.fromEntries(targets.video.map((t) => [t.provider, t.model]))
  };
  return { proposed, sources, warnings, modelIds, fx };
}
