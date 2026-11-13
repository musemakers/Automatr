import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundled fonts (server/assets/fonts: Poppins + Playfair Display, SIL Open Font License) so overlay text looks
// the same on every server. fontconfig has to learn about them BEFORE sharp first draws text, so this runs
// when the module loads. Skipped if FONTCONFIG_FILE is already set (then install the fonts yourself).
try {
  const fontDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
  if (!process.env.FONTCONFIG_FILE && fs.existsSync(fontDir)) {
    const conf = path.join(os.tmpdir(), 'automatr-fonts.conf');
    fs.writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${fontDir}</dir><cachedir>${path.join(os.tmpdir(), 'automatr-font-cache')}</cachedir></fontconfig>`);
    process.env.FONTCONFIG_FILE = conf;
  }
} catch { /* fonts fall back to whatever the server has */ }

const sharp = (await import('sharp')).default;

// Draws the customer's own text (headline, key points ...) onto a generated image, in the positions and
// style Brief Studio learned from a reference creative. Text is always drawn by code, never by the image
// model, so spelling is exact. Block shapes are validated by constants/customFeature.js#normalizeOverlay.
//
// Fonts: sharp renders SVG text with the fonts installed on the server (same note as featureComposite.js).
// Set REEL_FONT_SANS / REEL_FONT_SERIF to use other families.
const SANS = process.env.REEL_FONT_SANS || 'Poppins, Helvetica Neue, Arial, DejaVu Sans, sans-serif';
const SERIF = process.env.REEL_FONT_SERIF || 'Playfair Display, Georgia, DejaVu Serif, serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "Instant **makeup finish**" -> [{t:'Instant ', b:false}, {t:'makeup finish', b:true}]
function segments(text) {
  const out = [];
  String(text).split(/(\*\*[^*]+\*\*)/g).forEach((p) => {
    if (!p) return;
    if (p.startsWith('**') && p.endsWith('**')) out.push({ t: p.slice(2, -2), b: true });
    else out.push({ t: p, b: false });
  });
  return out;
}
const plain = (text) => segments(text).map((s) => s.t).join('');

// Rough text width (SVG has no text measuring): average glyph width as a share of the font size.
function widthOf(text, size, b) {
  const s = b.font === 'serif' ? 0.55 : 0.54;
  const bold = b.weight === 'bold' ? 1.08 : 1;
  const caps = b.uppercase ? 1.24 : 1;
  return plain(text).length * size * s * bold * caps;
}

function wrap(text, size, maxW, b) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && widthOf(test, size, b) > maxW) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(line, b) {
  const base = b.weight === 'bold' ? 700 : 400;
  return segments(b.uppercase ? line.toUpperCase() : line)
    .map((s) => `<tspan font-weight="${s.b ? 700 : base}">${esc(s.t)}</tspan>`).join('');
}

function textLines({ lines, x, y0, size, lh, b }) {
  const anchor = b.align === 'center' ? 'middle' : b.align === 'right' ? 'end' : 'start';
  const family = b.font === 'serif' ? SERIF : SANS;
  return lines.map((ln, i) => `<text xml:space="preserve" x="${x.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="${anchor}" font-family="${esc(family)}" font-size="${size.toFixed(1)}" fill="${b.color}" letter-spacing="${b.uppercase ? (size * 0.02).toFixed(2) : 0}">${tspans(ln, b)}</text>`).join('');
}

function textBlock(b, text, W, H) {
  const [l, t, r, bt] = b.box.map((v, i) => (v / 100) * (i % 2 === 0 ? W : H));
  const boxW = r - l;
  const boxH = bt - t;
  let size = (b.size / 100) * H;
  let lines = wrap(text, size, boxW, b);
  for (let guard = 0; guard < 30 && lines.length * size * b.lineHeight > boxH && size > 10; guard++) {
    size *= 0.94;
    lines = wrap(text, size, boxW, b);
  }
  const lh = size * b.lineHeight;
  const total = lines.length * lh;
  const x = b.align === 'center' ? (l + r) / 2 : b.align === 'right' ? r : l;
  const y0 = t + Math.max(0, (boxH - total) / 2) + size * 0.95; // vertically centred in its box
  return textLines({ lines, x, y0, size, lh, b });
}

function listBlock(b, text, W, H) {
  const items = String(text).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!items.length) return '';
  const [l, t, r, bt] = b.box.map((v, i) => (v / 100) * (i % 2 === 0 ? W : H));
  const rowH = (bt - t) / items.length;
  let size = (b.size / 100) * H;
  const dot = size * 0.32;
  const indent = dot * 2 + size * 0.45;
  const maxW = r - l - indent;
  // every item stays on one line: shrink until the longest fits
  for (let g = 0; g < 30 && Math.max(...items.map((it) => widthOf(it, size, b))) > maxW && size > 10; g++) size *= 0.95;
  const family = b.font === 'serif' ? SERIF : SANS;
  const sw = Math.max(1, H * 0.002);
  let out = '';
  items.forEach((it, i) => {
    const cy = t + rowH * i + rowH * 0.5 + size * 0.05;
    out += `<circle cx="${(l + dot).toFixed(1)}" cy="${(cy - size * 0.3).toFixed(1)}" r="${dot.toFixed(1)}" fill="${b.bulletColor || b.color}"/>`;
    out += `<text xml:space="preserve" x="${(l + indent).toFixed(1)}" y="${cy.toFixed(1)}" font-family="${esc(family)}" font-size="${size.toFixed(1)}" fill="${b.color}">${tspans(it, b)}</text>`;
    if (b.divider && i < items.length - 1) {
      const y = t + rowH * (i + 1) - rowH * 0.02;
      out += `<line x1="${(l + indent).toFixed(1)}" y1="${y.toFixed(1)}" x2="${r.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${b.dividerColor || b.color}" stroke-width="${sw.toFixed(1)}" opacity="0.9"/>`;
    }
  });
  return out;
}

/**
 * @param {{imagePath: string, blocks: object[], values: Record<string, any>}} o
 * @returns {Promise<Buffer>} JPEG with the text drawn on. Blocks whose field is empty are skipped.
 */
export async function renderOverlay({ imagePath, blocks, values }) {
  const base = sharp(imagePath);
  const { width: W, height: H } = await base.metadata();
  if (!W || !H) throw new Error('Could not read the generated image to add text.');
  let body = '';
  for (const b of blocks || []) {
    const v = values?.[b.fieldKey];
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text) continue;
    body += b.kind === 'list' ? listBlock(b, text, W, H) : textBlock(b, text.replace(/\s*\n\s*/g, ' '), W, H);
  }
  if (!body) return base.jpeg({ quality: 92 }).toBuffer();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
  return base.composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
}
