import Anthropic from '@anthropic-ai/sdk';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export const name = 'anthropic';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
/** Model used for image analysis (animation ideas, reference/brand analysis...). Set ANTHROPIC_VISION_MODEL to pin a separate
 *  vision model; when unset it follows the text model, so nothing changes until you set it. */
export function visionModelName() {
  return process.env.ANTHROPIC_VISION_MODEL || textModelName();
}

export function textModelName() {
  return process.env.ANTHROPIC_TEXT_MODEL || 'claude-sonnet-4-5';
}


export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * @param {{system?: string, prompt: string, maxTokens?: number}} args
 * @returns {Promise<string>}
 */
export async function generateText({ system, prompt, maxTokens = 400 }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Anthropic is not configured (missing ANTHROPIC_API_KEY).');

  const model = textModelName();
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }]
  });

  const textBlock = response.content?.find((block) => block.type === 'text');
  return textBlock?.text?.trim() || '';
}

// Claude has no first-party image generation API; the router simply
// never selects Anthropic for image requests.
export async function generateImage() {
  throw new Error('Anthropic/Claude does not support image generation.');
}

// Claude can natively analyze both rasterized images and PDFs (as a
// "document" content block) - no rasterization step needed for either.
export const ANALYZABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf']);

/**
 * Vision/document analysis: asks Claude to look at an image or PDF and
 * return a text response (the caller is responsible for prompting it to
 * respond in JSON and parsing that response - this function just handles
 * the model call).
 * @param {{ base64: string, mimeType: string, instruction: string, maxTokens?: number }} args
 */
export async function analyzeImage({ base64, mimeType, instruction, maxTokens = 700 }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('Anthropic is not configured (missing ANTHROPIC_API_KEY).');

  const model = visionModelName();
  const contentBlock =
    mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [contentBlock, { type: 'text', text: instruction }]
      }
    ]
  });

  const textBlock = response.content?.find((block) => block.type === 'text');
  return textBlock?.text?.trim() || '';
}
