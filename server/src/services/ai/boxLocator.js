import * as router from './router.js';
import { gridOverlay, cropRegion } from '../../utils/gridOverlay.js';
import { loadMaps, snapRegions } from '../../utils/boxSnap.js';
import { getOcrLines } from '../../utils/ocrLines.js';
import { normBox } from '../../utils/normBox.js';

const ANALYSIS_MODEL = process.env.TEMPLATE_ANALYSIS_MODEL || 'gpt';

function parseObject(text) {
  const s = text.replace(/^```json|```$/gim, '').trim();
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}
const iou = ([ax, ay, aw, ah], [bx, by, bw, bh]) => {
  const ix = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const iy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const inter = ix * iy;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
};
// [left, top, right, bottom] in percent (or 0-1) -> normalised [x, y, w, h], or null
function fromEdges(b) {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [l, t, r, bt] = b.map(Number);
  if (![l, t, r, bt].every(Number.isFinite) || r <= l || bt <= t) return null;
  const scale = Math.max(l, t, r, bt) <= 1 ? 1 : 100;
  const box = normBox({ x: l / scale, y: t / scale, w: (r - l) / scale, h: (bt - t) / scale });
  return box ? [box.x, box.y, box.w, box.h] : null;
}

/** Whole-frame pass: a labelled 10% grid is drawn on the image and the model reads edges off it. */
async function coarse(buffer, items) {
  try {
    const grid = await gridOverlay(buffer);
    const instruction = [
      'This image has a coordinate grid drawn over it. Yellow lines are every 10% of the image, and the numbers printed along all four edges (10, 20 ... 90) are percentages measured from the TOP-LEFT corner: x runs left to right, y runs top to bottom, 0 = left/top edge, 100 = right/bottom edge.',
      'The grid is a measuring aid only - ignore it when deciding what each item is.',
      'Find each numbered item and give a TIGHT bounding box around it - the smallest rectangle that fully contains it with a small margin, not a generous area around it:',
      ...items.map((it, i) => `${i + 1}. ${it.label}`),
      'Read each edge by finding the nearest grid lines and interpolating between them (e.g. an edge halfway between the 70 and 80 lines is 75). Use decimals where helpful.',
      'Respond with ONLY a JSON object, no markdown, no commentary, keyed by the item number, each an array [left, top, right, bottom] in percent (0-100) - for example {"1": [4.5, 6, 21, 13], "2": [40, 30, 90, 95]}. Omit an item if it is not actually visible.'
    ].join('\n');
    const { text } = await router.analyzeImage({ purpose: 'locating items on the image', model: ANALYSIS_MODEL, detail: 'high', base64: grid.buffer.toString('base64'), mimeType: grid.mimeType, instruction, maxTokens: 600 });
    console.log(`[box-locator] coarse raw: ${(text || '').slice(0, 400)}`);
    if (!text) return items.map(() => null);
    const parsed = parseObject(text);
    return items.map((_, i) => fromEdges(parsed[String(i + 1)]));
  } catch (err) {
    console.warn('[box-locator] coarse pass failed:', err.message);
    return items.map(() => null);
  }
}

/** Zoom pass: crop around the coarse box, upscale, draw a fresh grid on the crop and measure again. */
async function refine(buffer, item, c) {
  try {
    const [x, y, w, h] = c;
    const padX = Math.max(w * 0.6, 0.09);
    const padY = Math.max(h * 0.6, 0.09);
    const x0 = Math.max(0, x - padX);
    const y0 = Math.max(0, y - padY);
    const cw = Math.min(1, x + w + padX) - x0;
    const ch = Math.min(1, y + h + padY) - y0;
    const crop = await cropRegion(buffer, [x0, y0, cw, ch]);
    const grid = await gridOverlay(crop, { maxSide: 1100, enlarge: true });
    const instruction = [
      'This is a zoomed-in crop of part of a larger advertising image. A coordinate grid is drawn over it: yellow lines are every 10% of THIS crop, and the numbers along all four edges (10 ... 90) are percentages measured from the crop\'s TOP-LEFT corner (x left to right, y top to bottom, 0-100).',
      'The grid is only a measuring aid - ignore it when deciding what things are.',
      `Find this item: ${item.label}`,
      'Give the TIGHTEST rectangle that fully contains it (hug the edges of the item itself - for text, hug the glyphs - with only a hairline of margin). Read each edge from the nearest grid lines and interpolate between them; use decimals.',
      'Respond with ONLY a JSON object, no markdown, no commentary: {"box": [left, top, right, bottom]} in percent (0-100) of this crop. If the item is not visible in this crop, respond {"box": null}.'
    ].join('\n');
    const { text } = await router.analyzeImage({ purpose: 'checking item positions', model: ANALYSIS_MODEL, detail: 'high', base64: grid.buffer.toString('base64'), mimeType: grid.mimeType, instruction, maxTokens: 200 });
    if (!text) return null;
    const e = fromEdges(parseObject(text).box);
    if (!e) return null;
    const refined = [x0 + e[0] * cw, y0 + e[1] * ch, e[2] * cw, e[3] * ch];
    const ratio = (refined[2] * refined[3]) / (w * h);
    if (ratio < 0.15 || ratio > 5 || iou(c, refined) < 0.25) return null; // landed somewhere else: keep the coarse box
    return refined;
  } catch (err) {
    console.warn('[box-locator] refine failed:', err.message);
    return null;
  }
}

/**
 * Finds a tight box for each item, the way the template analysis does: grid pass over the whole image, a zoomed
 * grid pass per item, then (text: OCR, subjects: image edges) snapping to the pixels themselves.
 * items: [{ label, text?, snapKey? }] - `text` is the literal text for OCR matching, `snapKey` one of the
 * boxSnap keys (primaryHeadline / secondaryText / keyVisual). Returns one { x, y, w, h } or null per item;
 * never throws, so a failure just means that item gets no (or its first-pass) outline.
 */
export async function locateBoxes({ buffer, items, firstPass = [] }) {
  if (!items.length) return [];
  const capped = items.slice(0, 8);
  const rough = await coarse(buffer, capped);
  // fall back to the detection call's own box where the grid pass found nothing
  const start = rough.map((r, i) => r || (firstPass[i] ? [firstPass[i].x, firstPass[i].y, firstPass[i].w, firstPass[i].h] : null));
  const zoomed = await Promise.all(start.map((c, i) => (c ? refine(buffer, capped[i], c) : null)));
  const boxes = zoomed.map((z, i) => z || start[i]);

  // Snap to real pixels: text to what OCR actually reads, subjects to a clearly matching edge blob.
  try {
    const maps = await loadMaps(buffer);
    const anyText = capped.some((it) => it.text);
    const ocr = anyText ? await getOcrLines(buffer) : null;
    for (let i = 0; i < capped.length; i++) {
      if (!boxes[i]) continue;
      const it = capped[i];
      const key = it.snapKey || (it.text ? 'primaryHeadline' : 'keyVisual');
      const res = await snapRegions(buffer, { [key]: boxes[i] }, { texts: it.text ? { [key]: it.text } : {}, ocr, maps });
      const s = res[key];
      if (s?.snapped && iou(boxes[i], s.box) > 0.3) boxes[i] = s.box;
    }
  } catch (err) {
    console.warn('[box-locator] snapping skipped:', err.message);
  }
  return capped.map((_, i) => (boxes[i] ? normBox({ x: boxes[i][0], y: boxes[i][1], w: boxes[i][2], h: boxes[i][3] }) : null));
}
