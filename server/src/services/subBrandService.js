import * as router from './ai/router.js';

// Sub-brands live on the customer (Customer.subBrands). Each has its own brandKit (analysed from the
// assets uploaded to it), name, description and keywords. These helpers pick the right one for a brief
// and layer its kit over the main brand's, so every prompt that reads user.brandKit "just works".

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const hasText = (v) => typeof v === 'string' && v.trim() !== '';

export function listSubBrands(customer) {
  return (customer?.subBrands || []).map((s) => (s.toObject ? s.toObject() : s));
}

export function findSubBrand(customer, id) {
  if (!id) return null;
  return (customer?.subBrands || []).find((s) => String(s._id) === String(id)) || null;
}

/** Whole-word / phrase match of a sub-brand's name + keywords against the brief text. Longest match wins. */
export function detectByKeyword(subBrands, text) {
  const hay = ` ${norm(text)} `;
  if (!hay.trim()) return null;
  let best = null;
  for (const s of subBrands || []) {
    const terms = [s.name, ...(s.keywords || [])].map(norm).filter(Boolean);
    for (const t of terms) {
      if (hay.includes(` ${t} `)) {
        const score = t.length + (t === norm(s.name) ? 0.5 : 0);
        if (!best || score > best.score) best = { sub: s, score, term: t };
      }
    }
  }
  return best ? { sub: best.sub, method: 'keyword', matched: best.term } : null;
}

/** Fallback when no keyword matches: ask the text model which sub-brand (if any) the brief is about. */
export async function detectByAi(subBrands, text) {
  if (!subBrands?.length || !hasText(text)) return null;
  const list = subBrands.map((s, i) => `${i + 1}. ${s.name}${s.description ? ` - ${s.description}` : ''}${s.keywords?.length ? ` (keywords: ${s.keywords.join(', ')})` : ''}`).join('\n');
  try {
    const { text: out, modelUsed } = await router.generateText({
      system: 'You route marketing briefs to the right sub-brand. Answer with ONLY a JSON object.',
      prompt: `Sub-brands:\n${list}\n\nBrief:\n${String(text).slice(0, 1500)}\n\nWhich sub-brand is this brief clearly about? Reply {"index": <number from the list>} or {"index": null} if it is about the main brand or you are not sure.`,
      maxTokens: 60,
      purpose: 'sub-brand detection'
    });
    if (modelUsed === 'placeholder') return null;
    const m = String(out || '').match(/\{[\s\S]*?\}/);
    const idx = m ? JSON.parse(m[0]).index : null;
    const sub = Number.isInteger(idx) ? subBrands[idx - 1] : null;
    return sub ? { sub, method: 'ai' } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve which sub-brand a request is for.
 *  choice: 'main' -> none; a sub-brand id -> that one; 'auto'/undefined -> detect from the brief.
 *  useAi:  allow the model fallback when keywords don't match (only where a post is being created).
 */
export async function resolveSubBrand(customer, { choice, text, useAi = false } = {}) {
  const subs = customer?.subBrands || [];
  if (subs.length === 0 || choice === 'main') return null;
  if (choice && choice !== 'auto') return findSubBrand(customer, choice);
  const hit = detectByKeyword(subs, text) || (useAi ? await detectByAi(subs, text) : null);
  return hit?.sub || null;
}

/** The main brand kit with the sub-brand's non-empty fields laid over it. Plain object, safe to hand to prompts. */
export function mergeBrandKit(mainKit, sub) {
  const main = mainKit?.toObject ? mainKit.toObject() : { ...(mainKit || {}) };
  if (!sub) return main;
  const k = sub.brandKit?.toObject ? sub.brandKit.toObject() : sub.brandKit || {};
  const out = {
    ...main,
    colors: k.colors?.length ? k.colors : main.colors || [],
    fonts: { ...(main.fonts || {}) },
    designLanguage: { ...(main.designLanguage || {}) }
  };
  for (const f of ['display', 'body', 'suggestedDisplay', 'suggestedBody']) if (hasText(k.fonts?.[f])) out.fonts[f] = k.fonts[f];
  const dl = k.designLanguage || {};
  for (const f of ['logoType', 'typographyImpression', 'imageryStyle', 'voiceTone', 'summary']) if (hasText(dl[f])) out.designLanguage[f] = dl[f];
  if (dl.moodTags?.length) out.designLanguage.moodTags = dl.moodTags;
  if (dl.colorRoles && Object.values(dl.colorRoles).some(hasText)) out.designLanguage.colorRoles = dl.colorRoles;
  return out;
}

/** A stand-in for req.user carrying the merged kit (same plain shape as brandUser() in posts.controller). */
export function userWithSubBrand(user, sub) {
  if (!sub) return user;
  return {
    _id: user._id, name: user.name, email: user.email, role: user.role, company: user.company,
    brandKit: mergeBrandKit(user.brandKit, sub),
    subBrand: { id: sub._id, name: sub.name }
  };
}

export function cleanKeywords(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(arr.map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}
