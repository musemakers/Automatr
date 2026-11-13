import * as router from './router.js';
import { gridOverlay, cropRegion } from '../../utils/gridOverlay.js';
import { loadMaps, snapRegions } from '../../utils/boxSnap.js';
import { getOcrLines } from '../../utils/ocrLines.js';

// Which vision model does template analysis (element detection + locating
// them). Defaults to GPT; set TEMPLATE_ANALYSIS_MODEL=claude|gemini|auto in
// server/.env to switch without a code change. 'detail: high' asks OpenAI to
// look at the image at full resolution instead of a downscaled version,
// which matters for locating small things like logos and fine print.
const ANALYSIS_MODEL = process.env.TEMPLATE_ANALYSIS_MODEL || 'gpt';

// Same idea as brandAnalysisService.js, but instead of extracting a
// reusable design language, this identifies the discrete elements present
// in ONE specific creative someone is about to adapt - so the person can
// choose which of them must be preserved (logo, key visual, secondary
// copy, compliance text, decorative graphics) versus which parts of the
// layout can be redesigned. See referenceInstructionText() in
// designService.js for how these choices turn into the actual prompt.

function buildInstruction() {
  return [
    'You are a senior art director reviewing an existing advertising creative that a team wants to adapt for a new campaign message.',
    'Identify every distinct visual/text element present, treating each one separately (the hero subject, its background/setting, logos, text blocks, small print, decorations and the overall layout are all different elements), so the team can choose which ones must be preserved exactly versus which parts can be redesigned.',
    'Respond with ONLY a JSON object (no markdown fences, no commentary, nothing before or after it) shaped exactly like this:',
    JSON.stringify(
      {
        hasLogo: 'boolean - a brand logo/lockup/wordmark appears anywhere in the frame (including small corner marks or badges)',
        logoDescription: 'one short phrase describing it and where it sits (e.g. "circular blue flower badge, bottom-right"), or "" if hasLogo is false',
        hasKeyVisual: 'boolean - there is a clear hero SUBJECT that is the main visual focus (a product, a vehicle, a person). Describe the subject ONLY - never include its background/scenery here, that is a separate element below',
        keyVisualDescription: 'one short phrase describing ONLY the hero subject itself (e.g. "teal luxury sedan, three-quarter front view"), or "" if hasKeyVisual is false',
        hasBackground: 'boolean - there is an identifiable background/setting/location behind or around the hero subject (a landmark, street, interior, studio backdrop, landscape), as distinct from the subject itself',
        backgroundDescription: 'one short phrase describing ONLY the background/setting (e.g. "Eiffel Tower and Paris street"), or "" if hasBackground is false',
        hasPrimaryHeadline: 'boolean - there is a main headline/title text',
        primaryHeadlineText: 'the literal text of the primary headline if legible, or "" if none/illegible',
        hasSecondaryText: 'boolean - there is a second, separate text block beyond the primary headline (a subheading, a second callout elsewhere in the frame, a tagline)',
        secondaryTextContent: 'the literal text of the sub-headline / second text block if legible (all lines, joined with a space), or "" if none/illegible',
        secondaryTextDescription: 'one short phrase describing it and where it sits, or "" if hasSecondaryText is false',
        otherText: 'array of up to 3 OTHER separate text lines or blocks that are NOT the primary headline, NOT the secondary text block above and NOT small print / compliance text. Examples: a small kicker or eyebrow line above or below a headline (e.g. "THIS KARWA CHAUTH" with thin rules beside it), a tagline, an offer or price line, a date, a call-to-action label. Each item is {"text": "the literal text exactly as written, lines joined with a space", "description": "short phrase on where it sits and how it looks"}. Use [] when there are none. Never repeat text already given as the primary headline or the secondary text.',
        hasComplianceText: 'boolean - there is small print such as a registration/license number, legal disclaimer, terms, or a QR code',
        complianceTextDescription: 'one short phrase describing what it is and where it sits (e.g. "registration number, top-right" or "QR code, bottom-right"), or "" if hasComplianceText is false',
        hasDecorativeGraphics: 'boolean - there are non-photographic decorative elements (line art, icons, borders, patterns) beyond the logo itself',
        decorativeDescription: 'one short phrase describing them, or "" if hasDecorativeGraphics is false',
        regions: {
          note: 'approximate bounding box of each element that is present, as [x, y, width, height] with every value a fraction of the full image between 0 and 1, origin top-left (x = left edge / image width, y = top edge / image height). Include ONLY keys for elements that are actually present; omit the key otherwise. Boxes should tightly enclose the element, and must not be the whole image.',
          logo: '[x, y, w, h]',
          keyVisual: '[x, y, w, h] - the hero subject only',
          primaryHeadline: '[x, y, w, h]',
          secondaryText: '[x, y, w, h]',
          complianceText: '[x, y, w, h]',
          decorative: '[x, y, w, h] - one box enclosing the main decorative graphics'
        },
        layoutSummary: 'one sentence describing the overall layout/composition - where each element sits relative to the others (e.g. "car centered in lower two-thirds, headline upper-left, logo lower-right"), or "" if there is no meaningful layout to describe'
      },
      null,
      2
    ),
    'Base every field strictly on what is actually visible - set boolean fields to false and description fields to "" rather than guessing when something is absent or unclear.'
  ].join('\n');
}

/**
 * Extracts the first balanced {...} JSON object from a string. Mirrors
 * brandAnalysisService.js's extractJsonObject - kept as a local copy
 * rather than a shared import so this file has no dependency on brand
 * analysis internals changing later.
 */
function extractJsonObject(text) {
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

const BOOLEAN_FIELDS = ['hasLogo', 'hasKeyVisual', 'hasBackground', 'hasPrimaryHeadline', 'hasSecondaryText', 'hasComplianceText', 'hasDecorativeGraphics'];
const STRING_FIELDS = [
  'logoDescription',
  'keyVisualDescription',
  'backgroundDescription',
  'primaryHeadlineText',
  'secondaryTextContent',
  'secondaryTextDescription',
  'complianceTextDescription',
  'decorativeDescription',
  'layoutSummary'
];

const MAX_OTHER_TEXT = 3;
const REGION_KEYS = ['logo', 'keyVisual', 'primaryHeadline', 'secondaryText', 'complianceText', 'decorative', ...Array.from({ length: MAX_OTHER_TEXT }, (_, i) => `other${i}`)];

// Model-reported boxes are approximate - clamp them into the frame and drop
// anything unusable (wrong shape, zero-size, or basically the whole image,
// which would just draw a useless outline around everything).
function sanitizeRegions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of REGION_KEYS) {
    const box = raw[key];
    if (!Array.isArray(box) || box.length !== 4) continue;
    let [x, y, w, h] = box.map(Number);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    x = Math.min(Math.max(x, 0), 1);
    y = Math.min(Math.max(y, 0), 1);
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    if (w < 0.02 || h < 0.02) continue;
    if (w * h > 0.9) continue;
    out[key] = [x, y, w, h].map((n) => Math.round(n * 1000) / 1000);
  }
  return out;
}

function sanitize(parsed) {
  const clean = {};
  for (const field of BOOLEAN_FIELDS) clean[field] = Boolean(parsed[field]);
  for (const field of STRING_FIELDS) clean[field] = typeof parsed[field] === 'string' ? parsed[field].trim() : '';
  // Extra text lines (kickers, taglines, offer lines ...): drop empties and anything that just repeats the headline / sub-headline.
  const normText = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
  const known = [clean.primaryHeadlineText, clean.secondaryTextContent].map(normText).filter(Boolean);
  const seenOther = new Set();
  clean.otherText = (Array.isArray(parsed.otherText) ? parsed.otherText : [])
    .map((o) => ({ text: String(o?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200), description: String(o?.description || '').replace(/\s+/g, ' ').trim().slice(0, 160) }))
    .filter((o) => {
      const n = normText(o.text);
      if (!n || seenOther.has(n) || known.some((k) => k.includes(n) || n.includes(k))) return false;
      seenOther.add(n);
      return true;
    })
    .slice(0, MAX_OTHER_TEXT);
  const regions = sanitizeRegions(parsed.regions);
  // Only keep a box when the matching element was actually detected.
  const present = {
    logo: clean.hasLogo,
    keyVisual: clean.hasKeyVisual,
    primaryHeadline: clean.hasPrimaryHeadline,
    secondaryText: clean.hasSecondaryText,
    complianceText: clean.hasComplianceText,
    decorative: clean.hasDecorativeGraphics,
    ...Object.fromEntries(clean.otherText.map((_, i) => [`other${i}`, true]))
  };
  clean.regions = Object.fromEntries(Object.entries(regions).filter(([k]) => present[k]));
  return clean;
}

const LOCATE_LABELS = {
  logo: (e) => `logo: ${e.logoDescription || 'the brand logo'}`,
  keyVisual: (e) => `keyVisual: the hero subject only - ${e.keyVisualDescription || 'the main subject'}`,
  primaryHeadline: (e) => `primaryHeadline: the main headline text${e.primaryHeadlineText ? ` reading "${e.primaryHeadlineText}"` : ''} - enclose every line of it`,
  secondaryText: (e) => `secondaryText: ${e.secondaryTextDescription || 'the secondary text block'}${e.secondaryTextContent ? ` reading "${e.secondaryTextContent}"` : ''} - enclose the whole callout/badge`,
  complianceText: (e) => `complianceText: ${e.complianceTextDescription || 'the small print / QR code'}`,
  decorative: (e) => `decorative: ${e.decorativeDescription || 'the decorative graphics'}`
};

// Extra text lines (otherText[i]) are located under the key `other${i}`.
const otherLabel = (key, e) => {
  const o = e.otherText?.[Number(key.slice(5))];
  return `${key}: the line of text reading "${o?.text || ''}"${o?.description ? ` (${o.description})` : ''} - hug the text of that line itself`;
};
const locateLabel = (key, e) => (key.startsWith('other') ? otherLabel(key, e) : LOCATE_LABELS[key](e));
const locateKeys = (e) => [...Object.keys(LOCATE_PRESENT).filter((k) => e[LOCATE_PRESENT[k]]), ...(e.otherText || []).map((_, i) => `other${i}`)];

const LOCATE_PRESENT = {
  logo: 'hasLogo',
  keyVisual: 'hasKeyVisual',
  primaryHeadline: 'hasPrimaryHeadline',
  secondaryText: 'hasSecondaryText',
  complianceText: 'hasComplianceText',
  decorative: 'hasDecorativeGraphics'
};

/**
 * Second pass: finds WHERE each detected element is. Asking a vision model
 * for coordinates in the same call that identifies the elements gives
 * boxes that are visibly off (it has nothing to measure against), so this
 * re-sends the image with a labelled 10% grid drawn on it and asks for
 * edges read off that grid, as percentages. Returns normalized
 * { key: [x, y, w, h] } (0-1, top-left origin), or {} if it fails - the
 * caller then falls back to the first pass's rough boxes.
 */
async function locateCoarse({ buffer, elements }) {
  const keys = locateKeys(elements);
  if (keys.length === 0) return {};

  try {
    const grid = await gridOverlay(buffer);
    const instruction = [
      'This image has a coordinate grid drawn over it. Yellow lines are every 10% of the image, and the numbers printed along all four edges (10, 20 ... 90) are percentages measured from the TOP-LEFT corner: x runs left to right, y runs top to bottom, 0 = left/top edge, 100 = right/bottom edge.',
      'The grid is a measuring aid only - ignore it when deciding what each element is.',
      'Find each of these elements and give a TIGHT bounding box around it - the smallest rectangle that fully contains it with a small margin, not a generous area around it:',
      ...keys.map((k) => `- ${locateLabel(k, elements)}`),
      'Read each edge by finding the nearest grid lines and interpolating between them (e.g. an edge halfway between the 70 and 80 lines is 75). Use decimals where helpful.',
      'Respond with ONLY a JSON object, no markdown, no commentary, with one key per element above, each an array [left, top, right, bottom] in percent (0-100) - for example {"logo": [4.5, 6, 21, 13]}. Omit a key if that element is not actually visible.'
    ].join('\n');

    const { text, modelUsed } = await router.analyzeImage({ purpose: 'locating template elements', model: ANALYSIS_MODEL, detail: 'high', base64: grid.buffer.toString('base64'), mimeType: grid.mimeType, instruction, maxTokens: 600 });
    console.log(`[template-analysis] coarse locate (${modelUsed}) raw: ${(text || '').slice(0, 500)}`);
    if (!text) return {};
    const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));

    const out = {};
    for (const k of keys) {
      const b = parsed[k];
      if (!Array.isArray(b) || b.length !== 4) continue;
      const [l, t, r, bt] = b.map(Number);
      if (![l, t, r, bt].every(Number.isFinite)) continue;
      // the model sometimes answers in 0-1 instead of 0-100
      const scale = Math.max(l, t, r, bt) <= 1 ? 1 : 100;
      out[k] = [l / scale, t / scale, (r - l) / scale, (bt - t) / scale];
    }
    return sanitizeRegions(out);
  } catch (err) {
    console.warn('[template-analysis] region location failed:', err.message);
    return {};
  }
}

function iou([ax, ay, aw, ah], [bx, by, bw, bh]) {
  const ix = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const iy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const inter = ix * iy;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function parseJson(text) {
  return JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
}

/**
 * Third pass, per element: zoom in. A coarse box is only as accurate as the
 * model's read of a full-frame grid (a few percent either way, which looks
 * badly off on a small logo or a one-line headline). So crop around each
 * coarse box with generous padding, upscale the crop, draw a fresh grid on
 * IT, and ask for the tight box relative to the crop. The same few-percent
 * error now applies to a much smaller area, then maps back to the full
 * frame. Falls back to the coarse box for anything that fails or looks
 * implausible.
 */
async function refineRegion({ buffer, key, coarse, elements }) {
  try {
    const [x, y, w, h] = coarse;
    // generous padding, and never a sliver - the crop needs surrounding context
    const padX = Math.max(w * 0.6, 0.09);
    const padY = Math.max(h * 0.6, 0.09);
    let x0 = Math.max(0, x - padX);
    let y0 = Math.max(0, y - padY);
    let x1 = Math.min(1, x + w + padX);
    let y1 = Math.min(1, y + h + padY);
    const cw = x1 - x0;
    const ch = y1 - y0;

    const crop = await cropRegion(buffer, [x0, y0, cw, ch]);
    const grid = await gridOverlay(crop, { maxSide: 1100, enlarge: true });
    const instruction = [
      'This is a zoomed-in crop of part of a larger advertising image. A coordinate grid is drawn over it: yellow lines are every 10% of THIS crop, and the numbers along all four edges (10 ... 90) are percentages measured from the crop\'s TOP-LEFT corner (x left to right, y top to bottom, 0-100).',
      'The grid is only a measuring aid - ignore it when deciding what things are.',
      `Find this element: ${locateLabel(key, elements)}`,
      'Give the TIGHTEST rectangle that fully contains it (hug the edges of the element itself - for text, hug the glyphs; for a logo, hug the mark - with only a hairline of margin). Read each edge from the nearest grid lines and interpolate between them; use decimals.',
      'Respond with ONLY a JSON object, no markdown, no commentary: {"box": [left, top, right, bottom]} in percent (0-100) of this crop. If the element is not visible in this crop, respond {"box": null}.'
    ].join('\n');

    const { text, modelUsed } = await router.analyzeImage({ purpose: 'checking template element positions', model: ANALYSIS_MODEL, detail: 'high', base64: grid.buffer.toString('base64'), mimeType: grid.mimeType, instruction, maxTokens: 200 });
    console.log(`[template-analysis] refine ${key} (${modelUsed}) crop=[${[x0, y0, cw, ch].map((n) => n.toFixed(3)).join(', ')}] raw: ${(text || '').slice(0, 200)}`);
    if (!text) return null;
    const b = parseJson(text).box;
    if (!Array.isArray(b) || b.length !== 4) return null;
    const [l, t, r, bt] = b.map(Number);
    if (![l, t, r, bt].every(Number.isFinite) || r <= l || bt <= t) return null;
    const scale = Math.max(l, t, r, bt) <= 1 ? 1 : 100;
    const refined = [x0 + (l / scale) * cw, y0 + (t / scale) * ch, ((r - l) / scale) * cw, ((bt - t) / scale) * ch];

    // sanity: refinement should land on roughly the same thing, not something wildly different
    const ratio = (refined[2] * refined[3]) / (w * h);
    if (ratio < 0.15 || ratio > 5) return null;
    // ...and on the same spot: a refinement that lands somewhere else
    // entirely (a misread crop) is worse than the rough box it replaces.
    if (iou(coarse, refined) < 0.25) {
      console.warn(`[template-analysis] refine ${key} rejected (moved too far from coarse box)`);
      return null;
    }
    return refined;
  } catch (err) {
    console.warn(`[template-analysis] refine ${key} failed:`, err.message);
    return null;
  }
}

async function locateRegions({ buffer, elements }) {
  const coarse = await locateCoarse({ buffer, elements });
  const keys = Object.keys(coarse);
  const refined = await Promise.all(keys.map((k) => refineRegion({ buffer, key: k, coarse: coarse[k], elements })));
  const out = {};
  keys.forEach((k, i) => {
    out[k] = refined[i] || coarse[k];
  });
  console.log('[template-analysis] regions (coarse -> refined):', JSON.stringify(Object.fromEntries(keys.map((k, i) => [k, { coarse: coarse[k], refined: refined[i] }]))));
  return sanitizeRegions(out);
}

/**
 * Final pass for TEXT elements (headline, sub-headline, other text lines): the model's boxes for text can sit on the
 * wrong line or hug nothing, but the literal text it read can be found by OCR and boxed exactly where it is printed
 * (the same snapping Headline Switch uses). A box found from the literal text always wins; a looser match (nearest
 * text block, edges) only replaces the model's box when it clearly agrees with it. Never throws: on any failure the
 * model's own boxes are kept.
 */
async function snapTextRegions({ buffer, elements }) {
  const jobs = [];
  if (elements.hasPrimaryHeadline && elements.primaryHeadlineText) jobs.push({ key: 'primaryHeadline', snapKey: 'primaryHeadline', text: elements.primaryHeadlineText });
  if (elements.hasSecondaryText && elements.secondaryTextContent) jobs.push({ key: 'secondaryText', snapKey: 'secondaryText', text: elements.secondaryTextContent });
  (elements.otherText || []).forEach((o, i) => jobs.push({ key: `other${i}`, snapKey: 'secondaryText', text: o.text }));
  if (!jobs.length) return {};
  try {
    const [maps, ocr] = await Promise.all([loadMaps(buffer), getOcrLines(buffer)]);
    const out = {};
    for (const j of jobs) {
      const cur = elements.regions?.[j.key];
      const start = cur || [0.05, 0.05, 0.9, 0.9]; // no model box: still look for the literal text anywhere
      const res = await snapRegions(buffer, { [j.snapKey]: start }, { texts: { [j.snapKey]: j.text }, ocr, maps });
      const s = res[j.snapKey];
      if (!s?.snapped) continue;
      if (s.via === 'ocr-text' || (cur && iou(cur, s.box) > 0.3)) out[j.key] = s.box;
    }
    console.log('[template-analysis] text boxes snapped to OCR:', JSON.stringify(out));
    return sanitizeRegions(out);
  } catch (err) {
    console.warn('[template-analysis] text snapping skipped:', err.message);
    return {};
  }
}

/**
 * Analyzes an in-memory image buffer (the template someone just staged for
 * Creative Adaptation, before it's even attached to a post) and returns
 * which preservable elements it detects. Returns { skipped: true, reason }
 * rather than throwing when analysis isn't available/fails - callers
 * should fall back to "assume everything should be preserved" (the
 * original strict behavior) rather than blocking the person from
 * proceeding just because detection didn't work.
 */
export async function analyzeTemplateElements({ buffer, mimeType }) {
  const base64 = buffer.toString('base64');
  const instruction = buildInstruction();

  const { text, modelUsed, note } = await router.analyzeImage({ purpose: 'analysing the reference template', model: ANALYSIS_MODEL, detail: 'high',
    base64,
    mimeType,
    instruction,
    maxTokens: 1500
  });

  if (!text) {
    return { skipped: true, reason: note || 'No AI provider is configured for image analysis.' };
  }

  console.log(`[template-analysis] raw ${modelUsed} response (first 1000 chars):\n${text.slice(0, 1000)}`);

  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const jsonStr = extractJsonObject(cleaned);
    const parsed = JSON.parse(jsonStr);
    const elements = sanitize(parsed);
    // Prefer the grid-assisted boxes; keep the first pass's rough ones for
    // any element the second pass couldn't place.
    const located = await locateRegions({ buffer, elements });
    elements.regions = { ...elements.regions, ...located };
    elements.regions = { ...elements.regions, ...(await snapTextRegions({ buffer, elements })) };
    return { skipped: false, modelUsed, elements };
  } catch (err) {
    console.warn('[template-analysis] failed to parse response:', err.message);
    return { skipped: true, reason: `AI response could not be parsed: ${err.message}` };
  }
}
