import fs from 'node:fs/promises';
import path from 'node:path';

// Seedance is ByteDance's video model, served through the same BytePlus
// ModelArk platform as the Seedream image provider (see providers/seedream.js) -
// one Ark account/API key covers both products, so this defaults to reusing
// SEEDREAM_API_KEY/SEEDREAM_BASE_URL rather than requiring a second key,
// while still letting SEEDANCE_API_KEY override independently if someone's
// account setup actually does separate them. Same idea as Veo reusing
// GEMINI_API_KEY rather than needing its own.
//
// This targets Seedance 1.0 Pro Fast (seedance-1-0-pro-fast-251015),
// confirmed directly from this account's own BytePlus Ark console (model
// detail page: ai.byteplus.com/ark/region:ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast),
// which shows it supports "Image-to-video - First frame" - i.e. one model
// id handles both text-to-video and image-to-video (which content blocks
// you attach determines the mode). This replaced several earlier guesses
// (a "doubao-" prefixed 1.0-lite id, Dreamina Seedance 2.0, Seedance 1.5
// Pro) that either 404'd, weren't activatable on this account, or carried
// an unwanted reservation/deposit requirement - if this ever needs to
// change again, get the exact callable Model ID from this account's own
// Ark console model detail page rather than an external search result,
// since the specific date-suffixed id has repeatedly varied by account/
// region in ways external docs don't reliably reflect.
//
// NOTE: Ark's video API is newer/less stable than its image API - if
// activation or requests fail again, check this account's actual
// available/activated models in the BytePlus Ark console before assuming
// the request shape itself has drifted.
const BASE_URL = process.env.SEEDANCE_BASE_URL || process.env.SEEDREAM_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';

function apiKey() {
  return process.env.SEEDANCE_API_KEY || process.env.SEEDREAM_API_KEY;
}

export const name = 'seedance';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function videoModelName() {
  return process.env.SEEDANCE_MODEL || 'seedance-1-0-pro-fast-251015';
}


export function isConfigured() {
  return Boolean(apiKey());
}

const IMAGE_MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// Ark's 1.0-generation Seedance models (pro, pro-fast, lite) take
// duration/resolution as inline "--flag value" suffixes appended to the
// prompt text itself, rather than as separate JSON fields - confirmed via
// BytePlus's own "Seedance-1.0-lite Prompt Guide" example, and this is
// also the exact convention already confirmed working in THIS account for
// text-to-video (the original seedance-1-0-pro-250528 default). This is
// different from the newer 1.5/2.0-generation models, which take
// resolution/ratio/duration as top-level JSON fields instead - do not mix
// the two conventions if switching models again; check which generation a
// model belongs to first (its BytePlus prompt-guide doc page groups models
// by convention, e.g. "1.0-pro & pro-fast" share one page/convention).
function buildPromptWithFlags(prompt, durationSeconds) {
  // Ark only accepts a small set of fixed durations (in whole seconds) -
  // snap to the closest of its documented 5/10s options, same idea as
  // kling.js snapping to its own supported buckets.
  const dur = Number(durationSeconds) > 7 ? 10 : 5;
  return `${prompt} --resolution 720p --duration ${dur}`;
}

/**
 * With imagePath set, an image_url content block tagged role:"first_frame"
 * is added alongside the text prompt - this account's own Ark console
 * confirms this exact model supports "Image-to-video - First frame" mode
 * this way. This is what makes it image-to-video (animating that exact
 * image as the video's starting frame) rather than text-to-video from
 * scratch. See videoRouter.js/designService.js's buildVideoPrompt for why
 * this matters: it's the "animate the approved key visual" path, so the
 * video actually matches the creative that got signed off rather than
 * reinterpreting it. The image travels as a base64 data URI rather than a
 * hosted URL, since there's no guarantee Ark's servers can reach this
 * app's own upload URLs.
 */
export async function submitJob({ prompt, aspectRatio = '9:16', durationSeconds, imagePath }) {
  if (!isConfigured()) throw new Error('Seedance is not configured (missing SEEDANCE_API_KEY/SEEDREAM_API_KEY).');

  const model = videoModelName();

  const content = [{ type: 'text', text: buildPromptWithFlags(prompt, durationSeconds) }];
  if (imagePath) {
    const mimeType = IMAGE_MIME_BY_EXT[path.extname(imagePath).toLowerCase()] || 'image/png';
    const bytes = await fs.readFile(imagePath);
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}` },
      role: 'first_frame'
    });
  }

  const res = await fetch(`${BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, content })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Seedance request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const taskId = data.id;
  if (!taskId) throw new Error('Seedance did not return a task id to poll.');
  return { externalJobId: taskId, billing: { model, resolution: '720p', seconds: Number(durationSeconds) > 7 ? 10 : 5 } };
}

export async function checkJob({ externalJobId }) {
  if (!isConfigured()) throw new Error('Seedance is not configured (missing SEEDANCE_API_KEY/SEEDREAM_API_KEY).');

  const res = await fetch(`${BASE_URL}/contents/generations/tasks/${externalJobId}`, {
    headers: { Authorization: `Bearer ${apiKey()}` }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Seedance status check failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const status = data.status;

  if (status === 'failed' || status === 'cancelled') {
    return { status: 'failed', note: data.error?.message || 'Seedance generation failed.' };
  }
  if (status !== 'succeeded') {
    return { status: 'processing' };
  }

  const videoUrl = data.content?.video_url;
  if (!videoUrl) return { status: 'failed', note: 'Seedance finished but returned no video.' };
  // usage.completion_tokens is what BytePlus bills (price per 1M tokens x tokens).
  return { status: 'completed', videoUrl, usage: { completionTokens: Number(data.usage?.completion_tokens) || 0 } };
}
