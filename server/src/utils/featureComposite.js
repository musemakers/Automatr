import sharp from 'sharp';

// Builds the FINAL creative of a custom feature from the separately generated images
// (e.g. "Before" + "After" side by side). Everything that is text - the Before/After labels and the
// disclaimer line - is drawn here by code, never by the image model, so it cannot come out garbled.
//
// Fonts: sharp renders SVG text with the host's installed fonts (same note as utils/reelCompositor.js).
// Set REEL_FONT_SANS to a family that exists on the server if labels show as boxes.
const SANS = process.env.REEL_FONT_SANS || 'Poppins, Montserrat, Helvetica Neue, Arial, DejaVu Sans, sans-serif';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const THEMES = {
  light: { bg: '#FFFFFF', text: '#2B2F3A', pill: 'rgba(17,19,26,0.82)', pillText: '#FFFFFF' },
  dark: { bg: '#0F1115', text: '#C9CEDB', pill: 'rgba(255,255,255,0.90)', pillText: '#111319' }
};

const MARGIN = 36;
const GAP = 28;
const RADIUS = 28;
const MAX_OUT_WIDTH = 2600;

async function roundedCell(buf, w, h) {
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`);
  return sharp(buf).resize({ width: w, height: h, fit: 'cover', position: 'centre' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

function pill(label, theme) {
  const fontSize = 40;
  const w = Math.round(label.length * fontSize * 0.6 + 64);
  const h = 76;
  return {
    w,
    h,
    buf: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="${theme.pill}"/>` +
        `<text x="${w / 2}" y="${h / 2 + 14}" text-anchor="middle" font-family="${SANS}" font-size="${fontSize}" font-weight="700" letter-spacing="1" fill="${theme.pillText}">${esc(label)}</text></svg>`
    )
  };
}

/**
 * @param {{imagePaths: string[], labels?: string[], mode: 'side_by_side'|'stacked'|'grid', showLabels?: boolean,
 *          disclaimer?: string, background?: 'light'|'dark'}} args
 * @returns {Promise<Buffer>} JPEG
 */
export async function composeCreative({ imagePaths, labels = [], mode = 'side_by_side', showLabels = true, disclaimer = '', background = 'light' }) {
  const theme = THEMES[background] || THEMES.light;
  const metas = await Promise.all(imagePaths.map(async (p) => {
    const m = await sharp(p).metadata();
    return { p, w: m.width || 1024, h: m.height || 1024 };
  }));

  // Cell sizes + positions for each layout.
  const cells = [];
  let width;
  let height;
  if (mode === 'stacked') {
    const cw = 1080;
    let y = MARGIN;
    for (const m of metas) {
      const ch = Math.round((m.h / m.w) * cw);
      cells.push({ m, x: MARGIN, y, w: cw, h: ch });
      y += ch + GAP;
    }
    width = cw + MARGIN * 2;
    height = y - GAP + MARGIN;
  } else if (mode === 'grid') {
    const cols = 2;
    const cw = 720;
    const ch = 900;
    metas.forEach((m, i) => {
      cells.push({ m, x: MARGIN + (i % cols) * (cw + GAP), y: MARGIN + Math.floor(i / cols) * (ch + GAP), w: cw, h: ch });
    });
    const rows = Math.ceil(metas.length / cols);
    width = MARGIN * 2 + cols * cw + (cols - 1) * GAP;
    height = MARGIN * 2 + rows * ch + (rows - 1) * GAP;
  } else {
    // side by side: every image the same height, widths follow each image's own shape
    const ch = 1200;
    let x = MARGIN;
    for (const m of metas) {
      const cw = Math.round((m.w / m.h) * ch);
      cells.push({ m, x, y: MARGIN, w: cw, h: ch });
      x += cw + GAP;
    }
    width = x - GAP + MARGIN;
    height = ch + MARGIN * 2;
  }

  const disclaimerH = disclaimer ? 84 : 0;
  height += disclaimerH;

  const layers = [];
  for (const [i, c] of cells.entries()) {
    layers.push({ input: await roundedCell(await sharp(c.m.p).toBuffer(), c.w, c.h), left: c.x, top: c.y });
    const label = showLabels ? String(labels[i] || '').trim() : '';
    if (label) {
      const pl = pill(label.toUpperCase(), theme);
      layers.push({ input: pl.buf, left: c.x + 28, top: c.y + c.h - pl.h - 28 });
    }
  }
  if (disclaimer) {
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${disclaimerH}"><text x="${width / 2}" y="${disclaimerH / 2 + 4}" text-anchor="middle" font-family="${SANS}" font-size="28" font-weight="500" fill="${theme.text}">${esc(disclaimer)}</text></svg>`
      ),
      left: 0,
      top: height - disclaimerH
    });
  }

  let out = sharp({ create: { width, height, channels: 3, background: theme.bg } }).composite(layers);
  if (width > MAX_OUT_WIDTH) out = sharp(await out.png().toBuffer()).resize({ width: MAX_OUT_WIDTH });
  return out.jpeg({ quality: 92 }).toBuffer();
}
