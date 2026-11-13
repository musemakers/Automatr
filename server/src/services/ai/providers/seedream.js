import OpenAI from 'openai';
import fs from 'node:fs';

// Seedream is ByteDance's image model, served officially through BytePlus
// ModelArk. ModelArk exposes an OpenAI-compatible /images/generate endpoint,
// so we reuse the same `openai` SDK already installed for the openai.js
// provider - just pointed at Ark's base URL with an Ark API key instead.
let client = null;
function getClient() {
  if (!process.env.SEEDREAM_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.SEEDREAM_API_KEY,
      baseURL: process.env.SEEDREAM_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3'
    });
  }
  return client;
}

export const name = 'seedream';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function imageModelName() {
  return process.env.SEEDREAM_IMAGE_MODEL || 'seedream-4-5-251128';
}


export function isConfigured() {
  return Boolean(process.env.SEEDREAM_API_KEY);
}

// Seedream/Ark has no text-completion or vision endpoint in this router -
// it's image-generation only. These throw clearly rather than being left
// undefined, so an explicit model:'seedream' request for text/vision fails
// with a readable message instead of a "not a function" crash.
export async function generateText() {
  throw new Error('Seedream does not support text generation - use gpt, claude, or gemini instead.');
}

export async function analyzeImage() {
  throw new Error('Seedream does not support image analysis - use gpt, claude, or gemini instead.');
}

/**
 * Maps our common size hints (used by the OpenAI provider, e.g. "1024x1536")
 * to what Ark expects. Ark accepts exact WxH pixel strings or the semantic
 * "1K" / "2K" / "4K" / "adaptive" - exact pixel strings pass through as-is,
 * EXCEPT that Seedream 4.5/5.0 Lite reject anything under ~3.68 megapixels
 * (e.g. 1920x1920) and cap out at ~16.78 megapixels (4096x4096). Our format
 * sizes (built for OpenAI's much smaller enum, e.g. "1024x1536" ≈ 1.57MP)
 * fall well under that floor, so we scale WxH strings up to the minimum -
 * keeping the exact aspect ratio - before handing them to Ark, rather than
 * letting the request 400 or silently forcing everything to a fixed square.
 */
const SEEDREAM_MIN_PIXELS = 3_686_400; // ~3.68MP, Ark's documented floor for 4.5/5.0 Lite
const SEEDREAM_MAX_DIMENSION = 4096;   // Ark's per-side cap (16.78MP max)

function resolveSize(size) {
  if (!size || size === 'auto') return process.env.SEEDREAM_IMAGE_SIZE || '2K';

  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return size; // semantic preset ("1K"/"2K"/"4K"/"adaptive") - pass through

  let [, w, h] = match.map(Number);
  const pixels = w * h;

  if (pixels < SEEDREAM_MIN_PIXELS) {
    // Math.ceil (not round) - rounding can land 1px short of the floor
    // (e.g. 1024x1280 -> 1717x2147 = 3,686,399), which Ark rejects.
    const scale = Math.sqrt(SEEDREAM_MIN_PIXELS / pixels);
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
  }

  // Clamp to Ark's per-side max without distorting the aspect ratio.
  const longSide = Math.max(w, h);
  if (longSide > SEEDREAM_MAX_DIMENSION) {
    const scale = SEEDREAM_MAX_DIMENSION / longSide;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  // Final guard: nudge up if clamping/rounding still left us under the floor.
  while (w * h < SEEDREAM_MIN_PIXELS && Math.max(w, h) < SEEDREAM_MAX_DIMENSION) {
    if (w <= h) w += 1; else h += 1;
  }

  return `${w}x${h}`;
}

/**
 * @param {{prompt: string, size?: string, referenceImages?: Array<{filePath: string, mimeType: string}>}} args
 * @returns {Promise<{ b64: string, mimeType: string }>}
 */
export async function generateImage({ prompt, size, referenceImages = [] }) {
  const seedream = getClient();
  if (!seedream) throw new Error('Seedream is not configured (missing SEEDREAM_API_KEY).');

  const model = imageModelName();

  const payload = {
    model,
    prompt,
    size: resolveSize(size),
    response_format: 'b64_json',
    watermark: false
  };

  // `sequential_image_generation` (batch/group mode) is only accepted by the
  // Seedream 4.x models; 5.x rejects it with a 400. Send it only for 4.x -
  // the default there is already a single image, so nothing is lost by
  // omitting it elsewhere.
  if (/seedream-4/i.test(model)) payload.sequential_image_generation = 'disabled';

  // Seedream's edit/multi-reference mode takes reference images as an
  // `image` array of data URIs (or hosted URLs) rather than multipart file
  // uploads - up to 10 references, used the same way the openai.js provider
  // uses images.edit() to ground a generation in real brand assets.
  if (referenceImages.length > 0) {
    payload.image = referenceImages.map(
      (img) => `data:${img.mimeType};base64,${fs.readFileSync(img.filePath).toString('base64')}`
    );
  }

  let response;
  try {
    response = await seedream.images.generate(payload);
  } catch (err) {
    // Safety net for any other model that turns out not to support the
    // parameter: retry once without it instead of failing the whole image.
    if (payload.sequential_image_generation && /sequential_image_generation/.test(err?.message || '')) {
      delete payload.sequential_image_generation;
      response = await seedream.images.generate(payload);
    } else {
      throw err;
    }
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('Seedream image generation returned no data.');

  return { b64, mimeType: 'image/png' };
}
