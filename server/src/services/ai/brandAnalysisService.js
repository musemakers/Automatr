import fs from 'node:fs';
import * as router from './router.js';

// Vision-capable models can analyze rasterized images directly, and Claude
// / Gemini can also read PDFs natively (as a document, not just a flat
// image) - see each provider's ANALYZABLE_MIME_TYPES for exactly which
// providers support which type. SVG isn't supported by any provider yet
// (would need rasterizing first), so it's left out here.
export const ANALYZABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf']);

export function isAnalyzable(mimeType) {
  return ANALYZABLE_MIME_TYPES.has(mimeType);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function buildInstruction({ originalName, kind, mimeType }) {
  const isPdf = mimeType === 'application/pdf';
  return [
    'You are a senior brand/graphic designer reviewing an asset a marketing team just uploaded',
    `(filename: "${originalName}", categorized as: ${kind}).`,
    isPdf
      ? [
          'This is a PDF, which may be a single-page logo/asset sheet or a full multi-page brand guideline document.',
          'First, scan every page and locate the specific sections that define the color palette and the typography/typeface system - brand guidelines almost always have dedicated pages for these, usually titled something like "Color Palette", "Colour System", "Typography", or "Fonts".',
          'Read the literal values printed there: exact hex codes (#RRGGBB), RGB triplets, CMYK values, or Pantone/spot color names, and the exact named typeface(s) (e.g. "Helvetica Neue Bold", "Futura PT").',
          'If hex is not printed directly but RGB or CMYK is, convert it to hex precisely using standard color math rather than guessing.',
          'If a typeface name is printed anywhere in the document, use that exact name verbatim as the suggested font rather than picking a stylistically-similar substitute.',
          'Only fall back to visually estimating colors/typefaces if the document truly never states them explicitly anywhere.',
          'Do not average or blend multiple pages\' accent colors together - report the palette exactly as the guideline defines it, in the order/hierarchy it defines (primary before secondary before accent).'
        ].join(' ')
      : 'Study its colors, typography, logo construction, and overall visual style.',
    'Derive a reusable "design language" for this brand from what you find.',
    'Respond with ONLY a JSON object (no markdown fences, no commentary, nothing before or after it) shaped exactly like this:',
    JSON.stringify(
      {
        colors: ['#RRGGBB', '...up to 6 hex colors, in the exact hierarchy/order the source defines (or visual dominance order if none is stated) - every entry MUST be a valid 6-digit hex code'],
        colorRoles: { primary: '#RRGGBB', secondary: '#RRGGBB', accent: '#RRGGBB', neutral: '#RRGGBB' },
        logoType: 'one of: wordmark, lettermark, symbol, combination, emblem, not-a-logo',
        typography: {
          impression: 'one sentence describing the letterforms/typefaces (weight, geometric vs humanist, serif vs sans, etc) - name the actual typeface verbatim if the document states one',
          suggestedDisplayFont: 'the exact headline typeface name if the document states one, otherwise your best real, commonly-available stylistic match',
          suggestedBodyFont: 'the exact body-copy typeface name if the document states one, otherwise your best real, commonly-available stylistic match'
        },
        moodTags: ['3 to 5 short lowercase adjectives, e.g. "minimal", "premium", "playful"'],
        imageryStyle: 'one sentence describing the photographic/illustrative style implied or specified (or "not applicable")',
        voiceTone: 'the brand voice / tone of voice ONLY if the document explicitly states or clearly describes one (quote it or stay very close to its wording, one to two sentences). If the document does not state a tone of voice, return an empty string "" - do NOT infer one from the visuals',
        summary: '2-3 sentence plain-English design language summary a designer could hand to a new teammate'
      },
      null,
      2
    ),
    'Base every field on what is actually visible/stated - do not invent specifics you cannot support from the document. If the asset is not a logo (e.g. a product photo, texture, or guideline document with no single logo mark), still infer color/mood/style fields but set logoType to "not-a-logo".'
  ].join('\n');
}

/**
 * Extracts the first balanced {...} JSON object from a string, rather than
 * a greedy first-brace-to-last-brace regex - safer if the model adds any
 * stray text or example braces before/after the real JSON.
 */
export function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response.');

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('JSON object in response was not properly closed (possibly truncated).');
}

/** Drops any color that isn't a well-formed 6-digit hex, rather than letting a bad value corrupt the brand kit silently. */
export function sanitizeColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors.filter((c) => typeof c === 'string' && HEX_RE.test(c.trim())).map((c) => c.trim());
}

export function sanitizeColorRoles(roles) {
  if (!roles || typeof roles !== 'object') return {};
  const clean = {};
  for (const [role, hex] of Object.entries(roles)) {
    if (typeof hex === 'string' && HEX_RE.test(hex.trim())) clean[role] = hex.trim();
  }
  return clean;
}

/**
 * Analyzes one uploaded brand asset file (image or PDF) and returns a
 * structured design language object, or null if analysis isn't
 * applicable/available (not an error - callers should treat null as "skip
 * gracefully", since asset upload itself should never fail just because AI
 * analysis didn't run).
 */
export async function analyzeBrandAsset({ filePath, mimeType, originalName, kind }) {
  if (!isAnalyzable(mimeType)) {
    return { skipped: true, reason: `Analysis isn't supported yet for ${mimeType}.` };
  }

  const base64 = fs.readFileSync(filePath).toString('base64');
  const instruction = buildInstruction({ originalName, kind, mimeType });

  const { text, modelUsed, note } = await router.analyzeImage({
    base64,
    mimeType,
    instruction,
    maxTokens: mimeType === 'application/pdf' ? 2200 : 900
  });

  if (!text) {
    return { skipped: true, reason: note || 'No AI provider is configured for image analysis.' };
  }

  // Logged (truncated) on every run, not just failures, so a mismatch
  // between "what the model actually said" and "what showed up in the UI"
  // can be diagnosed from server logs rather than guessed at.
  console.log(`[brand-analysis] raw ${modelUsed} response for "${originalName}" (first 1200 chars):\n${text.slice(0, 1200)}`);

  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const jsonStr = extractJsonObject(cleaned);
    const parsed = JSON.parse(jsonStr);

    parsed.colors = sanitizeColors(parsed.colors);
    parsed.colorRoles = sanitizeColorRoles(parsed.colorRoles);

    return { skipped: false, modelUsed, analysis: parsed };
  } catch (err) {
    console.warn(`[brand-analysis] failed to parse ${modelUsed} response for "${originalName}":`, err.message);
    return { skipped: true, reason: `AI response could not be parsed: ${err.message}` };
  }
}
