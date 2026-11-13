import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import * as router from './router.js';
import { submitVideoJob, checkVideoJob, providerStatus } from './videoRouter.js';
import { uploadDir, uploadUrl, resolveUploadPath } from '../../utils/storage.js';
import { findFfmpeg } from '../../utils/fitVideoToSize.js';
import { isVideoMonochrome } from '../../utils/colourGuard.js';
import { describeHexColors } from '../../utils/colorNames.js';
import { aiLog } from '../../utils/aiLog.js';
import { unscoped } from '../../tenant/context.js';
import { dimsFor, renderCaption, buildSegment, stitchSegments, extractLastFrame } from '../../utils/sceneStitch.js';
import { SCENE_MIN_SECONDS, SCENE_MAX_SECONDS, MAX_SCENES, TRANSITIONS } from '../../constants/sceneReel.js';
import { ruleText } from '../blanketRulesService.js';
import { logVideoUsage, attachVideoUrl, markVideoFailed } from '../aiUsageLogService.js';
import SceneReel from '../../models/SceneReel.js';
import Post from '../../models/Post.js';

// MULTI-SCENE REEL (Generate Media -> Made for You -> Multi-scene Video)
//   1. suggestScenes()  - optional: the text model drafts the scene list from the overall idea (every scene stays editable)
//   2. runReel()        - each scene is one clip from the video model (Gemini Omni Flash, 3-10 s). With "keep scenes flowing"
//                         the last frame of scene N is the starting frame of scene N+1, so the story reads as one piece.
//   3. stitch           - ffmpeg trims every clip to its length, lays the caption on (drawn by code, never by the model),
//                         joins the scenes with the chosen transitions, strips audio, and the file is saved.
// A reel that finishes also becomes a card in Saved Documents -> Completed (a Post of type 'multiscene').

const PROVIDER = 'veo'; // Gemini Omni Flash (kept as 'veo' so settings, usage rows and pipelines keep working)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function capabilities() {
  return { video: Boolean(providerStatus().veo) };
}

export const clampSeconds = (v) => clamp(Math.round(Number(v) || 5), SCENE_MIN_SECONDS, SCENE_MAX_SECONDS);

// ---------------------------------------------------------------- planning

function parseJson(text) {
  const s = String(text || '').replace(/```json|```/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON');
  return JSON.parse(s.slice(a, b + 1));
}

export const defaultSceneCount = (total) => clamp(Math.round((Number(total) || 30) / 5), 2, MAX_SCENES);

/** Splits `total` seconds over `count` scenes (3-10 s each, whole seconds, adding up as closely as possible). */
export function splitSeconds(total, count) {
  const out = Array.from({ length: count }, () => clamp(Math.floor(total / count), SCENE_MIN_SECONDS, SCENE_MAX_SECONDS));
  let diff = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < count * 12; i += 1) {
    const k = i % count;
    const next = out[k] + Math.sign(diff);
    if (next >= SCENE_MIN_SECONDS && next <= SCENE_MAX_SECONDS) { out[k] = next; diff -= Math.sign(diff); }
  }
  return out;
}

function normalizeSuggestion(raw, { total, count }) {
  const list = Array.isArray(raw?.scenes) ? raw.scenes.slice(0, MAX_SCENES) : [];
  if (list.length < 2) throw new Error('too few scenes');
  const secs = list.map((s) => Number(s.seconds) || 0);
  const scenes = list.map((s, i) => ({
    brief: clip(s.brief, 500),
    caption: clip(s.caption, 60),
    seconds: secs.every(Boolean) ? clampSeconds(secs[i]) : splitSeconds(total, list.length)[i],
    transition: TRANSITIONS.includes(s.transition) ? s.transition : i === 0 ? 'cut' : 'fade'
  }));
  if (scenes.some((s) => !s.brief)) throw new Error('empty scene');
  return { title: clip(raw?.title, 60), scenes };
}

function fallbackScenes({ idea, total, count }) {
  const secs = splitSeconds(total, count);
  const beats = ['Open on the hero shot that hooks the viewer', 'Show the product in use, close up', 'A second angle that shows what makes it special', 'A lifestyle moment that feels real', 'A detail shot, slow and tactile', 'Bring it together with a confident closing shot'];
  return {
    title: '',
    scenes: secs.map((seconds, i) => ({ brief: `${beats[Math.min(i, beats.length - 1)]}${idea ? `. Idea: ${clip(idea, 160)}` : ''}`, caption: '', seconds, transition: i === 0 ? 'cut' : 'fade' }))
  };
}

export async function suggestScenes({ idea, totalSeconds, aspect, count, usageContext }) {
  const total = clamp(Math.round(Number(totalSeconds) || 30), 6, 60);
  const n = clamp(Math.round(Number(count) || defaultSceneCount(total)), 2, MAX_SCENES);
  const system = [
    `You are a senior video ad director. Plan a ${total}-second ${aspect} social video as ${n} scenes.`,
    `Each scene is ONE continuous shot of ${SCENE_MIN_SECONDS}-${SCENE_MAX_SECONDS} seconds made by an AI video model. Scene lengths must add up to about ${total} seconds.`,
    'Scene 1 hooks the viewer. The last scene resolves (hero shot or call to action). Consecutive scenes should feel like one story: same subject, setting and look unless the idea says otherwise.',
    'For each scene write "brief": one or two concrete sentences about what we SEE (subject, action, camera move, light, setting). Never ask for readable text, logos or lettering inside the footage. Keep hands simple: avoid close-ups of fingers doing fiddly things (counting, typing, intricate gestures); prefer relaxed, natural hand actions, or frame so hands are not the focus. If a product appears, its packaging and label stay exactly as supplied.',
    '"caption" is an optional short on-screen line (max 40 characters, may be empty) that will be added separately as clean text.',
    '"transition" is how the scene comes in: cut, fade, dissolve, wipe or slide.',
    'Return ONLY JSON: {"title": string (max 5 words), "scenes": [{"brief": string, "caption": string, "seconds": integer, "transition": string}]}'
  ].join('\n');
  let note = '';
  for (const model of await router.roleModels('planner', ['claude', 'auto'])) {
    try {
      const { text, modelUsed } = await router.generateText({ model, system, prompt: `The idea: ${clip(idea, 1500) || 'a product ad'}\nReturn the JSON now.`, maxTokens: 2400, purpose: 'multi-scene plan', usageContext });
      if (modelUsed === 'placeholder') continue;
      return { ...normalizeSuggestion(parseJson(text), { total, count: n }), note: '' };
    } catch (err) {
      note = err.message;
    }
  }
  return { ...fallbackScenes({ idea, total, count: n }), note: `Used a starter outline${note ? ` (${note})` : ''}. Edit each scene to fit your idea.` };
}

// ---------------------------------------------------------------- running

const patchScene = (reelId, index, fields) =>
  SceneReel.updateOne({ _id: reelId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`scenes.${index}.${k}`, v])) });
const setReel = (reelId, fields) => SceneReel.updateOne({ _id: reelId }, { $set: fields });

const folderName = (reelId) => `scenereel-${reelId}`;
const reelFolder = (reelId) => { const d = path.join(uploadDir(), folderName(reelId)); fs.mkdirSync(d, { recursive: true }); return d; };
export const reelFileUrl = (reelId, file) => (file ? uploadUrl(`${folderName(reelId)}/${file}`) : '');
const hash = (...p) => crypto.createHash('sha1').update(p.join('|')).digest('hex').slice(0, 10);

export function buildScenePrompt({ reel, scene, index, total, flowing }) {
  const parts = [
    `Scene ${index + 1} of ${total} of a ${reel.settings.aspect} social video.`,
    reel.overallBrief ? `Overall idea: ${reel.overallBrief}.` : '',
    `This scene: ${scene.brief}`,
    flowing ? 'Continue seamlessly from the previous shot: same subject, setting, lighting and colours.' : '',
    ruleText('sceneProductLock') || 'If a product is shown, its packaging, label text, logo and colours stay exactly as in the supplied image: never redraw, restyle or alter them.',
    'Do not show or animate any text, captions, letters, numbers or logos unless they already appear in the supplied starting image; captions are added separately.',
    ruleText('sceneMotionGuard') || 'Smooth, stable, natural motion. No sudden cuts inside the shot.'
  ];
  return describeHexColors(parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
}

async function downloadTo(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the clip (${res.status}).`);
  fs.writeFileSync(`${outFile}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${outFile}.part`, outFile);
}

async function makeClip({ reel, scene, index, startImage, flowing, usageContext, dir, ffmpeg }) {
  const prompt = buildScenePrompt({ reel, scene, index, total: reel.scenes.length, flowing: flowing && Boolean(startImage) && !scene.ref });
  const startKey = startImage ? hash(fs.readFileSync(startImage).subarray(0, 4096).toString('base64')) : 'none';
  const outFile = path.join(dir, `clip_${scene.id}_${hash(prompt, scene.seconds, startKey)}.mp4`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10_000) return outFile; // finished earlier: never pay twice
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const sub = await submitVideoJob({ provider: PROVIDER, prompt, aspectRatio: reel.settings.aspect, durationSeconds: scene.seconds, imagePath: startImage || undefined });
      if (!sub.submitted) throw new Error(sub.note || 'The video model did not accept the job.');
      await logVideoUsage(usageContext, { provider: sub.provider || PROVIDER, externalJobId: sub.externalJobId, requestedSeconds: scene.seconds });
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(5000);
        const r = await checkVideoJob({ provider: sub.provider || PROVIDER, externalJobId: sub.externalJobId, providerMeta: sub.providerMeta });
        if (r.status === 'completed') {
          await downloadTo(r.videoUrl, outFile);
          await attachVideoUrl(sub.externalJobId, reelFileUrl(reel._id, path.basename(outFile)), r.usage);
          // COLOUR INTEGRITY: a black-and-white clip is never kept.
          if (await isVideoMonochrome(ffmpeg, outFile)) { fs.unlinkSync(outFile); throw new Error('The clip came back black-and-white, which is not allowed.'); }
          return outFile;
        }
        if (r.status === 'failed') { await markVideoFailed(sub.externalJobId); throw new Error(r.note || 'Video generation failed.'); }
      }
      throw new Error('Video generation timed out.');
    } catch (err) {
      lastErr = err;
      aiLog('video', 'fail', { msg: `scene reel scene ${index + 1}: ${err.message}${attempt < 2 ? ' - retrying' : ''}` });
    }
  }
  throw lastErr;
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; await fn(items[i], i); }
  }));
}

/**
 * Generates every scene that has no finished clip yet, then stitches the reel.
 * Safe to call again after a failure: finished scenes are kept and only the missing ones are made.
 */
export async function runReel(reelId, usageContext = null) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenereel-'));
  try {
    const reel0 = await SceneReel.findById(reelId);
    if (!reel0) return;
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('Video assembly needs ffmpeg on the server (install the ffmpeg-static package or set FFMPEG_PATH).');
    if (!capabilities().video) throw new Error('The video model is not set up yet. Ask an admin to configure it.');
    await setReel(reelId, { status: 'running', error: '', stage: 'Getting started' });

    const reel = reel0.toObject();
    const dir = reelFolder(reelId);
    const flowing = reel.settings?.continuity !== false;
    const scenes = reel.scenes;
    const isDone = (s) => s.status === 'done' && s.clipFile && fs.existsSync(path.join(dir, s.clipFile));
    let failed = 0;

    const doScene = async (i, startImage) => {
      const s = scenes[i];
      if (isDone(s)) return;
      await patchScene(reelId, i, { status: 'generating', note: '' });
      await setReel(reelId, { stage: `Making scene ${i + 1} of ${scenes.length}` });
      try {
        const clipPath = await makeClip({ reel, scene: s, index: i, startImage, flowing, usageContext, dir, ffmpeg });
        const frameFile = `frame_${s.id}.jpg`;
        let frame = '';
        try { if (await extractLastFrame({ ffmpeg, clipPath, outPath: path.join(dir, frameFile) })) frame = frameFile; } catch { /* the next scene then starts fresh */ }
        s.status = 'done'; s.clipFile = path.basename(clipPath); s.frameFile = frame;
        await patchScene(reelId, i, { status: 'done', clipFile: s.clipFile, frameFile: frame, note: '' });
      } catch (err) {
        failed += 1;
        s.status = 'failed';
        await patchScene(reelId, i, { status: 'failed', note: String(err.message || err).slice(0, 200) });
      }
    };
    const startFor = (i) => {
      const s = scenes[i];
      if (s.ref) { const p = resolveUploadPath(s.ref); return p && fs.existsSync(p) ? p : null; } // the scene's own reference wins
      if (flowing && i > 0 && scenes[i - 1].frameFile) { const p = path.join(dir, scenes[i - 1].frameFile); return fs.existsSync(p) ? p : null; }
      return null;
    };

    if (flowing) {
      for (let i = 0; i < scenes.length; i += 1) await doScene(i, startFor(i)); // in order: each scene needs the one before it
    } else {
      await pool(scenes.map((_, i) => i), 3, (i) => doScene(i, startFor(i)));
    }

    if (failed || scenes.some((s) => !isDone(s))) {
      const bad = scenes.map((s, i) => (isDone(s) ? 0 : i + 1)).filter(Boolean);
      await setReel(reelId, { status: 'failed', stage: 'Needs another try', error: `Scene${bad.length > 1 ? 's' : ''} ${bad.join(', ')} could not be made. The finished scenes are saved, so trying again only redoes the rest.` });
      return;
    }

    await setReel(reelId, { stage: 'Adding captions and joining the scenes' });
    const { w, h } = dimsFor(reel.settings.aspect);
    const segs = [];
    for (let i = 0; i < scenes.length; i += 1) {
      const s = scenes[i];
      let captionPng = null;
      if (s.caption) { captionPng = path.join(workDir, `cap_${i}.png`); fs.writeFileSync(captionPng, await renderCaption({ text: s.caption, w, h })); }
      const segPath = path.join(workDir, `seg_${i}.mp4`);
      await buildSegment({ ffmpeg, clipPath: path.join(dir, s.clipFile), captionPng, seconds: s.seconds, w, h, outPath: segPath });
      segs.push({ path: segPath, seconds: s.seconds, transition: TRANSITIONS.includes(s.transition) ? s.transition : 'fade' });
    }
    const finalName = `reel-${uuidv4()}.mp4`;
    const finalPath = path.join(uploadDir(), finalName);
    const totalSeconds = await stitchSegments({ ffmpeg, segs, outPath: finalPath });
    const videoUrl = uploadUrl(finalName);
    await setReel(reelId, { status: 'completed', stage: 'Done', error: '', videoUrl, totalSeconds: Math.round(totalSeconds * 10) / 10 });
    await attachToPost(reelId, videoUrl).catch((e) => console.warn('[scene-reel] could not add the reel to Saved Documents:', e.message));
  } catch (err) {
    aiLog('video', 'fail', { msg: `scene reel failed: ${err.message}` });
    await setReel(reelId, { status: 'failed', stage: 'Failed', error: String(err.message || err).slice(0, 400) }).catch(() => {});
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** The finished reel shows up in Saved Documents -> Completed (and counts as one video generation on the Usage page). */
async function attachToPost(reelId, videoUrl) {
  const reel = await SceneReel.findById(reelId);
  if (!reel) return;
  if (reel.post) {
    const updated = await Post.updateOne({ _id: reel.post, 'designs.label': 'Variant A' }, { $set: { 'designs.$.videoJobs.0.videoUrl': videoUrl, 'designs.$.videoJobs.0.status': 'completed' } });
    if (updated.matchedCount) return;
  }
  const post = await Post.create({
    user: reel.user,
    creativeType: 'multiscene',
    purpose: reel.title || 'Multi-scene video',
    mediums: ['instagram_feed'],
    designs: [{
      label: 'Variant A',
      caption: reel.overallBrief || '',
      videoJobs: [{ provider: PROVIDER, externalJobId: `reel-${reel._id}`, status: 'completed', prompt: reel.overallBrief || '', videoUrl, aspectRatio: reel.settings.aspect, createdAt: new Date() }]
    }],
    selectedVariantLabel: 'Variant A',
    status: 'draft'
  });
  await setReel(reelId, { post: post._id });
}

/** Removes one scene's finished clip so the next run makes it again (used by "Redo this scene"). */
export async function resetScene(reelId, index) {
  const reel = await SceneReel.findById(reelId);
  const s = reel?.scenes?.[index];
  if (!s) return;
  if (s.clipFile) { try { fs.rmSync(path.join(reelFolder(reelId), s.clipFile), { force: true }); } catch { /* ignore */ } }
  await patchScene(reelId, index, { status: 'pending', clipFile: '', frameFile: '', note: '' });
  // With "keep scenes flowing" every later scene started from this one's last frame, so they are remade too.
  if (reel.settings?.continuity !== false) {
    for (let i = index + 1; i < reel.scenes.length; i += 1) {
      const later = reel.scenes[i];
      if (later.ref) break; // a scene with its own reference does not depend on the one before it
      if (later.clipFile) { try { fs.rmSync(path.join(reelFolder(reelId), later.clipFile), { force: true }); } catch { /* ignore */ } }
      await patchScene(reelId, i, { status: 'pending', clipFile: '', frameFile: '', note: '' });
    }
  }
}

/** Reels that were running when the server restarted can never finish: mark them so the person can try again. */
export async function recoverStaleSceneReels() {
  await unscoped(async () => SceneReel.updateMany(
    { status: 'running' },
    { $set: { status: 'failed', stage: 'Interrupted', error: 'The server restarted while this reel was being made. Try again: finished scenes are kept.' } }
  ));
}
