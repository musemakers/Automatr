import fs from 'node:fs';
import sharp from 'sharp';
import * as router from '../services/ai/router.js';
import { gridOverlay } from './gridOverlay.js';
import { resolveFont, textLine, breakLines } from './fontSpecimen.js';

// PRECISE FONT TEXT. The image model draws the picture with clean empty space and NO text; the headline and sub-headline are then
// set here, in code, with the real brand font files, so every letterform is exact. A vision model looks at the finished image and
// decides where the text goes and how big it is (the "layout"); everything it says is checked and clamped before anything is drawn,
// and a plain left-hand layout is used whenever it fails. Switched on per customer (Customer.features.preciseFontText).

const VISION_MODEL = process.env.TEXT_LAYOUT_MODEL || process.env.TEMPLATE_ANALYSIS_MODEL || 'auto';
const DEFAULT_LAYOUT = { area: [5, 7, 52, 62], align: 'left', valign: 'top', headlineSize: 7.5, subSize: 3.3, headlineColor: '', subColor: '', gap: 2.2, source: 'default' };
const HEX = /^#[0-9a-f]{6}$/i;

/** True when every font this creative needs can be found (an uploaded file, Google Fonts, or installed on the server). */
export async function canSetText(fonts, { headline = '', subHeadline = '' } = {}) {
  try {
    const display = String(fonts?.display || '').trim();
    const body = String(fonts?.body || '').trim() || display;
    if (headline.trim() && !(display && (await resolveFont(display, 700)))) return false;
    if (subHeadline.trim() && !(body && (await resolveFont(body, 400)))) return false;
    return Boolean(headline.trim() || subHeadline.trim());
  } catch {
    return false;
  }
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Validates whatever the vision model said and fills any gap from the default, so a bad answer can never break the overlay. */
function cleanLayout(raw) {
  const d = DEFAULT_LAYOUT;
  const r = raw && typeof raw === 'object' ? raw : {};
  let area = Array.isArray(r.area) && r.area.length === 4 ? r.area.map(Number) : d.area;
  if (!area.every(Number.isFinite)) area = d.area;
  let [l, t, rt, b] = area;
  l = num(l, 3, 90, d.area[0]); t = num(t, 3, 90, d.area[1]); rt = num(rt, 10, 97, d.area[2]); b = num(b, 10, 97, d.area[3]);
  if (rt - l < 22 || b - t < 12) [l, t, rt, b] = d.area; // too small to hold readable text: use the default area
  const headlineSize = num(r.headlineSize, 3.5, 11, d.headlineSize);
  return {
    area: [l, t, rt, b],
    align: ['left', 'center', 'right'].includes(r.align) ? r.align : d.align,
    valign: ['top', 'middle', 'bottom'].includes(r.valign) ? r.valign : d.valign,
    headlineSize,
    subSize: Math.min(num(r.subSize, 1.8, 5, d.subSize), headlineSize * 0.6),
    headlineColor: HEX.test(r.headlineColor || '') ? r.headlineColor : '',
    subColor: HEX.test(r.subColor || '') ? r.subColor : '',
    gap: num(r.gap, 0.5, 6, d.gap),
    source: 'ai'
  };
}

/**
 * Asks a vision model where the headline and sub-headline should go on this finished, text-free image. Returns { layout, usage }:
 * a validated layout (the default one when the call fails) and the model that answered, for the usage log.
 */
export async function planTextLayout({ buffer, headline, subHeadline }) {
  try {
    const grid = await gridOverlay(buffer);
    const instruction = [
      'You are the art director placing text on a finished advertising image that has no text on it yet. A coordinate grid is drawn over the image: yellow lines every 10%, numbers along the edges are percentages from the TOP-LEFT corner (x left to right, y top to bottom). The grid is a measuring aid only - ignore it when judging colours and content.',
      `The text to place: HEADLINE (${headline.trim().length} characters): "${headline.trim()}"${subHeadline.trim() ? ` and SUB-HEADLINE (${subHeadline.trim().length} characters): "${subHeadline.trim()}"` : ' (no sub-headline)'}. The sub-headline sits directly under the headline.`,
      'Choose ONE rectangular area of the image for the whole text block: the largest clean, calm region with nothing important in it. It must NOT cover any face, hand, product, pack, logo or other key subject, and should avoid busy detail. Prefer an existing empty or plain area, keep at least 3% from every edge, and make it big enough that the headline can be large and read clearly.',
      'Reply with ONLY a JSON object, no markdown:',
      '{"area":[left,top,right,bottom],"align":"left|center|right","valign":"top|middle|bottom","headlineSize":number,"subSize":number,"headlineColor":"#rrggbb","subColor":"#rrggbb","gap":number}',
      'area = percentages of the image (0-100). headlineSize = height of one headline line as a percentage of the IMAGE HEIGHT (usually 5 to 9; larger for short headlines, smaller for long ones). subSize likewise for the sub-headline (usually 2.5 to 4, always clearly smaller than the headline). Colours must have strong contrast against the background behind the text: near-black or white unless the image clearly suggests a brand colour that is also readable. gap = space between headline and sub-headline as a percentage of the image height. align/valign = how the text block sits inside the area.'
    ].join('\n');
    const r = await router.analyzeImage({ purpose: 'placing the headline and sub-headline', model: VISION_MODEL, detail: 'high', base64: grid.buffer.toString('base64'), mimeType: grid.mimeType, instruction, maxTokens: 350 });
    if (!r?.text) return { layout: { ...DEFAULT_LAYOUT }, usage: null };
    const s = r.text.replace(/^```json|```$/gim, '').trim();
    const parsed = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    return { layout: cleanLayout(parsed), usage: { modelUsed: r.modelUsed, inputTokens: 1800 + Math.ceil(instruction.length / 4), outputTokens: Math.ceil(r.text.length / 4) } };
  } catch (err) {
    console.warn('[text-overlay] layout step failed, using the default layout:', err.message);
    return { layout: { ...DEFAULT_LAYOUT }, usage: null };
  }
}

/** Mean luminance (0-1) of a region of the image, to check text colours against what is really behind them. */
async function backgroundLuminance(buffer, box) {
  try {
    const { width, height } = await sharp(buffer).metadata();
    const left = Math.max(0, Math.floor(box.left)), top = Math.max(0, Math.floor(box.top));
    const w = Math.max(1, Math.min(width - left, Math.floor(box.width))), h = Math.max(1, Math.min(height - top, Math.floor(box.height)));
    const { channels } = await sharp(buffer).extract({ left, top, width: w, height: h }).stats();
    const [r, g, b] = channels.slice(0, 3).map((c) => c.mean);
    return lum(`#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
  } catch {
    return 0.5;
  }
}

/** The colour to use: the model's pick when it reads well on this background, otherwise near-black or white, whichever reads better. */
function readableColor(pick, bgLum) {
  if (pick && contrast(lum(pick), bgLum) >= 4.5) return pick;
  return contrast(lum('#111111'), bgLum) >= contrast(lum('#ffffff'), bgLum) ? '#111111' : '#ffffff';
}

/**
 * Draws the headline and sub-headline onto the image file with the real brand fonts, shrinking the text until it fits the area.
 * Rewrites the file in place (same format and size). Throws when nothing could be drawn; the caller decides what to do then.
 */
export async function overlayText({ filePath, headline, subHeadline, fonts, layout }) {
  const src = fs.readFileSync(filePath);
  const meta = await sharp(src).metadata();
  const W = meta.width, H = meta.height;
  const L = cleanLayout(layout);
  const [al, at, ar, ab] = L.area;
  const areaX = (al / 100) * W, areaY = (at / 100) * H, areaW = ((ar - al) / 100) * W, areaH = ((ab - at) / 100) * H;

  const display = String(fonts?.display || '').trim();
  const body = String(fonts?.body || '').trim() || display;
  const headSrc = headline.trim() ? await resolveFont(display, 700) : null;
  const subSrc = subHeadline.trim() ? await resolveFont(body, 400) : null;
  if ((headline.trim() && !headSrc) || (subHeadline.trim() && !subSrc)) throw new Error('A brand font could not be found.');

  const bgLum = await backgroundLuminance(src, { left: areaX, top: areaY, width: areaW, height: areaH });
  const headColor = readableColor(L.headlineColor, bgLum);
  const subColor = readableColor(L.subColor || L.headlineColor, bgLum);

  let headPx = (L.headlineSize / 100) * H;
  let subPx = (L.subSize / 100) * H;
  const lead = 1.08;
  let drawn = null;
  for (let i = 0; i < 16; i++) {
    const build = async (text, font, px, weight, color, bySentence, widthChars) => {
      const lines = breakLines(text, Math.max(8, widthChars), bySentence);
      const out = [];
      for (const line of lines) out.push(await textLine({ fontfile: font.file, family: font.family, text: line, px, weight: font.weight || weight, color }));
      return out;
    };
    const headLines = headSrc ? await build(headline, { ...headSrc, family: display }, headPx, 700, headColor, true, Math.floor(areaW / (headPx * 0.56))) : [];
    const subLines = subSrc ? await build(subHeadline, { ...subSrc, family: body }, subPx, 400, subColor, false, Math.floor(areaW / (subPx * 0.5))) : [];
    const widest = Math.max(0, ...[...headLines, ...subLines].map((l) => l.width));
    const hH = headLines.reduce((s, l, k) => s + (k === 0 ? l.height : headPx * lead), 0);
    const sH = subLines.reduce((s, l, k) => s + (k === 0 ? l.height : subPx * 1.2), 0);
    const gap = headLines.length && subLines.length ? (L.gap / 100) * H : 0;
    const total = hH + gap + sH;
    if (widest <= areaW && total <= areaH) { drawn = { headLines, subLines, total, gap }; break; }
    headPx *= 0.94; subPx *= 0.94; // does not fit yet: shrink both together and try again
    if (headPx < H * 0.02) break;
  }
  if (!drawn) throw new Error('The text did not fit the chosen area.');

  const layers = [];
  const startY = areaY + (L.valign === 'top' ? 0 : L.valign === 'middle' ? (areaH - drawn.total) / 2 : areaH - drawn.total);
  const xFor = (w) => areaX + (L.align === 'left' ? 0 : L.align === 'center' ? (areaW - w) / 2 : areaW - w);
  let y = startY;
  drawn.headLines.forEach((l, k) => { layers.push({ input: l.data, left: Math.round(xFor(l.width)), top: Math.round(y) }); y += k === drawn.headLines.length - 1 ? l.height : headPx * lead; });
  y += drawn.gap;
  drawn.subLines.forEach((l, k) => { layers.push({ input: l.data, left: Math.round(xFor(l.width)), top: Math.round(y) }); y += k === drawn.subLines.length - 1 ? l.height : subPx * 1.2; });
  if (!layers.length) throw new Error('Nothing to draw.');

  const fmt = meta.format === 'jpeg' || meta.format === 'webp' ? meta.format : 'png';
  const out = await sharp(src).composite(layers).toFormat(fmt, fmt === 'png' ? {} : { quality: 95 }).toBuffer();
  fs.writeFileSync(filePath, out);
  return { source: L.source, area: L.area };
}
