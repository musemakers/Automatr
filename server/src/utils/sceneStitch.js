import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { XFADE, TRANSITION_SECONDS, CUT_SECONDS } from '../constants/sceneReel.js';

const run = promisify(execFile);
const FPS = 30;
const SANS = process.env.REEL_FONT_SANS || 'Poppins, Montserrat, Helvetica Neue, Arial, DejaVu Sans, sans-serif';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const dimsFor = (aspect) => (aspect === '16:9' ? { w: 1280, h: 720 } : { w: 720, h: 1280 });

const ff = (ffmpeg, args) => run(ffmpeg, ['-v', 'error', '-y', ...args], { timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
const ENC = ['-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];

function wrapLines(text, maxChars, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Transparent PNG with the scene's caption in the lower third. Drawn by code so the wording is always exact. */
export async function renderCaption({ text, w, h }) {
  const size = Math.round(Math.min(w, h) * 0.066);
  const lines = wrapLines(text, Math.max(10, Math.floor((w * 0.84) / (size * 0.56))));
  const lineH = Math.round(size * 1.28);
  const lastBaseline = Math.round(h * 0.88);
  const firstBaseline = lastBaseline - (lines.length - 1) * lineH;
  const stroke = 'stroke="rgba(0,0,0,0.5)" stroke-width="6" paint-order="stroke" stroke-linejoin="round"';
  const body = lines.map((l, i) => `<text x="${w / 2}" y="${firstBaseline + i * lineH}" text-anchor="middle" font-family="${SANS}" font-size="${size}" font-weight="700" fill="#fff" ${stroke}>${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>
    <rect x="0" y="${Math.round(h * 0.6)}" width="${w}" height="${Math.round(h * 0.4)}" fill="url(#s)"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** One scene: trimmed (or held) to exactly `seconds`, fitted to the reel size, caption laid on with a short fade-in, no audio. */
export async function buildSegment({ ffmpeg, clipPath, captionPng, seconds, w, h, outPath }) {
  const s = Number(seconds).toFixed(2);
  const pad = `tpad=stop_mode=clone:stop_duration=10,trim=duration=${s},setpts=PTS-STARTPTS`;
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS}`;
  if (!captionPng) return ff(ffmpeg, ['-i', clipPath, '-vf', `${pad},${fit},format=yuv420p`, '-t', s, ...ENC, outPath]);
  const fc = `[0:v]${pad},${fit}[b];[1:v]format=rgba,fade=t=in:st=0.2:d=0.3:alpha=1[o];[b][o]overlay=0:0:format=auto,format=yuv420p[v]`;
  return ff(ffmpeg, ['-i', clipPath, '-loop', '1', '-t', s, '-i', captionPng, '-filter_complex', fc, '-map', '[v]', '-t', s, ...ENC, outPath]);
}

/** Joins the segments in order with each scene's chosen transition. segs: [{ path, seconds, transition }]. */
export async function stitchSegments({ ffmpeg, segs, outPath }) {
  if (segs.length === 1) {
    await ff(ffmpeg, ['-i', segs[0].path, '-c', 'copy', '-movflags', '+faststart', outPath]);
    return segs[0].seconds;
  }
  const T = segs.map((s, i) => {
    if (i === 0) return 0;
    const base = s.transition === 'cut' ? CUT_SECONDS : TRANSITION_SECONDS;
    return Math.min(base, segs[i - 1].seconds / 2, s.seconds / 2);
  });
  const inputs = segs.flatMap((s) => ['-i', s.path]);
  let filters = '';
  let prev = '0:v';
  let length = segs[0].seconds;
  for (let i = 1; i < segs.length; i += 1) {
    const offset = Math.max(0, length - T[i]);
    const out = i === segs.length - 1 ? 'vout' : `v${i}`;
    filters += `[${prev}][${i}:v]xfade=transition=${XFADE[segs[i].transition] || 'fade'}:duration=${T[i].toFixed(3)}:offset=${offset.toFixed(3)}[${out}];`;
    prev = out;
    length = length + segs[i].seconds - T[i];
  }
  await ff(ffmpeg, [...inputs, '-filter_complex', filters.replace(/;$/, ''), '-map', '[vout]', ...ENC, '-movflags', '+faststart', outPath]);
  return length;
}

/** Last frame of a clip as a JPEG: the starting frame of the next scene when "keep scenes flowing" is on. */
export async function extractLastFrame({ ffmpeg, clipPath, outPath }) {
  await ff(ffmpeg, ['-sseof', '-0.2', '-i', clipPath, '-frames:v', '1', '-update', '1', '-q:v', '2', outPath]);
  return fs.existsSync(outPath);
}

export async function probeDuration(ffmpeg, p) {
  let err = '';
  try { await run(ffmpeg, ['-hide_banner', '-i', p], { timeout: 15000 }); } catch (e) { err = String(e.stderr || ''); }
  const m = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(err);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
