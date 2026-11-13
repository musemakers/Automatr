import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { getOcrLines } from './ocrLines.js';

const run = promisify(execFile);

// Image-to-video models cannot hold lettering steady: headings and labels fade
// out and come back as garbled glyphs. After the video is saved this takes the
// text as rendered in frame 0 (before it drifts), checks its wording against the
// approved still, and holds it over every frame in a soft-edged patch.
//
// Needs an ffmpeg binary (the optional `ffmpeg-static` package, FFMPEG_PATH, or
// ffmpeg on PATH) and tesseract.js. If either is missing, or the checks below
// fail, the original video is left untouched.

const MIN_CONF = 80;
const MIN_LETTERS = 4;
const MIN_HEIGHT = 0.014; // line height as a share of image height (skips pack/label micro-text)
const AN_W = 240; // analysis width
const MIN_WORD_MATCH = 0.75; // frame-0 text must read like a line of the approved image
const MAX_RING_MAD = 26; // background around the text moved too much (camera move) -> skip

let ffmpegPathPromise = null;
async function findFfmpeg() {
  ffmpegPathPromise ||= (async () => {
    const candidates = [];
    if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
    try { candidates.push((await import('ffmpeg-static')).default); } catch { /* optional */ }
    candidates.push('ffmpeg');
    for (const c of candidates) {
      if (!c) continue;
      try { await run(c, ['-version'], { timeout: 10000 }); return c; } catch { /* try next */ }
    }
    return null;
  })();
  return ffmpegPathPromise;
}

async function probe(ffmpeg, videoPath) {
  let err = '';
  try { await run(ffmpeg, ['-hide_banner', '-i', videoPath], { timeout: 15000 }); } catch (e) { err = String(e.stderr || ''); }
  const dim = /Stream #.*Video:.*?, (\d{2,5})x(\d{2,5})[ ,\[]/.exec(err);
  const dur = /Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(err);
  if (!dim) return null;
  return { width: Number(dim[1]), height: Number(dim[2]), duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0 };
}

async function frameAt(ffmpeg, videoPath, t) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000
  });
  return stdout;
}

const letters = (t) => String(t || '').toLowerCase().replace(/[^a-z]/g, '');
function similarity(a, b) {
  if (!a || !b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}
const grey = async (buf, w, h) => (await sharp(buf).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer());
const mad = (a, b, mask) => {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (!mask || mask[i]) { s += Math.abs(a[i] - b[i]); n++; }
  return n ? s / n : 0;
};

/**
 * @param {{videoPath: string, stillPath: string}} args  absolute file paths
 * @returns {Promise<{applied: boolean, reason?: string, lines?: number}>}
 */
export async function lockVideoText({ videoPath, stillPath }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'textlock-'));
  try {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) return { applied: false, reason: 'ffmpeg not available' };
    const info = await probe(ffmpeg, videoPath);
    if (!info) return { applied: false, reason: 'could not read video size' };
    const { width: VW, height: VH } = info;

    // The video model usually re-frames the still (different crop/scale, label added, fonts
    // redrawn), so pasting the still's pixels would not line up. Frame 0 of the video is the
    // model's own, clean rendering of the same text before it starts to drift - so that is
    // what gets locked. The approved still is only used to check the WORDING is right.
    const f0 = await frameAt(ffmpeg, videoPath, 0);
    const base = await sharp(f0).removeAlpha().png().toBuffer();
    const frameLines = (await getOcrLines(base)) || [];
    const stillLines = (await getOcrLines(fs.readFileSync(stillPath))) || [];
    const stillWords = stillLines.filter((l) => l.conf >= 50).map((l) => letters(l.text)).filter((t) => t.length >= MIN_LETTERS);
    const keep = frameLines.filter((l) => {
      const [x0, y0, x1, y1] = l.box;
      const bw = (x1 - x0) * VW, bh = (y1 - y0) * VH;
      const t = letters(l.text);
      return !l.vertical && l.conf >= MIN_CONF && t.length >= MIN_LETTERS && bh >= MIN_HEIGHT * VH && bw > bh * 1.2 && stillWords.some((w) => similarity(t, w) >= MIN_WORD_MATCH);
    });
    if (!keep.length) return { applied: false, reason: 'no text in frame 0 that matches the approved image' };
    const boxes = keep.map((l) => [l.box[0] * VW, l.box[1] * VH, l.box[2] * VW, l.box[3] * VH]);

    // Patch mask at video size, and a ring mask (patch minus the text itself) at analysis size.
    const AH = Math.round((AN_W * VH) / VW);
    const mask = Buffer.alloc(VW * VH);
    const ring = new Uint8Array(AN_W * AH);
    const k = AN_W / VW;
    for (const [x0, y0, x1, y1] of boxes) {
      const h = y1 - y0, px = Math.round(h * 0.35), py = Math.round(h * 0.45);
      const ax0 = Math.max(0, Math.floor(x0 - px)), ay0 = Math.max(0, Math.floor(y0 - py)), ax1 = Math.min(VW, Math.ceil(x1 + px)), ay1 = Math.min(VH, Math.ceil(y1 + py));
      for (let y = ay0; y < ay1; y++) mask.fill(255, y * VW + ax0, y * VW + ax1);
      const rpx = Math.round(h * 0.9 * k), rpy = Math.round(h * 0.9 * k);
      for (let y = Math.max(0, Math.floor(y0 * k) - rpy); y < Math.min(AH, Math.ceil(y1 * k) + rpy); y++) {
        for (let x = Math.max(0, Math.floor(x0 * k) - rpx); x < Math.min(AN_W, Math.ceil(x1 * k) + rpx); x++) {
          const inside = x >= x0 * k && x <= x1 * k && y >= y0 * k && y <= y1 * k;
          if (!inside) ring[y * AN_W + x] = 1;
        }
      }
    }

    // If the background around the text moves a lot (camera push/pan), a fixed patch would show. Skip then.
    const gStill = await grey(base, AN_W, AH);
    const times = info.duration > 1 ? [info.duration * 0.33, info.duration * 0.66, info.duration * 0.95] : [];
    for (const t of times) {
      const g = await grey(await frameAt(ffmpeg, videoPath, t), AN_W, AH);
      const d = mad(gStill, g, ring);
      if (d > MAX_RING_MAD) return { applied: false, reason: `background around the text moves (diff ${d.toFixed(0)}) - camera move` };
    }

    const feather = Math.max(2, Math.round(Math.min(VW, VH) * 0.006));
    const alpha = await sharp(mask, { raw: { width: VW, height: VH, channels: 1 } }).blur(feather).extractChannel(0).raw().toBuffer();
    const rgb = await sharp(base).removeAlpha().raw().toBuffer();
    const rgba = Buffer.alloc(VW * VH * 4);
    for (let i = 0; i < VW * VH; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
    const overlayPath = path.join(tmpDir, 'overlay.png');
    await sharp(rgba, { raw: { width: VW, height: VH, channels: 4 } }).png().toFile(overlayPath);

    const outPath = path.join(tmpDir, 'locked.mp4');
    await run(ffmpeg, [
      '-v', 'error', '-y', '-i', videoPath, '-i', overlayPath,
      '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[v]',
      '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outPath
    ], { timeout: 180000 });

    fs.copyFileSync(outPath, videoPath);
    return { applied: true, lines: boxes.length };
  } catch (err) {
    return { applied: false, reason: err.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
