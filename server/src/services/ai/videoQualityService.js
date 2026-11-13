import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import * as router from './router.js';
import { findFfmpeg } from '../../utils/fitVideoToSize.js';
import { logUsageSafely } from '../aiUsageLogService.js';
import { aiLog } from '../../utils/aiLog.js';

const run = promisify(execFile);

const TILES = 9; // frames shown to the checker, on one numbered contact sheet
const COLS = 3;
const TILE_MAX = 420; // px, longest side of each tile

/** Pulls roughly TILES evenly spaced frames out of the clip (ffmpeg), returned as JPEG buffers. */
async function sampleFrames(videoPath, dir) {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not available');
  // 2 frames a second is plenty for a 3-10s clip; the evenly spaced pick below keeps TILES of them.
  await run(ffmpeg, ['-v', 'error', '-y', '-i', videoPath, '-vf', `fps=2,scale='min(${TILE_MAX},iw)':-2`, '-frames:v', '40', '-q:v', '3', path.join(dir, 'f%03d.jpg')], { timeout: 60000 });
  const files = fs.readdirSync(dir).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
  if (!files.length) throw new Error('no frames could be read from the video');
  const picks = [];
  const n = Math.min(TILES, files.length);
  for (let i = 0; i < n; i += 1) picks.push(files[n === 1 ? 0 : Math.round((i * (files.length - 1)) / (n - 1))]);
  return picks.map((f) => fs.readFileSync(path.join(dir, f)));
}

/** One numbered grid image of the sampled frames (1..N, left to right, top to bottom = time order). */
async function contactSheet(buffers) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const tw = Math.max(...metas.map((m) => m.width || 0));
  const th = Math.max(...metas.map((m) => m.height || 0));
  const rows = Math.ceil(buffers.length / COLS);
  const composites = [];
  for (let i = 0; i < buffers.length; i += 1) {
    const left = (i % COLS) * (tw + 6);
    const top = Math.floor(i / COLS) * (th + 6);
    composites.push({ input: await sharp(buffers[i]).resize(tw, th, { fit: 'contain', background: '#000' }).toBuffer(), left, top });
    const label = Buffer.from(`<svg width="46" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="46" height="30" rx="5" fill="#000" fill-opacity="0.75"/><text x="23" y="21" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
    composites.push({ input: label, left: left + 6, top: top + 6 });
  }
  const buffer = await sharp({ create: { width: COLS * tw + (COLS - 1) * 6, height: rows * th + (rows - 1) * 6, channels: 3, background: '#ffffff' } })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toBuffer();
  return { buffer, mimeType: 'image/jpeg' };
}

function parseJson(text) {
  const s = String(text || '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Moderator check for a finished clip: samples frames, has the vision model look for the usual AI-video defects, and
 * (when it finds any) returns a short extra instruction for a second, corrected attempt.
 * Never throws: `{ checked:false }` means the check itself could not run, and the caller just keeps the video.
 * @returns {Promise<{checked:boolean, ok?:boolean, issues?:string[], fixPrompt?:string, reason?:string}>}
 */
export async function checkVideoQuality({ videoPath, prompt = '', animatedFromStill = false, usageContext }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqc-'));
  try {
    const frames = await sampleFrames(videoPath, dir);
    const sheet = await contactSheet(frames);
    const instruction = [
      `You are a strict quality moderator for AI-generated ad videos. The image is a contact sheet of ${frames.length} frames from ONE short video, numbered 1-${frames.length} in time order (left to right, top to bottom).`,
      animatedFromStill ? 'The video was animated from an approved still image, so the first frames show how it should look; later frames must keep the same product, people, packaging, logos and lettering.' : '',
      prompt ? `What the video was meant to show: ${String(prompt).replace(/\s+/g, ' ').slice(0, 600)}` : '',
      'Look ONLY for clear, visible defects that a viewer would notice:',
      '- hands or fingers: more or fewer than two hands per person, extra/missing/fused/bent fingers, hands merging into objects',
      '- faces and bodies: warped, melting or duplicated faces, extra limbs, distorted proportions',
      '- objects that morph, melt, duplicate, appear or vanish for no reason',
      '- product, packaging, logos or lettering changing shape, colour or spelling between frames, or turning into garbled text',
      '- background or lighting that jumps, flickers or changes between frames',
      'Do NOT flag style choices, motion blur, camera moves or small imperfections nobody would notice. If you are not sure it is a real defect, treat the video as fine.',
      'Reply with JSON only, no other text, in exactly this shape:',
      '{"ok": true|false, "issues": [{"type": "hands|face|object|text|product|flicker|other", "frames": "e.g. 4-6", "detail": "what is wrong, one short sentence"}], "fixPrompt": "..."}',
      'When ok is false, fixPrompt is 1-3 short imperative sentences (under 70 words) to ADD to the original video prompt so a second attempt avoids exactly these defects (for example: show only one calm hand, keep it still and fully visible; keep the pack and its label unchanged in every frame). Describe what TO do, not what went wrong. When ok is true, fixPrompt is an empty string.'
    ].filter(Boolean).join('\n');

    const { text, modelUsed, note } = await router.analyzeImage({
      purpose: 'checking generated video quality',
      detail: 'high',
      base64: sheet.buffer.toString('base64'),
      mimeType: sheet.mimeType,
      instruction,
      maxTokens: 500
    });
    if (modelUsed && modelUsed !== 'none') {
      await logUsageSafely(usageContext, { type: 'text', provider: modelUsed, purpose: 'video quality check', estimatedCostUsd: 0.01 });
    }
    const data = parseJson(text);
    if (!data) return { checked: false, reason: note || 'the quality check gave no usable answer' };

    const issues = (Array.isArray(data.issues) ? data.issues : [])
      .map((i) => (typeof i === 'string' ? i : `${i?.type ? `${i.type}: ` : ''}${i?.detail || ''}${i?.frames ? ` (frames ${i.frames})` : ''}`).trim())
      .filter(Boolean)
      .slice(0, 6);
    const fixPrompt = typeof data.fixPrompt === 'string' ? data.fixPrompt.trim().slice(0, 600) : '';
    const ok = data.ok === true || (issues.length === 0 && !fixPrompt);
    aiLog('video', ok ? 'done' : 'info', { provider: 'moderator', msg: ok ? 'quality check passed' : `quality check found ${issues.length} issue(s): ${issues.join(' | ').slice(0, 300)}` });
    return { checked: true, ok, issues, fixPrompt };
  } catch (err) {
    return { checked: false, reason: err.message };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
