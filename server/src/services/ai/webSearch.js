import Anthropic from '@anthropic-ai/sdk';

// Live web search with automatic fallback. Competitor watch, competitor detection and industry news all need an AI that can
// search the web. Anthropic is tried first; if it fails for any reason (credits used up, rate limit, outage, bad key) the same
// question goes to OpenAI, then Gemini. Order can be changed with WEB_SEARCH_PRIORITY (e.g. "openai,anthropic,gemini").
// Callers get the parsed JSON array back and never see a provider's raw error text.

const TIMEOUT_MS = 90000;

const hasKey = {
  anthropic: () => Boolean(process.env.ANTHROPIC_API_KEY),
  openai: () => Boolean(process.env.OPENAI_API_KEY),
  gemini: () => Boolean(process.env.GEMINI_API_KEY)
};

function order() {
  const raw = (process.env.WEB_SEARCH_PRIORITY || 'anthropic,openai,gemini').split(',').map((s) => s.trim().toLowerCase());
  const list = raw.filter((p) => hasKey[p]);
  return list.length ? list : ['anthropic', 'openai', 'gemini'];
}

/** True when at least one provider that can search the web has a key. */
export function searchAvailable() {
  return order().some((p) => hasKey[p]());
}

function parseJsonArray(text) {
  const match = String(text || '').match(/\[[\s\S]*\]/);
  if (!match) throw new Error('The answer did not contain a parseable list.');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error('The answer was not a list.');
  return parsed;
}

async function viaAnthropic({ prompt, retryHint, country }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-4-5';
  const tool = { type: 'web_search_20250305', name: 'web_search', ...(country ? { user_location: { type: 'approximate', country, timezone: country === 'IN' ? 'Asia/Kolkata' : undefined } } : {}) };
  const messages = [{ role: 'user', content: prompt }];
  const text = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  // max_tokens budgets the WHOLE turn (every search and result read, plus the answer), so it needs real headroom.
  const response = await anthropic.messages.create({ model, max_tokens: 3000, tools: [tool], messages });
  try {
    return parseJsonArray(text(response));
  } catch (err) {
    // One retry that keeps the searches already done and asks for the JSON only.
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: `Stop searching. Based on what you already found, respond right now with ONLY the JSON array described earlier${retryHint ? ` (${retryHint})` : ''} - no markdown fences, no commentary, nothing else.` });
    const retry = await anthropic.messages.create({ model, max_tokens: 1200, messages });
    return parseJsonArray(text(retry));
  }
}

async function viaOpenAI({ prompt, country }) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_SEARCH_MODEL || process.env.OPENAI_TEXT_MODEL || 'gpt-4.1',
      tools: [{ type: 'web_search_preview', ...(country ? { user_location: { type: 'approximate', country } } : {}) }],
      input: prompt,
      max_output_tokens: 3000
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI search failed (${res.status}): ${data?.error?.message || 'unknown error'}`);
  const text = (data.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n');
  return parseJsonArray(text);
}

async function viaGemini({ prompt }) {
  const model = process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 3000 }
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini search failed (${res.status}): ${data?.error?.message || 'unknown error'}`);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n');
  return parseJsonArray(text);
}

const RUNNERS = { anthropic: viaAnthropic, openai: viaOpenAI, gemini: viaGemini };

/**
 * Runs a web-search prompt that must answer with a JSON array. Tries each configured provider in turn.
 * Throws an error with `searchUnavailable = true`, status 503 and a customer-safe message when none could answer.
 * @param {{ prompt: string, retryHint?: string, country?: string, purpose?: string }} args
 */
export async function searchJsonArray({ prompt, retryHint = '', country = '', purpose = 'web search' }) {
  const failures = [];
  for (const provider of order()) {
    if (!hasKey[provider]()) continue;
    try {
      const items = await RUNNERS[provider]({ prompt, retryHint, country });
      if (failures.length) console.warn(`[webSearch] ${purpose}: answered by ${provider} after ${failures.map((f) => f.provider).join(', ')} failed`);
      return items;
    } catch (err) {
      failures.push({ provider, message: err?.message || String(err) });
      console.warn(`[webSearch] ${purpose}: ${provider} failed - ${String(err?.message || err).slice(0, 300)}`);
    }
  }
  const err = new Error(failures.length ? 'Live search is temporarily unavailable. Please try again in a little while.' : 'Live search needs an AI provider with web search (Anthropic, OpenAI or Gemini) to be configured.');
  err.status = failures.length ? 503 : 400;
  err.searchUnavailable = true;
  err.failures = failures;
  throw err;
}
