import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import * as router from './router.js';
import { submitVideoJob, checkVideoJob, providerStatus as videoProviderStatus } from './videoRouter.js';
import * as seedance from './providers/seedance.js';
import { uploadRoot, uploadDir, uploadUrl, resolveUploadPath } from '../../utils/storage.js';
import { lockVideoText } from '../../utils/videoTextLock.js';
import { isVideoMonochrome } from '../../utils/colourGuard.js';
import { describeHexColors } from '../../utils/colorNames.js';
import { aiLog } from '../../utils/aiLog.js';
import { unscoped } from '../../tenant/context.js';
import MultiSceneJob from '../../models/MultiSceneJob.js';
import {
  ASPECT, MIN_LOOKS, MAX_LOOKS, planDurations, buildPlannerPrompt
} from '../../constants/multiSceneVideo.js';
import { ruleText } from '../blanketRulesService.js';
import { logUsageSafely, logVideoUsage, attachVideoUrl, markVideoFailed } from '../aiUsageLogService.js';
import { estimateImageCostUsdByProvider } from '../costEstimateService.js';
import {
  findFfmpeg, renderHeroOverlay, renderLookOverlay, renderEndCard, composeHeroStill,
  buildClipSegment, buildStillSegment, concatSegments
} from '../../utils/reelCompositor.js';

// Multi-scene Video pipeline. See constants/multiSceneVideo.js for the overall design.
//   1. planStoryboard()  - text model writes copy + per-scene prompts (editable by the person)
//   2. runReel()         - image model -> still per scene; video model animates each still;
//                          code adds text / exact product / end card and stitches.

/** The finished reel can never be longer than one Seedance generation. */
export function capSeconds() {
  return Number(seedance.maxClipSeconds?.()) || 10;
}
function clipSeconds() {
  return Number(seedance.minClipSeconds?.()) || 5;
}

export function capabilities() {
  const video = videoProviderStatus();
  const text = router.providerStatus();
  return {
    capSeconds: capSeconds(),
    minLooks: MIN_LOOKS,
    maxLooks: MAX_LOOKS,
    ready: {
      storyboard: Boolean(text.anthropic || text.openai || text.gemini),
      stills: Boolean(text.seedream),
      motion: Boolean(video.seedance)
    }
  };
}

// ---------------------------------------------------------------- planning

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function parseJson(text) {
  const t = String(text || '').replace(/```json|```/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON found');
  return JSON.parse(t.slice(a, b + 1));
}

function fallbackPlan({ lookCount, product, labels }) {
  const names = ['Soft Start', 'Power Hour', 'Bold Move', 'After Dark', 'Night Out'];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  return {
    hero: {
      kicker: 'Every day',
      title: 'Looks',
      subline: `made easy with ${clip(product, 24) || 'one product'}`,
      stillPrompt: 'Warm, softly lit modern desk by a window at golden hour, laptop open to one side, a small plant and notebook, shallow depth of field, a clear empty spot on the right third of the frame, premium editorial photography.',
      motionPrompt: 'Slow gentle push-in on the desk while warm light drifts across the surface and the plant leaves sway very slightly.'
    },
    looks: Array.from({ length: lookCount }, (_, i) => ({
      title: names[i % names.length],
      label: labels?.[i] || days[i % days.length],
      stillPrompt: `Close-up head-and-shoulders beauty portrait of a woman in her late 20s, look ${i + 1} of ${lookCount}: distinct hairstyle and outfit colour, expressive eyes toward camera, dark studio backdrop, soft key light, premium editorial photography.`,
      motionPrompt: 'Slow push-in as she tilts her head slightly and blinks softly; hair drifts gently.'
    })),
    endCard: { cta: 'Shop now', urlText: '' }
  };
}

function normalizePlan(raw, { lookCount, labels, urlText }) {
  const heroIn = raw?.hero || {};
  const looksIn = Array.isArray(raw?.looks) ? raw.looks : [];
  const hero = {
    kicker: clip(heroIn.kicker, 24),
    title: clip(heroIn.title, 24),
    subline: clip(heroIn.subline, 44),
    stillPrompt: clip(heroIn.stillPrompt, 900),
    motionPrompt: clip(heroIn.motionPrompt, 240)
  };
  const looks = Array.from({ length: lookCount }, (_, i) => {
    const l = looksIn[i] || {};
    return {
      title: clip(l.title, 24),
      label: clip(labels?.[i] || l.label, 18),
      stillPrompt: clip(l.stillPrompt, 900),
      motionPrompt: clip(l.motionPrompt, 240)
    };
  });
  if (!hero.stillPrompt || looks.some((l) => !l.stillPrompt)) throw new Error('storyboard incomplete');
  return { hero, looks, endCard: { cta: clip(raw?.endCard?.cta, 18) || 'Shop now', urlText: clip(urlText || raw?.endCard?.urlText, 40) } };
}

export async function planStoryboard({ brief }) {
  const lookCount = Math.min(MAX_LOOKS, Math.max(MIN_LOOKS, Number(brief.lookCount) || 4));
  const labels = Array.isArray(brief.labels) ? brief.labels.map((l) => clip(l, 18)).filter(Boolean) : [];
  const system = buildPlannerPrompt({ lookCount, product: brief.product, theme: brief.theme, audience: brief.audience, tone: brief.tone, labels, notes: brief.notes });

  let plan = null;
  let note = '';
  for (const model of await router.roleModels('planner', ['claude', 'auto'])) {
    try {
      const { text, modelUsed } = await router.generateText({ model, system, prompt: 'Return the storyboard JSON now.', maxTokens: 2600, purpose: 'multi-scene storyboard' });
      if (modelUsed === 'placeholder') continue;
      plan = normalizePlan(parseJson(text), { lookCount, labels, urlText: brief.urlText });
      break;
    } catch (err) {
      note = err.message;
    }
  }
  if (!plan) {
    plan = normalizePlan(fallbackPlan({ lookCount, product: brief.product, labels }), { lookCount, labels, urlText: brief.urlText });
    note = `Used a starter storyboard${note ? ` (${note})` : ''} - edit the prompts below.`;
  }

  const dur = planDurations(lookCount, capSeconds());
  const scenes = [
    { kind: 'hero', title: plan.hero.title, label: plan.hero.kicker, subline: plan.hero.subline, seconds: dur.hero, stillPrompt: plan.hero.stillPrompt, motionPrompt: plan.hero.motionPrompt },
    ...plan.looks.map((l, i) => ({ kind: 'look', title: l.title, label: l.label, seconds: dur.looks[i], stillPrompt: l.stillPrompt, motionPrompt: l.motionPrompt })),
    { kind: 'end', title: plan.endCard.cta, label: plan.endCard.urlText, seconds: dur.endCard }
  ];
  return { scenes, endCard: plan.endCard, totalSeconds: dur.total, note };
}

/** Applies the person's edits from the review screen, keeping structure + timing under server control. */
export function applyEdits(job, edits = []) {
  const dur = planDurations(job.scenes.filter((s) => s.kind === 'look').length, capSeconds());
  let li = 0;
  job.scenes = job.scenes.map((s, i) => {
    const e = edits[i] || {};
    const base = s.toObject ? s.toObject() : s;
    const seconds = s.kind === 'hero' ? dur.hero : s.kind === 'end' ? dur.endCard : dur.looks[li++];
    return {
      ...base,
      seconds,
      title: clip(e.title ?? base.title, 24),
      label: clip(e.label ?? base.label, s.kind === 'end' ? 40 : 24),
      subline: s.kind === 'hero' ? clip(e.subline ?? base.subline, 44) : '',
      stillPrompt: s.kind === 'end' ? '' : clip(e.stillPrompt ?? base.stillPrompt, 900),
      motionPrompt: s.kind === 'end' ? '' : clip(e.motionPrompt ?? base.motionPrompt, 240),
      status: 'pending', stillUrl: '', note: ''
    };
  });
  job.totalSeconds = dur.total;
  const end = job.scenes.find((s) => s.kind === 'end');
  job.endCard = { cta: end?.title || 'Shop now', urlText: end?.label || '' };
}

// ----------------------------------------------------------------- running

async function patchScene(jobId, index, fields) {
  const set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`scenes.${index}.${k}`, v]));
  await MultiSceneJob.updateOne({ _id: jobId }, { $set: set });
}
const setJob = (jobId, fields) => MultiSceneJob.updateOne({ _id: jobId }, { $set: fields });

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ persistence
// Every scene still and every generated clip is kept on the persistent upload volume
// (uploads/multiscene/<jobId>/), NOT in a temp folder. Reasons: (1) past creations are never
// lost on redeploy, (2) if the server restarts mid-run, or one scene fails, pressing Generate
// again re-uses every scene that already finished instead of paying for it twice.
// Files are named by a hash of what produced them, so an edited prompt makes a new file and an
// unchanged scene is a cache hit. Only the small scratch segments live in a temp folder.
const hash = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);

// Reels made before multi-customer live in <root>/multiscene/<id>/; new ones go in the
// customer's own folder. A job keeps using whichever location it already has.
function jobFolder(jobId) {
  const legacy = path.join(uploadRoot, 'multiscene', String(jobId));
  const dir = fs.existsSync(legacy) ? legacy : path.join(uploadDir(), 'multiscene', String(jobId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const uploaded = (name) => (name ? resolveUploadPath(String(name)) : '');
const jobUrl = (jobId, file) => `/uploads/${path.relative(uploadRoot, jobFolder(jobId)).split(path.sep).join('/')}/${file}`;

/** Called once at boot: reels that were mid-run when the process died can never finish. */
export async function recoverStaleReelJobs() {
  // Boot task: spans every customer.
  await unscoped(async () => MultiSceneJob.updateMany(
    { status: { $in: ['running', 'stitching'] } },
    { $set: { status: 'failed', stage: 'Interrupted', error: 'The server restarted while this reel was being made. Press Generate again - scenes that already finished are re-used, not paid for twice.' } }
  ));
}

/** Recent reels for the "earlier reels" list (newest first). */
export async function listReels(userId, limit = 24) {
  const jobs = await MultiSceneJob.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return jobs.map((j) => ({
    id: j._id,
    status: j.status,
    title: j.brief?.product || j.brief?.theme || 'Untitled reel',
    totalSeconds: j.totalSeconds,
    videoUrl: j.videoUrl,
    thumb: j.scenes?.find((x) => x.kind === 'look' && x.stillUrl)?.stillUrl || j.scenes?.find((x) => x.stillUrl)?.stillUrl || '',
    createdAt: j.createdAt
  }));
}

async function makeStill({ jobId, scene, productPath, index, usageContext }) {
  const productSig = scene.kind === 'hero' ? path.basename(productPath || '') : '';
  const key = hash(scene.kind, scene.stillPrompt, productSig);
  const file = `still_${index}_${key}.jpg`;
  const abs = path.join(jobFolder(jobId), file);
  if (fs.existsSync(abs)) return { stillPath: abs, stillUrl: jobUrl(jobId, file), key, reused: true };

  const prompt = `${describeHexColors(scene.stillPrompt)} ${ruleText('sceneStillGuard')}`.trim();
  let img;
  for (const stillModel of await router.roleModels('still', ['seedream'])) {
    img = await router.generateImage({ model: stillModel, prompt, size: '1080x1920', quality: 'high', purpose: `multi-scene ${scene.kind} still` });
    if (!img.placeholder) {
      // Every still is a real provider call - log it (exact token cost when the provider reports usage).
      logUsageSafely(usageContext, { type: 'image', provider: img.modelUsed, estimatedCostUsd: estimateImageCostUsdByProvider(img.modelUsed, 'high') });
      break;
    }
  }
  if (img.placeholder) throw new Error(img.note || 'Image model unavailable.');
  let buf = Buffer.from(img.b64, 'base64');
  if (scene.kind === 'hero') {
    if (!productPath) throw new Error('The hero scene needs the product image.');
    buf = await composeHeroStill({ backgroundBuf: buf, productPath });
  }
  const sharp = (await import('sharp')).default;
  fs.writeFileSync(abs, await sharp(buf).jpeg({ quality: 92 }).toBuffer());
  return { stillPath: abs, stillUrl: jobUrl(jobId, file), key, reused: false };
}

async function animate({ jobId, scene, stillPath, stillKey, index, usageContext }) {
  const outFile = path.join(jobFolder(jobId), `clip_${index}_${hash(stillKey, scene.motionPrompt)}.mp4`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 10_000) return outFile; // finished earlier - do not pay again
  const motion = `${describeHexColors(scene.motionPrompt)} ${scene.kind === 'hero' ? ruleText('sceneProductLock') : ''} ${ruleText('sceneMotionGuard')}`.replace(/\s+/g, ' ').trim();
  let lastErr;
  const clipModels = await router.roleModels('clip', ['seedance']);
  const attempts = Math.max(2, clipModels.length);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const clipModel = clipModels[(attempt - 1) % clipModels.length];
    try {
      const sub = await submitVideoJob({ provider: clipModel, prompt: motion, aspectRatio: ASPECT, durationSeconds: clipSeconds(), imagePath: stillPath });
      if (!sub.submitted) throw new Error(sub.note || 'The video model did not accept the job.');
      // The provider starts billing once it accepts the job, so log it now (exact model / resolution / seconds).
      await logVideoUsage(usageContext, { provider: sub.provider || clipModel, externalJobId: sub.externalJobId, requestedSeconds: clipSeconds() });
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(5000);
        const r = await checkVideoJob({ provider: sub.provider || clipModel, externalJobId: sub.externalJobId, providerMeta: sub.providerMeta });
        if (r.status === 'completed') {
          await attachVideoUrl(sub.externalJobId, jobUrl(jobId, path.basename(outFile)), r.usage); // real token bill for Seedance
          const res = await fetch(r.videoUrl);
          if (!res.ok) throw new Error(`Could not download the clip (${res.status}).`);
          // Written to a .part file first so a crash mid-download can never leave a half-clip that looks finished.
          fs.writeFileSync(`${outFile}.part`, Buffer.from(await res.arrayBuffer()));
          fs.renameSync(`${outFile}.part`, outFile);
          // COLOUR INTEGRITY: a black-and-white clip is never kept (the retry below makes a new one).
          if (await isVideoMonochrome(await findFfmpeg(), outFile)) {
            fs.unlinkSync(outFile);
            throw new Error('The clip came back black-and-white, which is not allowed.');
          }
          return outFile;
        }
        if (r.status === 'failed') {
          await markVideoFailed(sub.externalJobId);
          throw new Error(r.note || 'Video generation failed.');
        }
      }
      throw new Error('Video generation timed out.');
    } catch (err) {
      lastErr = err;
      aiLog('video', 'fail', { msg: `multi-scene ${scene.kind} ${index}: ${err.message}${attempt < attempts ? ' - retrying' : ''}` });
    }
  }
  throw lastErr;
}

export async function runReel(jobId, usageContext = null) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  try {
    const job = await MultiSceneJob.findById(jobId);
    if (!job) return;
    const ffmpeg = await findFfmpeg();
    if (!ffmpeg) throw new Error('Video assembly needs ffmpeg on the server (install the ffmpeg-static package or set FFMPEG_PATH).');
    const caps = capabilities();
    if (!caps.ready.stills) throw new Error('The image model is not set up yet. Ask an admin to configure it.');
    if (!caps.ready.motion) throw new Error('The video model is not set up yet. Ask an admin to configure it.');

    await setJob(jobId, { status: 'running', stage: 'Creating scenes', error: '' });
    const scenes = job.scenes.map((s) => (s.toObject ? s.toObject() : s));
    const motionScenes = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.kind !== 'end');
    const clips = {};
    const stills = {};

    // Each scene: still -> animate, three at a time (keeps provider rate limits happy).
    await pool(motionScenes, 3, async ({ s, i }) => {
      try {
        await patchScene(jobId, i, { status: 'still' });
        const st = await makeStill({ jobId, scene: s, productPath: uploaded(job.files?.product), index: i, usageContext });
        stills[i] = st.stillPath;
        await patchScene(jobId, i, { status: 'animating', stillUrl: st.stillUrl });
        clips[i] = await animate({ jobId, scene: s, stillPath: st.stillPath, stillKey: st.key, index: i, usageContext });
        await patchScene(jobId, i, { status: 'done' });
      } catch (err) {
        await patchScene(jobId, i, { status: 'failed', note: err.message.slice(0, 200) });
        throw err;
      }
    });

    await setJob(jobId, { status: 'stitching', stage: 'Adding text and assembling the reel' });

    // Keep the exact product/packaging steady in the hero clip (frame-0 text lock, best effort).
    // Works on a scratch COPY so the saved original clip is never modified (re-running would otherwise lock twice).
    try {
      const locked = path.join(workDir, 'hero_locked.mp4');
      fs.copyFileSync(clips[0], locked);
      const r = await lockVideoText({ videoPath: locked, stillPath: stills[0] });
      if (r?.applied) clips[0] = locked;
    } catch { /* best effort */ }

    const segs = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const out = path.join(workDir, `seg_${i}.mp4`);
      if (s.kind === 'end') {
        const marketLogoPaths = (job.files?.marketLogos || []).map(uploaded).filter((p) => p && fs.existsSync(p));
        const card = await renderEndCard({ logoPath: fs.existsSync(uploaded(job.files?.endLogo)) ? uploaded(job.files?.endLogo) : '', cta: s.title, urlText: s.label, marketLogoPaths });
        const cardPath = path.join(workDir, 'end.png');
        fs.writeFileSync(cardPath, card);
        await buildStillSegment({ ffmpeg, imagePath: cardPath, seconds: s.seconds, outPath: out });
      } else {
        const overlay = s.kind === 'hero'
          ? await renderHeroOverlay({ kicker: s.label, title: s.title, subline: s.subline })
          : await renderLookOverlay({ title: s.title, label: s.label });
        const overlayPath = path.join(workDir, `ov_${i}.png`);
        fs.writeFileSync(overlayPath, overlay);
        await buildClipSegment({ ffmpeg, clipPath: clips[i], overlayPath, seconds: s.seconds, outPath: out });
      }
      segs.push(out);
    }

    const finalName = `gen-${uuidv4()}.mp4`;
    await concatSegments({ ffmpeg, segmentPaths: segs, outPath: path.join(uploadDir(), finalName) });
    await setJob(jobId, { status: 'completed', stage: 'Done', videoUrl: uploadUrl(finalName) });
  } catch (err) {
    console.warn('[multi-scene] failed:', err.message);
    await setJob(jobId, { status: 'failed', stage: 'Failed', error: String(err.message || err).slice(0, 400) }).catch(() => {});
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}
