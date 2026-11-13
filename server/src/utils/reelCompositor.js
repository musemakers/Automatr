import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { OUT_W, OUT_H, FPS } from '../constants/multiSceneVideo.js';

const run = promisify(execFile);

// Everything here is deterministic code: on-screen text, the exact product, logos,
// the end card and the stitch. No generative model touches any of it, so lettering
// can never come out garbled and packaging can never be redrawn.
//
// NOTE (deployment): text is drawn through sharp's SVG renderer, which uses the
// system's installed fonts. A bare Linux image may only have a basic fallback font
// (DejaVu). Install fonts (e.g. fontconfig + a sans/serif family) or set
// REEL_FONT_SANS / REEL_FONT_SERIF to families that exist on the host.

const SANS = process.env.REEL_FONT_SANS || 'Poppins, Montserrat, Helvetica Neue, Arial, DejaVu Sans, sans-serif';
const SERIF = process.env.REEL_FONT_SERIF || 'Playfair Display, Georgia, Times New Roman, DejaVu Serif, serif';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let ffmpegPromise = null;
export async function findFfmpeg() {
  ffmpegPromise ||= (async () => {
    const candidates = [];
    if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
    try { candidates.push((await import('ffmpeg-static')).default); } catch { /* optional dependency */ }
    candidates.push('ffmpeg');
    for (const c of candidates) {
      if (!c) continue;
      try { await run(c, ['-version'], { timeout: 10000 }); return c; } catch { /* try next */ }
    }
    return null;
  })();
  return ffmpegPromise;
}

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${OUT_W} ${OUT_H}">${body}</svg>`);
const png = (body) => sharp(svg(body)).png().toBuffer();

const SCRIM = `
  <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/>
  </linearGradient></defs>`;

/** Hero beat: small kicker, big title, one-line subline - left aligned, mid-frame. */
export function renderHeroOverlay({ kicker, title, subline }) {
  const stroke = 'stroke="rgba(0,0,0,0.45)" stroke-width="5" paint-order="stroke" stroke-linejoin="round"';
  return png(`
    <text x="48" y="560" font-family="${SERIF}" font-size="40" font-weight="700" fill="#fff" ${stroke}>${esc(kicker)}</text>
    <text x="48" y="660" font-family="${SERIF}" font-size="104" font-weight="800" fill="#fff" ${stroke}>${esc(title)}</text>
    <text x="48" y="714" font-family="${SANS}" font-size="30" font-weight="600" fill="#fff" ${stroke}>${esc(subline)}</text>`);
}

/** Look scene: sans title over a serif label on a dark bar, lower-left, over a soft scrim. */
export async function renderLookOverlay({ title, label }) {
  const stroke = 'stroke="rgba(0,0,0,0.4)" stroke-width="4" paint-order="stroke" stroke-linejoin="round"';
  const labelW = Math.min(OUT_W - 96, 40 + String(label || '').length * 30);
  return png(`${SCRIM}
    <rect x="0" y="${OUT_H * 0.55}" width="${OUT_W}" height="${OUT_H * 0.45}" fill="url(#scrim)"/>
    <text x="48" y="850" font-family="${SANS}" font-size="56" font-weight="700" fill="#fff" ${stroke}>${esc(title)}</text>
    ${label ? `<rect x="40" y="868" width="${labelW}" height="70" rx="6" fill="rgba(20,20,20,0.55)"/>
    <text x="52" y="922" font-family="${SERIF}" font-size="52" font-weight="600" fill="#fff">${esc(label)}</text>` : ''}`);
}

async function fitLogo(p, maxW, maxH) {
  const { data, info } = await sharp(p).resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
  return { input: data, w: info.width, h: info.height };
}

/** End card: logo, CTA pill, URL, "Available On" + white pill of marketplace logos. Logos are pasted untouched. */
export async function renderEndCard({ logoPath, cta, urlText, marketLogoPaths = [] }) {
  const layers = [];
  let y = 330;
  if (logoPath) {
    const logo = await fitLogo(logoPath, 420, 190);
    layers.push({ input: logo.input, left: Math.round((OUT_W - logo.w) / 2), top: y });
    y += logo.h + 56;
  } else {
    y += 120;
  }

  const ctaText = String(cta || '').toUpperCase();
  const ctaW = Math.max(240, 70 + ctaText.length * 24);
  const hasMarkets = marketLogoPaths.length > 0;
  let body = `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2b2b"/><stop offset="1" stop-color="#0b0b0b"/></linearGradient></defs>
    <rect width="${OUT_W}" height="${OUT_H}" fill="url(#bg)"/>`;
  if (ctaText) {
    body += `<rect x="${(OUT_W - ctaW) / 2}" y="${y}" width="${ctaW}" height="68" rx="10" fill="#fff"/>
      <text x="${OUT_W / 2}" y="${y + 46}" text-anchor="middle" font-family="${SANS}" font-size="32" font-weight="800" fill="#111">${esc(ctaText)}</text>`;
    y += 68 + 44;
  }
  if (urlText) {
    body += `<text x="${OUT_W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-size="28" font-weight="500" fill="#fff">${esc(urlText)}</text>`;
    y += 90;
  }
  if (hasMarkets) {
    body += `<text x="${OUT_W / 2}" y="${y}" text-anchor="middle" font-family="${SANS}" font-size="44" font-weight="600" fill="#fff">Available On</text>`;
    y += 36;
    const barW = OUT_W - 96;
    const barH = 92;
    body += `<rect x="48" y="${y}" width="${barW}" height="${barH}" rx="12" fill="#fff"/>`;
    const slot = (barW - 32) / marketLogoPaths.length;
    for (let i = 0; i < marketLogoPaths.length; i++) {
      try {
        const lg = await fitLogo(marketLogoPaths[i], Math.floor(slot - 22), 54);
        layers.push({ input: lg.input, left: Math.round(48 + 16 + slot * i + (slot - lg.w) / 2), top: Math.round(y + (barH - lg.h) / 2) });
      } catch { /* skip an unreadable logo rather than fail the reel */ }
    }
  }
  const base = await png(body);
  return sharp(base).composite(layers).png().toBuffer();
}

/**
 * Hero still: the model-made background scene + the EXACT product pixels pasted on top
 * (right of centre, standing). If the product image has no transparency it is treated as a
 * finished product shot and used full-frame instead of being pasted as a box.
 */
export async function composeHeroStill({ backgroundBuf, productPath }) {
  const bg = await sharp(backgroundBuf).resize(OUT_W * 1.5, OUT_H * 1.5, { fit: 'cover' }).toBuffer();
  const meta = await sharp(productPath).metadata();
  if (!meta.hasAlpha) {
    return sharp(productPath).resize(OUT_W * 1.5, OUT_H * 1.5, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
  }
  const W = OUT_W * 1.5, H = OUT_H * 1.5;
  let prod = sharp(productPath);
  try { prod = sharp(await prod.trim().toBuffer()); } catch { prod = sharp(productPath); }
  const { data, info } = await prod.resize({ height: Math.round(H * 0.46), width: Math.round(W * 0.34), fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
  const left = Math.round(W * 0.74 - info.width / 2);
  const top = Math.round(H * 0.72 - info.height);
  // soft contact shadow so it sits in the scene
  const shadow = await sharp({ create: { width: info.width + 40, height: 26, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.35 } } }).blur(10).png().toBuffer();
  return sharp(bg)
    .composite([{ input: shadow, left: left - 20, top: top + info.height - 12 }, { input: data, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function ff(ffmpeg, args) {
  try {
    await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`ffmpeg failed: ${String(err.stderr || err.message).slice(0, 400)}`);
  }
}

const ENC = ['-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const FIT = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},fps=${FPS}`;

/** Trim a generated clip to `seconds`, force 720x1280/30fps, strip audio, lay the overlay on with a short fade-in. */
export async function buildClipSegment({ ffmpeg, clipPath, overlayPath, seconds, outPath }) {
  const s = Number(seconds).toFixed(2);
  const pad = `tpad=stop_mode=clone:stop_duration=3,trim=duration=${s},setpts=PTS-STARTPTS`;
  if (!overlayPath) {
    return ff(ffmpeg, ['-i', clipPath, '-vf', `${pad},${FIT},format=yuv420p`, '-t', s, ...ENC, outPath]);
  }
  const fc = `[0:v]${pad},${FIT}[b];[1:v]format=rgba,fade=t=in:st=0.1:d=0.25:alpha=1[o];[b][o]overlay=0:0:format=auto,format=yuv420p[v]`;
  return ff(ffmpeg, ['-i', clipPath, '-loop', '1', '-t', s, '-i', overlayPath, '-filter_complex', fc, '-map', '[v]', '-t', s, ...ENC, outPath]);
}

/** Still image held for `seconds` with a fade-in (the end card). */
export async function buildStillSegment({ ffmpeg, imagePath, seconds, outPath }) {
  const s = Number(seconds).toFixed(2);
  return ff(ffmpeg, ['-loop', '1', '-t', s, '-i', imagePath, '-vf', `scale=${OUT_W}:${OUT_H},fade=t=in:st=0:d=0.4,fps=${FPS},format=yuv420p`, '-t', s, ...ENC, outPath]);
}

export async function concatSegments({ ffmpeg, segmentPaths, outPath }) {
  const list = `${outPath}.txt`;
  fs.writeFileSync(list, segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await ff(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outPath]);
  } finally {
    try { fs.unlinkSync(list); } catch { /* ignore */ }
  }
}

export async function probeDuration(ffmpeg, p) {
  let err = '';
  try { await run(ffmpeg, ['-hide_banner', '-i', p], { timeout: 15000 }); } catch (e) { err = String(e.stderr || ''); }
  const m = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(err);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export function tmpName(dir, name) {
  return path.join(dir, name);
}
