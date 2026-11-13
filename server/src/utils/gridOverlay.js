import sharp from 'sharp';

// Draws a labelled percentage grid on top of an image so a vision model can
// read element positions off it instead of guessing coordinates from
// nothing. Vision models are poor at "where is X, as a fraction of the
// image" but good at reading numbers printed next to lines. Labels are
// drawn as 7-segment strokes (not SVG <text>) so they render identically
// on any server regardless of which system fonts are installed.

const MAX_SIDE = 1400;

// segments: a=top b=upper-right c=lower-right d=bottom e=lower-left f=upper-left g=middle
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd'
};

function digitLines(digit, x, y, w, h) {
  const m = h / 2;
  const seg = {
    a: [x, y, x + w, y],
    b: [x + w, y, x + w, y + m],
    c: [x + w, y + m, x + w, y + h],
    d: [x, y + h, x + w, y + h],
    e: [x, y + m, x, y + h],
    f: [x, y, x, y + m],
    g: [x, y + m, x + w, y + m]
  };
  return [...SEGMENTS[digit]].map((k) => seg[k]);
}

// Returns an SVG fragment: a dark pill with the number drawn in white strokes,
// positioned so (cx, cy) is the pill's centre.
function label(n, cx, cy, fs) {
  const str = String(n);
  const dw = fs * 0.55;
  const dh = fs;
  const gap = fs * 0.32;
  const textW = str.length * dw + (str.length - 1) * gap;
  const padX = fs * 0.35;
  const padY = fs * 0.3;
  const x0 = cx - textW / 2;
  const y0 = cy - dh / 2;
  let out = `<rect x="${(x0 - padX).toFixed(1)}" y="${(y0 - padY).toFixed(1)}" width="${(textW + padX * 2).toFixed(1)}" height="${(dh + padY * 2).toFixed(1)}" rx="${(fs * 0.25).toFixed(1)}" fill="#000" fill-opacity="0.72"/>`;
  [...str].forEach((ch, i) => {
    const dx = x0 + i * (dw + gap);
    for (const [x1, y1, x2, y2] of digitLines(Number(ch), dx, y0, dw, dh)) {
      out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="${Math.max(1.4, fs * 0.13).toFixed(1)}" stroke-linecap="round"/>`;
    }
  });
  return out;
}

/**
 * @param {Buffer} buffer any image sharp can read
 * @param {{maxSide?: number, enlarge?: boolean}} opts enlarge=true upscales small images (used for zoomed crops)
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} JPEG with a 10%-step grid
 */
/**
 * Crops a normalized region [x, y, w, h] (0-1, top-left origin) out of an
 * image, honouring EXIF orientation the same way gridOverlay does, so the
 * crop and the full-frame grid agree on what "x/y" mean.
 */
export async function cropRegion(buffer, [x, y, w, h]) {
  const oriented = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const W = oriented.info.width;
  const H = oriented.info.height;
  const left = Math.max(0, Math.min(W - 1, Math.round(x * W)));
  const top = Math.max(0, Math.min(H - 1, Math.round(y * H)));
  const width = Math.max(1, Math.min(W - left, Math.round(w * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(h * H)));
  return sharp(oriented.data).extract({ left, top, width, height }).toBuffer();
}

export async function gridOverlay(buffer, { maxSide = MAX_SIDE, enlarge = false } = {}) {
  const base = sharp(buffer).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: !enlarge });
  const { data, info } = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const fs = Math.min(26, Math.max(11, Math.round(Math.min(W, H) / 36)));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  for (let p = 10; p <= 90; p += 10) {
    const x = (W * p) / 100;
    const y = (H * p) / 100;
    const major = p === 50;
    for (const [w, c, o] of [[3, '#000', 0.35], [major ? 1.8 : 1.1, '#ffe600', 0.9]]) {
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}"/>`;
      svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-opacity="${o}" stroke-width="${w}"/>`;
    }
  }
  const edge = fs * 1.1;
  for (let p = 10; p <= 90; p += 10) {
    const x = (W * p) / 100;
    const y = (H * p) / 100;
    svg += label(p, x, edge, fs) + label(p, x, H - edge, fs);
    svg += label(p, edge * 1.1, y, fs) + label(p, W - edge * 1.1, y, fs);
  }
  svg += '</svg>';

  const out = await sharp(data, { raw: { width: W, height: H, channels: info.channels } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer: out, mimeType: 'image/jpeg' };
}
