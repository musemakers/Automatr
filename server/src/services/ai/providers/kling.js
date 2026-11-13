import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const BASE_URL = 'https://api.klingai.com';

export const name = 'kling';

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function videoModelName() {
  return process.env.KLING_MODEL || 'kling-v2';
}


export function isConfigured() {
  return Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

// Kling authenticates with a short-lived JWT built from an access key /
// secret key pair, not a static bearer token - built here with Node's
// built-in crypto so no extra JWT dependency is needed for one call site.
function buildAuthToken() {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5 };

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.createHmac('sha256', secretKey).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

/**
 * With imagePath set, this calls Kling's separate image2video endpoint
 * instead of text2video - animating the given image as the starting frame
 * rather than generating a scene from the prompt alone. See veo.js for why:
 * this is the "animate the approved key visual" path.
 */
export async function submitJob({ prompt, aspectRatio = '9:16', durationSeconds, imagePath }) {
  if (!isConfigured()) throw new Error('Kling is not configured (missing KLING_ACCESS_KEY/KLING_SECRET_KEY).');

  // Kling's API only accepts a couple of fixed duration buckets (as
  // strings) rather than an arbitrary number - snap whatever was requested
  // to the closest one it actually supports, defaulting to its standard 5s.
  const duration = Number(durationSeconds) > 5 ? '10' : '5';

  const endpoint = imagePath ? 'image2video' : 'text2video';
  const body = {
    model_name: videoModelName(),
    prompt,
    duration
  };
  if (imagePath) {
    const bytes = await fs.readFile(imagePath);
    body.image = bytes.toString('base64'); // Kling's image2video takes a raw base64 string, no data-URI prefix
  } else {
    body.aspect_ratio = aspectRatio; // image2video instead derives aspect ratio from the source image
  }

  const res = await fetch(`${BASE_URL}/v1/videos/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${buildAuthToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kling request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error('Kling did not return a task id to poll.');
  return { externalJobId: taskId, endpoint, billing: { model: videoModelName(), resolution: '', seconds: Number(duration) } };
}

export async function checkJob({ externalJobId, endpoint = 'text2video' }) {
  if (!isConfigured()) throw new Error('Kling is not configured (missing KLING_ACCESS_KEY/KLING_SECRET_KEY).');

  const res = await fetch(`${BASE_URL}/v1/videos/${endpoint}/${externalJobId}`, {
    headers: { Authorization: `Bearer ${buildAuthToken()}` }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kling status check failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const status = data.data?.task_status;

  if (status === 'failed') {
    return { status: 'failed', note: data.data?.task_status_msg || 'Kling generation failed.' };
  }
  if (status !== 'succeed') {
    return { status: 'processing' };
  }

  const videoUrl = data.data?.task_result?.videos?.[0]?.url;
  if (!videoUrl) return { status: 'failed', note: 'Kling finished but returned no video.' };
  return { status: 'completed', videoUrl };
}
