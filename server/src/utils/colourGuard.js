import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

// Detects a black-and-white / greyscale result. Used by router.generateImage (every image),
// refineImageRegion (masked edits) and the multi-scene reel (every generated clip).
//
// A pixel is "coloured" when its channels differ by at least SPREAD (tolerates JPEG noise and
// the faint tint of a "neutral" photo). An image is monochrome when almost none of its pixels
// are coloured. Deliberately NOT a hue/tint test: a dark portrait lit warm legitimately has
// concentrated hues and must never be flagged.
const SIZE = 128;
const SPREAD = 14; // max(r,g,b) - min(r,g,b), 0-255
const MONO_SHARE = 0.012; // < 1.2% coloured pixels => monochrome

export async function colourShare(input) {
  const buf = typeof input === 'string' && fs.existsSync(input) ? fs.readFileSync(input) : Buffer.isBuffer(input) ? input : Buffer.from(input, 'base64');
  const { data, info } = await sharp(buf)
    .rotate()
    .resize({ width: SIZE, height: SIZE, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let coloured = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const r = data[i * ch], g = data[i * ch + 1], b = data[i * ch + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) >= SPREAD) coloured++;
  }
  return coloured / n;
}

export async function isMonochrome(input) {
  return (await colourShare(input)) < MONO_SHARE;
}

/**
 * True when a GENERATED image is black-and-white even though it should be in colour.
 * Exempt when the person supplied reference images and every one of them is itself achromatic
 * (a genuinely black-and-white source can't be expected to come back in colour). With no
 * references - or any coloured reference - greyscale output is rejected.
 * @param {string|Buffer} output  base64 / buffer / file path of the generated image
 * @param {Array<{filePath?: string}>} referenceImages
 */
export async function isMonochromeOutput(output, referenceImages = []) {
  if (!(await isMonochrome(output))) return false;
  const refs = (referenceImages || []).filter((r) => r?.role !== 'font-specimen').map((r) => r?.filePath).filter((p) => p && fs.existsSync(p));
  if (refs.length > 0) {
    let allAchromatic = true;
    for (const p of refs) {
      try { if (!(await isMonochrome(p))) { allAchromatic = false; break; } } catch { allAchromatic = false; break; }
    }
    if (allAchromatic) return false;
  }
  return true;
}

/** True when a generated video's frame (taken ~0.6s in) is black-and-white. Returns false if it cannot be checked. */
export async function isVideoMonochrome(ffmpeg, videoPath) {
  if (!ffmpeg) return false;
  try {
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', '0.6', '-i', videoPath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], {
      encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000
    });
    return stdout?.length ? await isMonochrome(stdout) : false;
  } catch {
    return false;
  }
}
