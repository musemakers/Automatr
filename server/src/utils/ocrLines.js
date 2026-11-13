import path from 'path';
import { createRequire } from 'module';
import sharp from 'sharp';

// Optional OCR (tesseract.js - pure JS/WASM, no native binary). Used by
// boxSnap.js to find text elements at their exact pixel position. If the
// package isn't installed or OCR fails, returns null and callers fall back
// to pixel-only snapping, so this can never block template analysis.
//   npm install tesseract.js @tesseract.js-data/eng   (in server/)

const OCR_SIDE = 1800;
const TIMEOUT_MS = 25000;
const IDLE_MS = 60000;

let workerPromise = null;
let idleTimer = null;

async function createWorker() {
  const { createWorker: make, PSM } = await import('tesseract.js');
  let langPath;
  try {
    const require = createRequire(import.meta.url);
    langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  } catch {
    langPath = undefined; // falls back to tesseract.js's default (downloads language data on first use)
  }
  const worker = await make('eng', 1, langPath ? { langPath, gzip: true } : {});
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  return worker;
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const p = workerPromise;
    workerPromise = null;
    try { (await p)?.terminate(); } catch { /* ignore */ }
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function recognize(worker, data, info, map) {
  const result = await Promise.race([
    worker.recognize(data, {}, { blocks: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('OCR timed out')), TIMEOUT_MS))
  ]);
  const out = [];
  for (const b of result.data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const nb = [l.bbox.x0 / info.width, l.bbox.y0 / info.height, l.bbox.x1 / info.width, l.bbox.y1 / info.height];
        out.push({ text: l.text, conf: l.confidence, ...map(nb) });
      }
    }
  }
  return out;
}

/**
 * @param {Buffer} buffer
 * @param {{ vertical?: boolean }} opts vertical: also read sideways text (two extra passes, ~2x slower)
 * @returns {Promise<Array<{text:string, conf:number, box:[number,number,number,number], vertical?:boolean}>|null>}
 *   lines with normalized [x0,y0,x1,y1] boxes in the upright image's coordinates
 */
export async function getOcrLines(buffer, { vertical = false } = {}) {
  try {
    workerPromise ||= createWorker();
    const worker = await workerPromise;
    const upright = sharp(buffer).rotate().resize({ width: OCR_SIDE, height: OCR_SIDE, fit: 'inside' });
    const { data, info } = await upright.png().toBuffer({ resolveWithObject: true });
    const out = await recognize(worker, data, info, (b) => ({ box: b }));
    if (vertical) {
      // text reading top-to-bottom (rotate 90 CW to read it) and bottom-to-top (rotate 90 CCW)
      for (const angle of [90, 270]) {
        const rot = await sharp(data).rotate(angle).png().toBuffer({ resolveWithObject: true });
        const mapBack = angle === 90
          ? (b) => ({ box: [b[1], 1 - b[2], b[3], 1 - b[0]], vertical: true })
          : (b) => ({ box: [1 - b[3], b[0], 1 - b[1], b[2]], vertical: true });
        out.push(...(await recognize(worker, rot.data, rot.info, mapBack)));
      }
    }
    scheduleIdleStop();
    return out;
  } catch (err) {
    console.warn('[template-analysis] OCR unavailable:', err.message);
    workerPromise = null;
    return null;
  }
}

/**
 * Zoomed OCR of one region of the creative. Tiny print (a one-line disclaimer, a sideways
 * legal line) is unreadable at whole-image resolution, so crop it from the full-resolution
 * original, enlarge it and read it - optionally also rotated 90 degrees each way for sideways text.
 * @param {Buffer} buffer
 * @param {[number,number,number,number]} box normalized [x, y, w, h] around the text (generously padded by this function)
 * @param {{ angles?: number[] }} opts angles: 0 = as is, 90 / 270 = sideways text
 */
export async function getOcrRegionLines(buffer, box, { angles = [0] } = {}) {
  try {
    workerPromise ||= createWorker();
    const worker = await workerPromise;
    const oriented = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
    const W = oriented.info.width, H = oriented.info.height;
    const padX = box[2] * 0.4 + 0.02, padY = box[3] * 0.4 + 0.02;
    const cx0 = Math.max(0, box[0] - padX), cy0 = Math.max(0, box[1] - padY);
    const cx1 = Math.min(1, box[0] + box[2] + padX), cy1 = Math.min(1, box[1] + box[3] + padY);
    const left = Math.round(cx0 * W), top = Math.round(cy0 * H);
    const width = Math.max(8, Math.round((cx1 - cx0) * W)), height = Math.max(8, Math.round((cy1 - cy0) * H));
    const crop = await sharp(oriented.data).extract({ left, top, width: Math.min(width, W - left), height: Math.min(height, H - top) }).toBuffer();
    const out = [];
    for (const angle of angles) {
      let img = sharp(crop);
      if (angle) img = img.rotate(angle);
      const raw = await img.png().toBuffer({ resolveWithObject: true });
      const scale = Math.min(4, Math.max(1, 1800 / Math.max(raw.info.width, raw.info.height)));
      const big = await sharp(raw.data).resize({ width: Math.round(raw.info.width * scale), height: Math.round(raw.info.height * scale), kernel: 'lanczos3' }).png().toBuffer({ resolveWithObject: true });
      const back = angle === 90 ? (b) => [b[1], 1 - b[2], b[3], 1 - b[0]] : angle === 270 ? (b) => [1 - b[3], b[0], 1 - b[1], b[2]] : (b) => b;
      const lines = await recognize(worker, big.data, big.info, (b) => ({ box: back(b) }));
      for (const l of lines) {
        const [x0, y0, x1, y1] = l.box;
        out.push({
          text: l.text, conf: l.conf, vertical: angle !== 0,
          box: [cx0 + x0 * (cx1 - cx0), cy0 + y0 * (cy1 - cy0), cx0 + x1 * (cx1 - cx0), cy0 + y1 * (cy1 - cy0)]
        });
      }
    }
    scheduleIdleStop();
    return out;
  } catch (err) {
    console.warn('[template-analysis] region OCR failed:', err.message);
    return [];
  }
}
