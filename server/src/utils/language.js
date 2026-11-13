import { currentCustomer } from '../tenant/context.js';

// The workspace's default writing language (Brand Assets -> Languages). Empty / English = no special handling.
export function workspaceLanguage() {
  const l = String(currentCustomer()?.defaultLanguage || '').trim();
  return !l || l.toLowerCase() === 'english' ? '' : l;
}

/** One instruction line for any prompt that writes post copy, headlines or sub-headlines ('' when the language is English). */
export function languageRule(lang = workspaceLanguage()) {
  if (!lang) return '';
  return `LANGUAGE: write all post copy, headlines and sub-headlines in ${lang}, in its native script, the way a fluent native copywriter would write them (natural phrasing, not a word-for-word translation). Do not add an English version or a transliteration. Brand and product names stay as they are.`;
}

/** True when text contains characters outside plain ASCII/Latin-1 (so the image model must draw a specific script). */
export const hasNonLatinScript = (...texts) => texts.some((t) => /[^\u0000-\u024F\u2000-\u206F]/.test(String(t || '')));
