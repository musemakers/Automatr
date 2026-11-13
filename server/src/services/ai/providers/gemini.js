import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'node:fs';

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

export const name = 'gemini';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
/** Model used for image analysis (animation ideas, reference/brand analysis...). Set GEMINI_VISION_MODEL to pin a separate
 *  vision model; when unset it follows the text model, so nothing changes until you set it. */
export function visionModelName() {
  return process.env.GEMINI_VISION_MODEL || textModelName();
}

export function textModelName() {
  return process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';
}

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function imageModelName() {
  return process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp';
}


export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Gemini accepts PDFs as inline data the same way it accepts images - same
// code path, no special-casing needed.
export const ANALYZABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf']);

/**
 * @param {{system?: string, prompt: string, maxTokens?: number}} args
 * @returns {Promise<string>}
 */
export async function generateText({ system, prompt, maxTokens = 400 }) {
  const genAI = getClient();
  if (!genAI) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

  const modelName = textModelName();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
    generationConfig: { maxOutputTokens: maxTokens }
  });

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * @param {{prompt: string}} args
 * @returns {Promise<{ b64: string, mimeType: string }>}
 */
export async function generateImage({ prompt, referenceImages = [] }) {
  const genAI = getClient();
  if (!genAI) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

  const modelName = imageModelName();
  const model = genAI.getGenerativeModel({ model: modelName });

  const imageParts = referenceImages.map((img) => ({
    inlineData: { data: fs.readFileSync(img.filePath).toString('base64'), mimeType: img.mimeType }
  }));

  const result = await model.generateContent([...imageParts, { text: prompt }]);
  const parts = result.response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart) throw new Error('Gemini image generation returned no image data.');

  const u = result.response.usageMetadata;
  const usage = u ? { inputTokens: Number(u.promptTokenCount) || 0, outputTokens: Number(u.candidatesTokenCount) || 0, imageInputTokens: 0 } : null;
  return { b64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png', usage };
}

/**
 * Vision: asks Gemini to look at an image and return a text response (the
 * caller prompts it to respond in JSON and handles parsing).
 * @param {{ base64: string, mimeType: string, instruction: string, maxTokens?: number }} args
 */
export async function analyzeImage({ base64, mimeType, instruction, maxTokens = 700 }) {
  const genAI = getClient();
  if (!genAI) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

  const modelName = visionModelName();
  const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { maxOutputTokens: maxTokens } });

  const result = await model.generateContent([
    { text: instruction },
    { inlineData: { data: base64, mimeType } }
  ]);

  return result.response.text().trim();
}
