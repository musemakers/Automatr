import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';

export const name = 'runway';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function videoModelName() {
  return process.env.RUNWAY_MODEL || 'gen4_turbo';
}


export function isConfigured() {
  return Boolean(process.env.RUNWAY_API_KEY);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
    'X-Runway-Version': API_VERSION,
    'Content-Type': 'application/json'
  };
}

const IMAGE_MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * With imagePath set, this calls Runway's image_to_video endpoint instead
 * of text_to_video, animating the given image as the starting frame -
 * gen4_turbo is in fact primarily an image-conditioned model in Runway's
 * own API, so this is the path most likely to produce Runway's best
 * quality regardless of the "animate the approved key visual" feature
 * this was added for. See veo.js for why that matters here.
 */
export async function submitJob({ prompt, aspectRatio = '9:16', durationSeconds, imagePath }) {
  if (!isConfigured()) throw new Error('Runway is not configured (missing RUNWAY_API_KEY).');

  const ratio = aspectRatio === '9:16' ? '720:1280' : aspectRatio === '16:9' ? '1280:720' : '1024:1024';
  // Runway's gen4_turbo only accepts 5 or 10 second durations - snap to
  // whichever is closer rather than passing an arbitrary value through.
  const duration = Number(durationSeconds) > 7 ? 10 : 5;
  const model = videoModelName();

  const body = { model, ratio, duration };
  let endpoint;
  if (imagePath) {
    endpoint = 'image_to_video';
    const mimeType = IMAGE_MIME_BY_EXT[path.extname(imagePath).toLowerCase()] || 'image/png';
    const bytes = await fs.readFile(imagePath);
    body.promptImage = `data:${mimeType};base64,${bytes.toString('base64')}`;
    if (prompt) body.promptText = prompt;
  } else {
    endpoint = 'text_to_video';
    body.promptText = prompt;
  }

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runway request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Runway did not return a task id to poll.');
  return { externalJobId: data.id, billing: { model, resolution: ratio, seconds: duration } };
}

export async function checkJob({ externalJobId }) {
  if (!isConfigured()) throw new Error('Runway is not configured (missing RUNWAY_API_KEY).');

  const res = await fetch(`${BASE_URL}/tasks/${externalJobId}`, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runway status check failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();

  if (data.status === 'FAILED') {
    return { status: 'failed', note: data.failure || 'Runway generation failed.' };
  }
  if (data.status !== 'SUCCEEDED') {
    return { status: 'processing' };
  }

  const videoUrl = data.output?.[0];
  if (!videoUrl) return { status: 'failed', note: 'Runway finished but returned no video.' };
  return { status: 'completed', videoUrl };
}
