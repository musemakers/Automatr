import { assertSafeWebhookUrl } from '../deliveryService.js';

// A provider module (same shape as providers/openai.js etc.) for a user-added, OpenAI-compatible
// text or image model. Built from a "Custom model" block. The API key is read from a server env
// variable named CUSTOM_AI_*; it is never stored in the database or sent to the browser.

const TIMEOUT_MS = 120000;

export function makeCustomProvider(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const key = () => process.env[cfg.apiKeyEnv] || '';

  async function call(path, body) {
    if (!key()) throw new Error(`${cfg.label} is not configured (missing ${cfg.apiKeyEnv} in server/.env).`);
    await assertSafeWebhookUrl(`${base}${path}`); // https + public address only
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    if (!res.ok) throw new Error(`${cfg.label} responded ${res.status}: ${(json?.error?.message || raw || '').slice(0, 300)}`);
    return json;
  }

  return {
    name: `custom:${cfg.label}`,
    isConfigured: () => Boolean(key()),
    textModelName: () => cfg.model,
    imageModelName: () => cfg.model,

    async generateText({ system, prompt, maxTokens = 400 }) {
      if (cfg.kind !== 'text') throw new Error(`${cfg.label} is an image model.`);
      const json = await call('/chat/completions', {
        model: cfg.model,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }]
      });
      return json?.choices?.[0]?.message?.content?.trim() || '';
    },

    async generateImage({ prompt, size }) {
      if (cfg.kind !== 'image') throw new Error(`${cfg.label} is a text model.`);
      const json = await call('/images/generations', { model: cfg.model, prompt, size, n: 1 });
      const item = json?.data?.[0];
      if (item?.b64_json) return { b64: item.b64_json, mimeType: 'image/png' };
      if (item?.url) {
        await assertSafeWebhookUrl(item.url);
        const r = await fetch(item.url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) throw new Error(`${cfg.label}: could not download the generated image (${r.status}).`);
        return { b64: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType: r.headers.get('content-type') || 'image/png' };
      }
      throw new Error(`${cfg.label} returned no image.`);
    },

    async analyzeImage() {
      throw new Error(`${cfg.label} does not support image analysis.`);
    }
  };
}
