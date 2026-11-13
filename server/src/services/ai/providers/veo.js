import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

// Video generation is async everywhere (submit a job, poll until done) -
// unlike the synchronous image/text calls elsewhere in this app. Every
// video provider here exposes the same three functions so the router can
// treat them uniformly: isConfigured(), submitJob(), checkJob().
//
// This provider (key 'veo', kept so settings / usage rows / pipelines keep working) now runs
// Google's Gemini Omni Flash (gemini-omni-1.1-flash) through the Gemini API "interactions" endpoint.
// Unlike Veo's predictLongRunning, that call is SYNCHRONOUS: one POST returns the finished interaction.
// To keep the app's submit-then-poll contract, submitJob() fires the request in the background, keeps
// the promise result in memory under a job id, and checkJob() reports on it.
// NOTE: jobs live in this process's memory - a server restart/redeploy while a video is generating loses
// that job (checkJob then reports it as failed so the caller can retry).

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000;

export const name = 'veo';

// Gemini Omni: 16:9 or 9:16 only; 3-10 s per clip (length is steered through the prompt - there is no
// duration parameter); 360p | 720p | 1080p (upscaled) | 4k (upscaled). Platform formats ask for other
// ratios/lengths (1:1, 4:5, 15s...), so they are mapped to the nearest thing Omni accepts.
//   VEO_MODEL       default gemini-omni-1.1-flash
//   VEO_RESOLUTION  360p | 720p (default) | 1080p | 4k
//   VEO_MIN_SECONDS / VEO_MAX_SECONDS   clip-length clamp, default 3 / 10
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const RESOLUTIONS = ['360p', '720p', '1080p', '4k'];

const JOBS = new Map(); // externalJobId -> { state: 'processing'|'done'|'failed', result?, note?, createdAt }

function mapAspectRatio(aspectRatio) {
  if (aspectRatio === '16:9' || aspectRatio === '9:16') return aspectRatio;
  const [w, h] = String(aspectRatio || '9:16').split(':').map(Number);
  return w && h && w > h ? '16:9' : '9:16';
}

/**
 * Gemini Omni fills the whole 9:16 / 16:9 frame from the first-frame image, CENTRE-CROPPING anything that
 * doesn't match (a 1:1 or 4:5 creative loses its left/right edges - headlines get cut). So the image is
 * fitted to the exact target ratio first: the full creative sits uncropped in the middle, and the spare
 * area is filled with a blurred, stretched copy of itself (never black bars) so nothing is lost.
 */
async function fitImageToRatio(bytes, aspect) {
  const [tw, th] = aspect === '16:9' ? [1280, 720] : [720, 1280];
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return { bytes, mimeType: null };
  if (Math.abs(meta.width / meta.height - tw / th) < 0.02) return { bytes, mimeType: null }; // already the right shape
  const bg = await sharp(bytes).resize(tw, th, { fit: 'cover' }).blur(30).modulate({ brightness: 0.95 }).toBuffer();
  const fg = await sharp(bytes).resize(tw, th, { fit: 'inside' }).toBuffer();
  const out = await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).png().toBuffer();
  return { bytes: out, mimeType: 'image/png' };
}

function snapDuration(seconds) {
  const min = Number(process.env.VEO_MIN_SECONDS) || 3;
  const max = Number(process.env.VEO_MAX_SECONDS) || 10;
  const want = Number(seconds);
  if (!want) return undefined; // let the model choose its own length
  return Math.min(max, Math.max(min, Math.round(want)));
}

function configuredResolution() {
  const r = String(process.env.VEO_RESOLUTION || '720p').toLowerCase();
  return RESOLUTIONS.includes(r) ? r : '720p';
}

/** Exact model ID this provider uses (shown in Admin -> AI Settings). */
export function videoModelName() {
  return process.env.VEO_MODEL || 'gemini-omni-1.1-flash';
}

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.createdAt > JOB_TTL_MS) JOBS.delete(id);
}

/** Pulls the generated video (uri or base64) out of an interactions response. */
function extractVideo(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (const step of steps) {
    if (step?.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part?.type === 'video' && (part.uri || part.data)) return part;
    }
  }
  return null;
}

async function runInteraction({ apiKey, model, input, responseFormat, imageToVideo }) {
  const body = { model, input, response_format: responseFormat };
  if (imageToVideo) body.generation_config = { video_config: { task: 'image_to_video' } };

  const res = await fetch(`${BASE_URL}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const hint = res.status === 404 ? ` Model "${model}" was not found for this key - set VEO_MODEL (e.g. gemini-omni-1.1-flash).` : res.status === 403 || res.status === 429 ? ' Video generation needs a paid Gemini API plan/billing enabled.' : '';
    throw new Error(`Video request failed (${res.status}): ${text.slice(0, 300)}${hint}`);
  }
  return res.json();
}

/**
 * Starts a Gemini Omni video generation. Returns immediately with a job id to poll - the underlying
 * request runs in the background and typically takes 1-3+ minutes.
 *
 * With imagePath set, this becomes image-to-video: the image is used as the first frame rather than
 * inventing a scene from the prompt alone (the "animate the approved key visual" path - see
 * designService.js buildVideoPrompt).
 */
export async function submitJob({ prompt, aspectRatio = '9:16', durationSeconds, imagePath }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

  const model = videoModelName();
  const resolution = configuredResolution();
  const snapped = snapDuration(durationSeconds);

  // No duration parameter exists, so ask for the length in the prompt. No dialogue: the app's videos are silent-by-intent.
  const text = `${prompt}${snapped ? ` Clip length: about ${snapped} seconds.` : ''} No dialogue or speech.`;
  const responseFormat = { type: 'video', aspect_ratio: mapAspectRatio(aspectRatio), resolution, delivery: 'uri' };

  let input = text;
  if (imagePath) {
    let bytes = await fs.readFile(imagePath);
    let mimeType = MIME_BY_EXT[path.extname(imagePath).toLowerCase()] || 'image/png';
    try {
      const fitted = await fitImageToRatio(bytes, responseFormat.aspect_ratio);
      bytes = fitted.bytes;
      if (fitted.mimeType) mimeType = fitted.mimeType;
    } catch (err) {
      console.warn('[video] could not fit the key visual to the video ratio, sending it as is:', err.message);
    }
    input = [
      { type: 'image', data: bytes.toString('base64'), mime_type: mimeType },
      { type: 'text', text: `<FIRST_FRAME> ${text} Use this image as the starting frame. Keep the full frame exactly as shown: do not crop, zoom in, reframe or scale the image, and keep every headline and line of text completely inside the frame.` }
    ];
  }

  pruneJobs();
  const externalJobId = `omni-${randomUUID()}`;
  const job = { state: 'processing', createdAt: Date.now() };
  JOBS.set(externalJobId, job);

  runInteraction({ apiKey, model, input, responseFormat, imageToVideo: Boolean(imagePath) })
    .then((data) => {
      const video = extractVideo(data);
      if (!video) {
        const reason = JSON.stringify(data?.error || data?.status || '').slice(0, 300);
        job.state = 'failed';
        job.note = `The video model finished but returned no video${reason && reason !== '""' ? ` (${reason})` : ''}. It may have been blocked by a safety filter - try rewording the direction or using a different image.`;
        return;
      }
      job.state = 'done';
      job.result = video;
    })
    .catch((err) => {
      job.state = 'failed';
      job.note = String(err?.message || err).slice(0, 400);
    });

  // What will actually bill: exact model, resolution and (snapped) length. 8s is assumed when no length is asked for.
  return { externalJobId, billing: { model, resolution, seconds: snapped || 8 } };
}

/** Polls a job started by submitJob(). */
export async function checkJob({ externalJobId }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini is not configured (missing GEMINI_API_KEY).');

  const job = JOBS.get(externalJobId);
  if (!job) return { status: 'failed', note: 'This video job was lost (the server restarted while it was generating). Please generate it again.' };
  if (job.state === 'processing') return { status: 'processing' };
  if (job.state === 'failed') return { status: 'failed', note: job.note || 'Video generation failed.' };

  const video = job.result;
  // Inline base64 -> data URL (Node's fetch can read it); otherwise a Files API URI that needs the key.
  if (video.data) return { status: 'completed', videoUrl: `data:${video.mime_type || 'video/mp4'};base64,${video.data}` };

  const uri = String(video.uri);
  const fileId = (uri.match(/files\/([^/:?]+)/) || [])[1];
  if (fileId) {
    // Wait for the file to finish processing before handing out a download URL.
    const res = await fetch(`${BASE_URL}/files/${fileId}`, { headers: { 'x-goog-api-key': apiKey } });
    if (res.ok) {
      const meta = await res.json().catch(() => ({}));
      if (meta.state === 'FAILED') return { status: 'failed', note: 'The generated video file failed to process.' };
      if (meta.state && meta.state !== 'ACTIVE') return { status: 'processing' };
    }
    return { status: 'completed', videoUrl: `${BASE_URL}/files/${fileId}:download?alt=media&key=${apiKey}` };
  }
  return { status: 'completed', videoUrl: uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}` };
}
