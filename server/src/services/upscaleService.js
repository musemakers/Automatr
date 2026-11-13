import fs from 'node:fs/promises';
import sharp from 'sharp';
import { logUsageSafely } from './aiUsageLogService.js';
import { aiLog } from '../utils/aiLog.js';

// Scales a finished creative up to a large print size.
// 1. A faithful super-resolution model (Real-ESRGAN class, not a generative "creative" upscaler, so packaging, logos and
//    lettering are sharpened rather than re-imagined) when UPSCALE_API is set up.
// 2. Otherwise - or if that call fails - a high-quality Lanczos resample with gentle sharpening, done locally.
// Either way the result is resampled to the exact pixel size asked for.
//   REPLICATE_API_TOKEN            enables the super-resolution step
//   UPSCALE_MODEL                  default nightmareai/real-esrgan
//   UPSCALE_PROVIDER               'off' forces the local resample

const API = 'https://api.replicate.com/v1';
const MODEL = () => process.env.UPSCALE_MODEL || 'nightmareai/real-esrgan';
let versionCache = null;

export const aiUpscaleConfigured = () => Boolean(process.env.REPLICATE_API_TOKEN) && String(process.env.UPSCALE_PROVIDER || '').toLowerCase() !== 'off';

const authHeaders = () => ({ Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestVersion() {
  if (versionCache?.model === MODEL()) return versionCache.id;
  const res = await fetch(`${API}/models/${MODEL()}`, { headers: authHeaders(), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`model lookup failed (${res.status})`);
  const id = (await res.json())?.latest_version?.id;
  if (!id) throw new Error('model has no published version');
  versionCache = { model: MODEL(), id };
  return id;
}

/** One super-resolution pass. Returns a PNG/JPEG buffer `scale` times larger than the input. */
async function aiPass(inputBuffer, scale) {
  const version = await latestVersion();
  const dataUri = `data:image/png;base64,${inputBuffer.toString('base64')}`;
  const res = await fetch(`${API}/predictions`, {
    method: 'POST',
    headers: { ...authHeaders(), Prefer: 'wait=60' },
    body: JSON.stringify({ version, input: { image: dataUri, scale, face_enhance: false } }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new Error(`upscale request failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  let pred = await res.json();
  const deadline = Date.now() + 8 * 60 * 1000;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > deadline) throw new Error('upscale timed out');
    await sleep(3000);
    const poll = await fetch(pred.urls.get, { headers: authHeaders(), signal: AbortSignal.timeout(30000) });
    if (!poll.ok) throw new Error(`upscale poll failed (${poll.status})`);
    pred = await poll.json();
  }
  if (pred.status !== 'succeeded') throw new Error(`upscale ${pred.status}: ${String(pred.error || '').slice(0, 200)}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error('upscale returned nothing');
  const img = await fetch(out, { signal: AbortSignal.timeout(180000) });
  if (!img.ok) throw new Error(`could not download the upscaled image (${img.status})`);
  return Buffer.from(await img.arrayBuffer());
}

const sharpenFor = (factor) => ({ sigma: factor > 3 ? 1.4 : factor > 1.6 ? 1.0 : 0.7, m1: 0.6, m2: 1.6 });

/**
 * @param {Buffer} input  the creative, already fitted to the target shape
 * @returns {Promise<{ buffer: Buffer, method: 'enhanced' | 'resampled', note: string }>} an sRGB PNG at exactly targetW x targetH
 */
export async function upscaleTo(input, targetW, targetH, usageContext) {
  const meta = await sharp(input).metadata();
  const need = targetW / (meta.width || targetW);
  let method = 'resampled';
  let note = '';
  let base = input;

  if (need > 1.25 && aiUpscaleConfigured()) {
    try {
      const scale = need > 2 ? 4 : 2;
      const t0 = Date.now();
      base = await aiPass(await sharp(input).png().toBuffer(), scale);
      method = 'enhanced';
      aiLog('image', 'done', { provider: 'upscaler', msg: `super-resolution x${scale} done`, ms: Date.now() - t0 });
      await logUsageSafely(usageContext, { type: 'image', provider: 'replicate', purpose: 'billboard upscale', estimatedCostUsd: 0.01 });
    } catch (err) {
      aiLog('image', 'fail', { provider: 'upscaler', msg: `super-resolution failed, using the local resample: ${err.message}` });
      note = 'Smart upscaling was unavailable for this file, so a high-quality resize was used instead.';
      base = input;
    }
  } else if (need > 1.25) {
    note = 'Smart upscaling is not switched on for this workspace, so a high-quality resize was used.';
  }

  const bm = await sharp(base).metadata();
  const factor = targetW / (bm.width || targetW);
  let pipe = sharp(base, { limitInputPixels: false }).resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' });
  if (factor > 1.05) pipe = pipe.sharpen(sharpenFor(factor));
  const buffer = await pipe.png({ compressionLevel: 3 }).toBuffer();
  return { buffer, method, note };
}

export async function readFileBuffer(p) { return fs.readFile(p); }
