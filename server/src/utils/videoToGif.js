import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findFfmpeg } from './fitVideoToSize.js';

const run = promisify(execFile);

const FPS = 10;
const MAX_WIDTH = 480; // never upscaled
const MAX_SECONDS = 12; // GIFs get huge fast, so long clips are trimmed
const MAX_PARALLEL = 2; // each conversion is CPU heavy

let active = 0;

export class GifBusyError extends Error {}
export class FfmpegMissingError extends Error {}

/**
 * Converts the video at `videoPath` into an animated GIF (one shared palette for the clip, looping).
 * Returns { gifPath, cleanup } - the caller sends the file, then calls cleanup() to remove the temp folder.
 */
export async function videoToGif(videoPath) {
  if (active >= MAX_PARALLEL) throw new GifBusyError('Busy making other GIFs. Please try again in a moment.');
  active += 1;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videogif-'));
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } };
  try {
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new FfmpegMissingError('GIF conversion is not available on this server (ffmpeg missing).');
    const gifPath = path.join(tmpDir, 'out.gif');
    const filter = `fps=${FPS},scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    await run(ffmpeg, ['-v', 'error', '-y', '-t', String(MAX_SECONDS), '-i', videoPath, '-an', '-vf', filter, '-loop', '0', gifPath], { timeout: 120000 });
    return { gifPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    active -= 1;
  }
}
