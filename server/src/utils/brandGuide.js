// The brand guide: customer-specific instructions the agency's super admin writes for a workspace
// (Brand Assets -> Brand guide). Stored on Customer.brandKit.guide. This file does three things:
//   cleanGuide()       validates / trims whatever the editor sends
//   brandGuideLines()  turns the guide into prompt sentences (scope 'copy' or 'design')
//   brandGuidePreview() the same text, laid out so the super admin can review what the AI is actually told
// Callers only reach these lines when the brand is being followed (see brandFollowed() in posts.controller),
// so "Follow Brand Assets & Guidelines" off still means no brand information reaches any prompt.

export const GUIDE_TEXT_LIMITS = {
  instructions: 3000,
  copyInstructions: 2000,
  designInstructions: 2000,
  audience: 500,
  positioning: 500,
  logoRules: 600,
  mandatoryText: 400
};

export const GUIDE_LIST_LIMITS = {
  doList: { max: 15, len: 160 },
  dontList: { max: 15, len: 160 },
  preferredWords: { max: 30, len: 40 },
  avoidWords: { max: 30, len: 40 },
  taglines: { max: 10, len: 120 }
};

import { cleanPhotography, photographyLines } from './photographyGuide.js';
import { profileLines } from './brandProfile.js';

const txt = (v) => (typeof v === 'string' ? v.replace(/\r/g, '').trim() : '');
const oneLine = (v) => txt(v).replace(/\s*\n\s*/g, ' ');
const list = (v) => (Array.isArray(v) ? [...v] : []).map((s) => oneLine(String(s))).filter(Boolean);

/** Only the keys that were actually sent come back, so a partial save never wipes other fields. */
export function cleanGuide(input) {
  const body = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, max] of Object.entries(GUIDE_TEXT_LIMITS)) {
    if (typeof body[key] === 'string') out[key] = txt(body[key]).slice(0, max);
  }
  for (const [key, { max, len }] of Object.entries(GUIDE_LIST_LIMITS)) {
    if (!Array.isArray(body[key])) continue;
    const seen = new Set();
    out[key] = list(body[key])
      .map((s) => s.slice(0, len))
      .filter((s) => {
        const k = s.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, max);
  }
  if (Array.isArray(body.learned)) out.learned = cleanLearned(body.learned);
  if (body.photography && typeof body.photography === 'object') out.photography = cleanPhotography(body.photography);
  return out;
}

/** Learned rules: [{scope:'copy'|'design', text}] - bad entries dropped, duplicates removed, capped. */
export const LEARNED_LIMIT = { max: 30, len: 220 };
export function cleanLearned(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const r of v) {
    const text = oneLine(r && typeof r === 'object' ? r.text : '').slice(0, LEARNED_LIMIT.len);
    const scope = r?.scope === 'copy' ? 'copy' : 'design';
    const k = `${scope}:${text.toLowerCase()}`;
    if (!text || seen.has(k)) continue;
    seen.add(k);
    out.push({ scope, text });
    if (out.length >= LEARNED_LIMIT.max) break;
  }
  return out;
}
const learnedOf = (g, scope) => (Array.isArray(g.learned) ? g.learned : []).filter((r) => r && r.scope === scope && txt(r.text)).map((r) => oneLine(r.text));

const join = (arr, sep = '; ') => list(arr).join(sep);

/**
 * Prompt sentences from the guide. kit = a brand kit (mongoose subdoc or plain object).
 * scope 'copy'   -> captions, headlines, message suggestions
 * scope 'design' -> image prompts / art direction
 * Every line is one sentence on one line, with no prefix, so each caller can lay it out its own way.
 */
export function brandGuideLines(kit, scope = 'copy') {
  const g = kit?.guide;
  if (!g) return profileLines(kit, scope === 'copy' ? 'copy' : 'design');
  const out = [];
  const add = (s) => { if (s) out.push(s); };

  add(txt(g.instructions) && `BRAND INSTRUCTIONS from the brand's agency team (always follow these): ${oneLine(g.instructions)}`);

  if (scope === 'copy') {
    add(txt(g.copyInstructions) && `Copywriting instructions for this brand: ${oneLine(g.copyInstructions)}`);
    add(txt(g.positioning) && `What the brand stands for: ${oneLine(g.positioning)}`);
    add(txt(g.audience) && `Who it speaks to: ${oneLine(g.audience)}`);
    add(list(g.taglines).length && `Approved taglines (use one only when it genuinely fits, and never change its wording): ${join(g.taglines, ' | ')}`);
    add(list(g.preferredWords).length && `Preferred vocabulary: ${join(g.preferredWords, ', ')}.`);
    add(list(g.avoidWords).length && `Never use these words or phrases: ${join(g.avoidWords, ', ')}.`);
    add(learnedOf(g, 'copy').length && `Style learned from this brand's past published assets (match it): ${join(learnedOf(g, 'copy'))}.`);
    add(txt(g.mandatoryText) && `Mandatory line for this brand's posts, added where it fits and kept word for word: ${oneLine(g.mandatoryText)}`);
  } else {
    add(txt(g.designInstructions) && `Design instructions for this brand: ${oneLine(g.designInstructions)}`);
    add(txt(g.audience) && `Audience the creative speaks to: ${oneLine(g.audience)}`);
    add(txt(g.logoRules) && `Logo usage: ${oneLine(g.logoRules)}`);
    add(learnedOf(g, 'design').length && `Visual style learned from this brand's past published assets (match it): ${join(learnedOf(g, 'design'))}.`);
  }

  add(list(g.doList).length && `Always: ${join(g.doList)}.`);
  add(list(g.dontList).length && `Never: ${join(g.dontList)}.`);
  // What the structured Brand Assets screen adds (image / graphic / colour use, colour roles, styling, translation rules).
  out.push(...profileLines(kit, scope === 'copy' ? 'copy' : 'design'));
  return out;
}

/**
 * What the AI is told for this brand, split the way the super admin reads it.
 * `understanding` = what was read from the uploaded files (editable on the page);
 * `copy` / `design` = the guide sentences each kind of request receives.
 */
export function brandGuidePreview(kit, { name = '', industry = '' } = {}) {
  const dl = kit?.designLanguage || {};
  const colors = (kit?.colors || []).slice(0, 6);
  const understanding = [
    ['Brand', name ? `${name}${industry ? ` (${industry})` : ''}` : ''],
    ['Summary', txt(dl.summary)],
    ['Tone of voice', txt(dl.voiceTone)],
    ['Mood', list(dl.moodTags).join(', ')],
    ['Imagery style', txt(dl.imageryStyle)],
    ['Typography', [txt(dl.typographyImpression), kit?.fonts?.display && `Headlines: ${kit.fonts.display}`, kit?.fonts?.body && `Body: ${kit.fonts.body}`].filter(Boolean).join(' · ')],
    ['Colours', colors.join(', ')],
    ['Logo type', txt(dl.logoType)]
  ]
    .filter(([, v]) => v && !/^(not applicable|n\/?a|none)$/i.test(v))
    .map(([label, value]) => ({ label, value }));
  return {
    understanding,
    copy: brandGuideLines(kit, 'copy'),
    // The photography direction is part of what image requests receive (only for photographed content, never type or layout).
    design: [...brandGuideLines(kit, 'design'), ...photographyLines(kit)]
  };
}

/** True when the guide has anything in it (used to show an "empty" state). */
export function guideIsEmpty(kit) {
  return brandGuideLines(kit, 'copy').length === 0 && brandGuideLines(kit, 'design').length === 0;
}
