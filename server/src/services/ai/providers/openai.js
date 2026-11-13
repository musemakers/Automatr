import OpenAI, { toFile } from 'openai';
import { ruleText } from '../../blanketRulesService.js';
import fs from 'node:fs';

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const name = 'openai';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
/** Model used for image analysis (animation ideas, reference/brand analysis...). Set OPENAI_VISION_MODEL to pin a separate
 *  vision model; when unset it follows the text model, so nothing changes until you set it. */
export function visionModelName() {
  return process.env.OPENAI_VISION_MODEL || textModelName();
}

export function textModelName() {
  return process.env.OPENAI_TEXT_MODEL || 'gpt-4.1';
}

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function imageModelName() {
  return process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare';
}


export function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Chat Completions' image_url content type only accepts rasterized images,
// not PDFs - PDF support would need the separate Files/Assistants API, so
// it's out of scope here. The router skips this provider for PDF analysis.
export const ANALYZABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/**
 * @param {{system?: string, prompt: string, maxTokens?: number}} args
 * @returns {Promise<string>}
 */
export async function generateText({ system, prompt, maxTokens = 400 }) {
  const openai = getClient();
  if (!openai) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY).');

  const model = textModelName();
  const response = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt }
    ]
  });

  return response.choices?.[0]?.message?.content?.trim() || '';
}

// gpt-image-2 and later (including 2.5-sunburst/2.5-flare) accept arbitrary
// WIDTHxHEIGHT strings - gpt-image-1/1.5/1-mini only accept the old fixed
// three-size enum. If OPENAI_IMAGE_MODEL is ever pointed back at a legacy
// model, this stops postFormats.js's now-accurate-ratio sizes (e.g.
// "1024x1280") from turning into a hard 400 - it snaps to whichever legacy
// size is the closest orientation match instead.
function resolveSizeForModel(model, size) {
  if (/^gpt-image-2/.test(model)) return size; // arbitrary sizes supported
  const match = /^(\d+)x(\d+)$/i.exec(String(size).trim());
  if (!match) return size; // 'auto' or already a legacy-safe value
  const [, w, h] = match.map(Number);
  if (w === h) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}

/** Pulls the token usage block OpenAI returns on image calls into a flat shape (null if the API sent none). */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  if (!inputTokens && !outputTokens) return null;
  const d = usage.input_tokens_details || {};
  return { inputTokens, outputTokens, textInputTokens: Number(d.text_tokens) || 0, imageInputTokens: Number(d.image_tokens) || 0 };
}

/**
 * @param {{prompt: string, size?: string}} args
 * @returns {Promise<{ b64: string, mimeType: string, usage: ({inputTokens:number, outputTokens:number, textInputTokens:number, imageInputTokens:number}|null) }>}
 */
export async function generateImage({ prompt, size = '1024x1536', quality = 'high', referenceImages = [], inputFidelity }) {
  const openai = getClient();
  if (!openai) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY).');

  const model = imageModelName();
  const resolvedSize = resolveSizeForModel(model, size);
  // Anatomy instruction (hands, arms, legs, feet) - editable under Admin -> AI Settings -> Blanket instructions.
  const anatomy = ruleText('imageAnatomy');
  if (anatomy) prompt = `${prompt} ${anatomy}`;

  let response;
  if (referenceImages.length > 0) {
    // Reference images ground the generation in what the brand's actual
    // product/logo/asset looks like, rather than the model inventing a
    // plausible-but-wrong stand-in from text alone.
    const files = await Promise.all(
      referenceImages.map((img) => toFile(fs.createReadStream(img.filePath), img.filename || 'reference.png', { type: img.mimeType }))
    );
    const editArgs = { model, image: files, prompt, size: resolvedSize, quality, n: 1 };
    try {
      // inputFidelity 'high' makes the edit keep the source image's details (faces, labels, layout) much more faithfully.
      response = await openai.images.edit(inputFidelity ? { ...editArgs, input_fidelity: inputFidelity } : editArgs);
    } catch (err) {
      if (inputFidelity && /input_fidelity|unknown parameter|unrecognized/i.test(String(err?.message))) {
        response = await openai.images.edit(editArgs); // this model doesn't take the option
      } else {
        throw err;
      }
    }
  } else {
    response = await openai.images.generate({
      model,
      prompt,
      size: resolvedSize,
      quality, // gpt-image-1: 'low' | 'medium' | 'high' | 'auto' - defaults to 'high' here for better creative output
      n: 1
    });
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image generation returned no data.');

  return { b64, mimeType: 'image/png', usage: normalizeUsage(response.usage) };
}

/**
 * Masked edit ("inpainting") - unlike generateImage's images.edit branch
 * (which uses reference images to ground a whole new composition), this
 * targets ONE existing image and a mask, and asks the model to change only
 * the masked pixels. Per OpenAI's contract, transparent areas of `mask`
 * are what gets regenerated; opaque areas are preserved untouched - see
 * buildOpenAiMask in designService.js for how our mask convention (painted
 * = editable) gets inverted to match that.
 * @param {{imagePath: string, maskBuffer: Buffer, prompt: string, size?: string}} args
 * @returns {Promise<{ b64: string, mimeType: string }>}
 */
export async function editImageWithMask({ imagePath, maskBuffer, prompt, size = '1024x1536' }) {
  const openai = getClient();
  if (!openai) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY).');

  const model = imageModelName();
  const resolvedSize = resolveSizeForModel(model, size);

  const imageFile = await toFile(fs.createReadStream(imagePath), 'image.png', { type: 'image/png' });
  const maskFile = await toFile(maskBuffer, 'mask.png', { type: 'image/png' });

  const response = await openai.images.edit({
    model,
    image: imageFile,
    mask: maskFile,
    prompt,
    size: resolvedSize,
    n: 1
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI masked edit returned no data.');

  return { b64, mimeType: 'image/png', usage: normalizeUsage(response.usage) };
}

/**
 * Vision: asks GPT to look at an image and return a text response (the
 * caller prompts it to respond in JSON and handles parsing).
 * @param {{ base64: string, mimeType: string, instruction: string, maxTokens?: number }} args
 */
export async function analyzeImage({ base64, mimeType, instruction, maxTokens = 700, detail }) {
  const openai = getClient();
  if (!openai) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY).');

  const model = visionModelName();
  const response = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, ...(detail ? { detail } : {}) } }
        ]
      }
    ]
  });

  return response.choices?.[0]?.message?.content?.trim() || '';
}
