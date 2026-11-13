import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The video models only make a few shapes (16:9, 9:16, 1:1). "Convert to Video" lets the person pick any size,
// so the finished clip is centre-cropped and scaled to that exact shape afterwards.
export const VIDEO_ASPECTS = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '1:1', ratio: 1 }
];
export const VIDEO_SIZE_MIN = 16;
export const VIDEO_SIZE_MAX = 8000;
const LONG_EDGE_MAX = 1920; // clips are never rendered larger than this on the long edge

/** Sanitises a { w, h } request; returns null when it is missing or out of range. */
export function cleanVideoSize(raw) {
  const w = Math.round(Number(raw?.w ?? raw?.width));
  const h = Math.round(Number(raw?.h ?? raw?.height));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < VIDEO_SIZE_MIN || h < VIDEO_SIZE_MIN || w > VIDEO_SIZE_MAX || h > VIDEO_SIZE_MAX) return null;
  return { w, h };
}

/** The model aspect ratio closest to w:h (on a log scale, so 2:1 is as far from 1:1 as 1:2). */
export function nearestVideoAspect(w, h) {
  const r = Math.log(w / h);
  return VIDEO_ASPECTS.reduce((best, a) => (Math.abs(Math.log(a.ratio) - r) < Math.abs(Math.log(best.ratio) - r) ? a : best)).label;
}

/** The pixel size the clip is rendered at: the requested shape, long edge capped, both sides even. */
export function outputVideoSize({ w, h }) {
  const k = Math.min(1, LONG_EDGE_MAX / Math.max(w, h));
  const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(w), h: even(h) };
}

let ffmpegPathPromise = null;
export async function findFfmpeg() {
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

/**
 * Re-encodes the video at `videoPath` in place so it is exactly the requested shape (centre crop, then scale).
 * Best-effort: when ffmpeg is missing or fails the original clip is kept and { applied: false, reason } is returned.
 */
export async function fitVideoToSize(videoPath, size) {
  const target = outputVideoSize(size);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitvideo-'));
  try {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) return { applied: false, reason: 'ffmpeg not available' };
    const out = path.join(tmpDir, 'fit.mp4');
    const { w, h } = target;
    await run(ffmpeg, [
      '-v', 'error', '-y', '-i', videoPath,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
      '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out
    ], { timeout: 180000 });
    fs.copyFileSync(out, videoPath);
    return { applied: true, ...target };
  } catch (err) {
    return { applied: false, reason: err.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
