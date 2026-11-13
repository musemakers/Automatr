// STRICT LETTERING: a hard rule block for the image prompt, used when the image model draws the exact headline / sub-headline itself
// (quoted verbatim strings, spelled out, counted, drawn once, nothing else).

const letters = (s) => (String(s || '').match(/[\p{L}\p{N}]/gu) || []).length;
const spell = (s) => String(s).trim().split(/\s+/).map((w) => [...w].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : `[${c}]`)).join('-')).join('  ');

/** The strict rule block. `headLines` / `subLines` are the line breaks to use (arrays of strings); omitted = one line each. */
export function strictTextRules({ headline = '', subHeadline = '', headLines, subLines }) {
  const head = String(headline).trim();
  const sub = String(subHeadline).trim();
  if (!head && !sub) return '';
  const lines = (arr, whole) => (arr?.length ? arr : [whole]).map((l, i, a) => `${a.length > 1 ? `line ${i + 1}: ` : ''}"${l}"`).join(' / ');
  const parts = [
    head && `HEADLINE, verbatim, ${headLines?.length > 1 ? `on ${headLines.length} lines, ` : ''}${lines(headLines, head)} (${letters(head)} letters and digits; spelled out: ${spell(head)})`,
    sub && `SUB-HEADLINE, verbatim, ${subLines?.length > 1 ? `on ${subLines.length} lines, ` : ''}${lines(subLines, sub)} (${letters(sub)} letters and digits; spelled out: ${spell(sub)})`
  ].filter(Boolean);
  return [
    'STRICT TEXT RULES (highest priority; they override any style, mood or composition preference above):',
    `1. The ONLY lettering you may draw is: ${parts.join('; ')}.`,
    '2. Render every character exactly as written between the quotes: same letters in the same order, same capital and lower-case, same punctuation, same spaces. Never add, drop, swap, double, reorder, abbreviate, translate, autocorrect or "improve" any character or word, and never change the case.',
    '3. Draw each of those lines exactly ONCE. No mirrored, reflected, repeated, echoed, shadow-copy or ghost copies of the words anywhere.',
    '4. Draw nothing else that reads as writing: no tagline, caption, slogan, call-to-action, price, date, URL, small print, watermark, brand name or invented logo, and no pseudo-text, gibberish or random letters. Blank signs, screens, books, posters and labels you invent must stay blank or be softly out of focus. (Printing that already exists on real product packs, labels or logos in the reference images stays as it is in those references, and is not extra text.)',
    '5. Set the text flat, straight, horizontal and front-facing, in one solid high-contrast colour: never curved, tilted, in perspective, wrapped around an object, stretched, outlined, glowing, shadowed, gradient-filled, 3D or textured. It sits in front of everything, never partly hidden by an object, never cut off by the image edge, with a clear margin of at least 4% from every edge, and never over a face, hand or the product.',
    '6. The headline is clearly the largest text, with the sub-headline noticeably smaller beneath it. Keep generous, even spacing between letters and between lines, and make every letter large enough to read without effort.',
    '7. Before finishing, re-read every letter of the text against the quoted strings above, one letter at a time, and fix any difference. If a word cannot be drawn perfectly, simplify the surroundings, never the spelling.'
  ].join(' ');
}

/**
 * Strict lettering rules for EDIT prompts (the image already exists, so the font, size and layout stay as they are):
 * only the quoted strings are drawn, each character exactly as written, nothing extra.
 * `texts` = the exact strings the model must now draw.
 */
export function editTextRules(texts = []) {
  const list = texts.map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length) return '';
  return [
    'STRICT TEXT RULES for the new lettering (highest priority):',
    `1. The ONLY new lettering to draw is: ${list.map((t) => `"${t}" (${letters(t)} letters and digits; spelled out: ${spell(t)})`).join('; ')}.`,
    '2. Render every character exactly as written between the quotes: same letters in the same order, same capital and lower-case, same punctuation and spaces. Never add, drop, swap, double, reorder, abbreviate, translate, autocorrect or "improve" any character or word.',
    '3. Draw each of those strings exactly ONCE, with no mirrored, repeated, echoed or ghost copies.',
    '4. Copy the letterforms of the original lettering in the image (stroke weight, proportions, serifs, tails and terminals, spacing) for every character, so the new text looks typeset by the same designer.',
    '5. Add no other lettering and no pseudo-text or random letters anywhere.',
    '6. Before finishing, re-read every letter of the new text against the quoted strings, one at a time, and fix any difference. If a word cannot be drawn perfectly, simplify the surroundings, never the spelling.'
  ].join(' ');
}

/** Same discipline for prompts where the text is only known later (form fields filled in by the customer). */
export const GENERIC_STRICT_TEXT = 'STRICT TEXT RULES: the only lettering allowed is the exact strings given in quotes above. Draw every character exactly as given (same letters, order, capitals, punctuation), each string exactly once, never autocorrected, never abbreviated, never repeated or mirrored. Set the text flat, straight and front-facing in a clean, high-contrast colour, large enough to read easily, with a clear margin from every edge and never over a face or the product. Add no other lettering, no pseudo-text and no random letters. Re-read every letter against the given strings before finishing.';
