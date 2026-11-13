import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as router from './router.js';
import { findFfmpeg, probeDuration } from '../../utils/reelCompositor.js';

const run = promisify(execFile);

// Brief Studio: the super admin uploads a REFERENCE image or video; this turns it into a plain-English
// analysis that the spec designer (customFeatureService.designSpec) uses to build a form and prompt that
// recreate the same look with the customer's own inputs.
//   image -> one vision call
//   video -> four frames spread across the clip are tiled into one contact sheet, then one vision call
// Nothing from the reference is stored except the analysis text.

export const REFERENCE_MIMES = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/jpg': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video'
};

const INSTRUCTION = (kind, extra) => `You are studying a ${kind === 'video' ? 'video (four frames from it are tiled in time order, top-left to bottom-right)' : 'image'} that a creative director wants recreated for different products. ${extra}
Write a precise plain-English analysis someone could use to recreate it as closely as possible. Use these labelled sections, concrete and visual, no fluff:
SUBJECT & SCENE: what is shown, setting, background, props.
COMPOSITION & FRAMING: layout, subject position, crop, negative space, aspect ratio.
CAMERA: angle, distance, lens look, depth of field${kind === 'video' ? ', camera movement' : ''}.
LIGHTING: direction, softness, time of day, shadows, highlights.
COLOUR & GRADE: palette described in words (never hex codes), contrast, saturation, finish.
STYLE & MOOD: genre, polish, emotion, era.
PEOPLE: how many, rough age group, pose, expression, clothing style, hair and makeup look. Never identify anyone or guess who they are.
PRODUCT: say plainly either "NO PRODUCT SHOWN" or what product is shown (a pack, bottle, tube, device, garment), where, how large and how it is held or displayed. Product texture, swatches or makeup applied on skin are not a product pack: describe them under SUBJECT & SCENE and write "NO PRODUCT SHOWN" here.
PRODUCT-DRIVEN SCENE: say "YES" or "NO". Answer YES when a product pack is shown AND the props, background, surface or colour palette clearly come FROM that product - for example a lavender foot cream shown with lavender sprigs, dried buds and a blurred lavender field, or a lemon soap with lemons and leaves, or a coffee pack with beans. If YES, name what links them (the hero ingredient, fragrance, flavour, variant or pack colour), list the scene elements that depend on it (fresh ingredient in the foreground, dried or raw form scattered, a smear of the product's own texture, blurred plants behind, tinted light and background) and say which parts do NOT depend on it (camera, surface material, lighting, composition). Describe those ingredient-dependent elements by role ("the hero ingredient, fresh and dried") as well as by what is shown, because a different product will need a different ingredient.
TEXT & GRAPHICS: where any on-image text, logos, badges or overlays sit and what role they play. Do not transcribe brand names or slogans.
${kind === 'video' ? 'MOTION & TIMELINE: what changes over time, pacing, transitions, how it starts and ends.\n' : ''}CUSTOMER INPUTS: only what a customer would genuinely have to supply to recreate this (for example a product photo ONLY if a product pack is shown, an optional model photo if people appear, skin tone, shade, season, background choice). Do not list a product photo when no product is shown.
SUGGESTED OUTPUT: one image or one video, and the best aspect (square, portrait or landscape).`;

async function frameSheet(buffer, ext) {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error('Video analysis needs ffmpeg on the server, which is not available. Upload an image instead.');
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-'));
  try {
    const src = path.join(dir, `ref${ext || '.mp4'}`);
    fs.writeFileSync(src, buffer);
    const duration = await probeDuration(ffmpeg, src);
    const stamps = (duration > 0 ? [0.08, 0.33, 0.6, 0.88].map((p) => (duration * p).toFixed(2)) : ['0', '1', '2', '3']);
    const frames = [];
    for (let i = 0; i < stamps.length; i++) {
      const out = path.join(dir, `f${i}.jpg`);
      try {
        await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', stamps[i], '-i', src, '-frames:v', '1', '-q:v', '3', out], { timeout: 60000 });
        if (fs.existsSync(out) && fs.statSync(out).size > 500) frames.push(out);
      } catch { /* a frame that cannot be read is skipped */ }
    }
    if (!frames.length) throw new Error('Could not read any frames from that video. Try an mp4, or upload an image instead.');
    const first = await sharp(frames[0]).metadata();
    const W = (first.height || 0) > (first.width || 0) ? 420 : 640; // tall clips: narrower tiles keep the sheet readable after downscaling
    const tiles = await Promise.all(frames.map((f) => sharp(f).resize({ width: W }).jpeg({ quality: 82 }).toBuffer()));
    const meta = await Promise.all(tiles.map((t) => sharp(t).metadata()));
    const H = Math.max(...meta.map((m) => m.height || 0));
    const cols = tiles.length > 1 ? 2 : 1;
    const rows = Math.ceil(tiles.length / cols);
    const sheet = await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#000' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * H })))
      .jpeg({ quality: 85 }).toBuffer();
    return { sheet, duration, aspect: meta[0].width && meta[0].height ? (meta[0].width >= meta[0].height ? 'landscape' : 'portrait') : '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const LAYOUT_INSTRUCTION = `Find every run of text printed on this image (headline lines, highlighted words, list of points, offer, tagline, small captions). Ignore logos, brand wordmarks, watermarks and tiny legal print. Return ONLY JSON, no markdown:
{"blocks":[{"label":"short customer-facing name such as Headline, Highlighted line, Key points, Offer","kind":"text or list","example":"the text as shown; for a list put one item per line (use \\n); wrap words that are visibly bolder than the rest of the same line in **double asterisks**","box":[left,top,right,bottom],"align":"left|center|right","font":"serif or sans","weight":"regular or bold","size":font size as a percent of the image HEIGHT (cap height of a big headline is about 6 to 9, list text 3 to 4.5, small captions 1.5 to 2.5),"lineHeight":1.2,"color":"#RRGGBB of the text","uppercase":true or false,"bulletColor":"#RRGGBB of bullet dots, list only","divider":true if thin lines separate list items,"dividerColor":"#RRGGBB of those lines"}]}
Rules:
- box is in percent (0-100) of the image width and height and must TIGHTLY cover the text it describes (for a list: all its items, from the top of the first to the bottom of the last).
- One block per visually different style. A headline whose first line is regular white sans and whose second line is bold gold serif ALL CAPS is TWO blocks, each with its own box, font, weight, colour and uppercase flag.
- A list has ONE block with kind "list", one item per line, even when words inside items are bold (mark them with **). Serif means letters with small feet (like Times or Playfair); sans means plain strokes (like Arial or Poppins). Do not set a heavy weight unless the whole block is clearly bold.
- Return blocks top to bottom. If there is no text at all return {"blocks":[]}.`;

function jsonOf(text) {
  const t = String(text || '').replace(/```json|```/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** One layout attempt with a given vision model. */
async function layoutWith(jpeg, model) {
  const { text } = await router.analyzeImage({ purpose: 'locating text on a Brief Studio reference', model, base64: jpeg.toString('base64'), mimeType: 'image/jpeg', instruction: LAYOUT_INSTRUCTION, maxTokens: 2000, detail: 'high' });
  const parsed = jsonOf(text);
  return Array.isArray(parsed?.blocks) && parsed.blocks.length ? parsed.blocks.slice(0, 8) : null;
}

/**
 * Where text sits on an image reference and how it is styled. Gemini first (best at locating things in an
 * image); set AI_LAYOUT_MODEL=claude|gpt|auto to change that. Falls back to the normal vision order.
 * Never throws: null when it cannot be read.
 */
async function locateText(jpeg) {
  const preferred = String(process.env.AI_LAYOUT_MODEL || 'gemini').toLowerCase();
  for (const model of preferred === 'auto' ? ['auto'] : [preferred, 'auto']) {
    try {
      const blocks = await layoutWith(jpeg, model);
      if (blocks) return blocks;
    } catch { /* unknown or unavailable model: try the next one */ }
  }
  return null;
}

/**
 * @param {{buffer: Buffer, mimeType: string, filename?: string}} ref
 * @returns {Promise<{kind: 'image'|'video', analysis: string, layout: object[]|null, styleJpeg: Buffer|null}>}
 * layout (images only) = the printed text blocks; styleJpeg (images only) = a copy kept as a layout / style guide.
 * Throws an Error with a plain-English message when the reference cannot be understood.
 */
export async function analyzeReference({ buffer, mimeType, filename = '' }) {
  const kind = REFERENCE_MIMES[mimeType];
  if (!kind) throw new Error('The reference must be a PNG, JPG or WebP image, or an MP4, WebM or MOV video.');
  const sharp = (await import('sharp')).default;

  let jpeg;
  let extra = '';
  if (kind === 'video') {
    const { sheet, duration, aspect } = await frameSheet(buffer, path.extname(filename).toLowerCase());
    jpeg = sheet;
    extra = `The clip lasts about ${duration ? `${Math.round(duration)} seconds` : 'a few seconds'}${aspect ? ` and is ${aspect}` : ''}.`;
  } else {
    // Normalised: right size and a type every vision model accepts.
    jpeg = await sharp(buffer).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  }

  const { text, note } = await router.analyzeImage({
    purpose: 'studying a Brief Studio reference',
    model: 'auto',
    base64: jpeg.toString('base64'),
    mimeType: 'image/jpeg',
    instruction: INSTRUCTION(kind, extra),
    maxTokens: 1500,
    detail: 'high'
  });
  if (!text || !String(text).trim()) throw new Error(`The AI could not study the reference${note ? ` (${note})` : ''}. Check that an AI provider is set up and try again.`);
  const layout = kind === 'image' ? await locateText(jpeg) : null;
  const styleJpeg = kind === 'image' ? await sharp(jpeg).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer() : null;
  return { kind, analysis: String(text).trim().slice(0, 6000), layout, styleJpeg };
}
