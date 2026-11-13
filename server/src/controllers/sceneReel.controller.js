import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import SceneReel from '../models/SceneReel.js';
import Post from '../models/Post.js';
import { generationUsage } from '../services/customerService.js';
import { findFfmpeg } from '../utils/fitVideoToSize.js';
import { uploadUrl } from '../utils/storage.js';
import { capabilities, suggestScenes, runReel, resetScene, clampSeconds, reelFileUrl } from '../services/ai/sceneReelService.js';
import { MAX_SCENES, TOTAL_OPTIONS, ASPECTS, TRANSITIONS } from '../constants/sceneReel.js';

const ownerFilter = (req) => (req.user.role === 'member' ? { user: req.user._id } : {});
const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const usageCtx = (req) => ({ userId: req.user._id, userName: req.user.name, userEmail: req.user.email, action: 'scene_reel', postId: null });

// A reference is either a bare file name from POST /upload, or a "/uploads/..." path of something already stored.
const cleanRef = (v) => {
  const r = String(v || '').trim();
  if (!r || r.length > 300 || r.includes('..')) return '';
  return r.startsWith('/uploads/') || !/[\\/]/.test(r) ? r : '';
};
const refUrl = (r) => (!r ? '' : r.startsWith('/uploads/') ? r : uploadUrl(r));

function parseSettings(raw = {}) {
  const total = Number(raw.totalTarget);
  return {
    aspect: ASPECTS.includes(raw.aspect) ? raw.aspect : '9:16',
    totalTarget: TOTAL_OPTIONS.includes(total) ? total : 30,
    continuity: raw.continuity !== false
  };
}

function parseScenes(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SCENES) : [];
  return list.map((s, i) => ({
    id: str(s?.id, 60) || uuidv4(),
    brief: str(s?.brief, 500),
    caption: str(s?.caption, 60),
    seconds: clampSeconds(s?.seconds),
    transition: TRANSITIONS.includes(s?.transition) ? s.transition : i === 0 ? 'cut' : 'fade',
    ref: cleanRef(s?.ref),
    status: 'pending', clipFile: '', frameFile: '', note: ''
  }));
}

const publicReel = (r) => ({
  id: r._id,
  title: r.title,
  status: r.status,
  stage: r.stage,
  error: r.error,
  overallBrief: r.overallBrief,
  settings: r.settings,
  scenes: (r.scenes || []).map((s) => ({
    id: s.id, brief: s.brief, caption: s.caption, seconds: s.seconds, transition: s.transition,
    ref: s.ref, refUrl: refUrl(s.ref),
    status: s.status, note: s.note, frameUrl: reelFileUrl(r._id, s.frameFile)
  })),
  videoUrl: r.videoUrl,
  totalSeconds: r.totalSeconds,
  post: r.post,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
});

/** Refuses a run that would need more videos than the customer has left this month / package. */
async function checkRoom(req, res, needed) {
  if (req.user?.role === 'admin') return true;
  const base = req.customer?.limits?.videosPerMonth;
  if (base === null || base === undefined) return true;
  const { videos } = await generationUsage(req.customer);
  const left = Math.max(0, videos.limit - videos.used);
  if (left >= needed) return true;
  res.status(403).json({
    error: `This reel needs ${needed} video generation${needed === 1 ? '' : 's'} (one per scene) but only ${left} ${left === 1 ? 'is' : 'are'} left. Use fewer scenes or ask your agency to raise the limit.`,
    code: 'MONTHLY_LIMIT_REACHED', kind: 'video', used: videos.used, limit: videos.limit
  });
  return false;
}

export async function config(_req, res) {
  res.json({ ...capabilities(), ffmpeg: Boolean(await findFfmpeg()), maxScenes: MAX_SCENES, totals: TOTAL_OPTIONS });
}

/** Reference image for one scene. Returns the stored file name (kept on the scene) and a preview URL. */
export function uploadRef(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose an image (PNG, JPG or WebP).' });
  if (!/^image\/(png|jpe?g|webp)$/.test(req.file.mimetype)) return res.status(400).json({ error: 'Reference images must be PNG, JPG or WebP.' });
  res.json({ file: req.file.filename, url: uploadUrl(req.file.filename) });
}

/** Drafts a scene list from the overall idea. Nothing is saved. */
export async function suggest(req, res, next) {
  try {
    const out = await suggestScenes({
      idea: str(req.body.idea, 1500),
      totalSeconds: req.body.totalSeconds,
      aspect: ASPECTS.includes(req.body.aspect) ? req.body.aspect : '9:16',
      count: req.body.count,
      usageContext: { ...usageCtx(req), action: 'scene_reel_plan' }
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/** Saves the scenes and starts making the reel (the client polls GET /:id). */
export async function create(req, res, next) {
  try {
    const scenes = parseScenes(req.body.scenes);
    if (scenes.length < 1) return res.status(400).json({ error: 'Add at least one scene.' });
    if (scenes.some((s) => !s.brief)) return res.status(400).json({ error: 'Every scene needs a brief: say what happens in it.' });
    if (!(await checkRoom(req, res, scenes.length))) return;
    const reel = await SceneReel.create({
      user: req.user._id,
      title: str(req.body.title, 80) || 'Multi-scene video',
      overallBrief: str(req.body.overallBrief, 1500),
      settings: parseSettings(req.body.settings),
      scenes,
      status: 'running',
      stage: 'Getting started'
    });
    setImmediate(() => runReel(reel._id, usageCtx(req)));
    res.status(201).json(publicReel(reel));
  } catch (err) {
    next(err);
  }
}

/** The person's reels, newest first, for "Made for You". Reels whose Saved Documents card was deleted are left out. */
export async function list(req, res, next) {
  try {
    const reels = await SceneReel.find(ownerFilter(req)).sort({ createdAt: -1 }).limit(40);
    const withPost = reels.map((r) => r.post).filter(Boolean);
    const alive = new Set((await Post.find({ _id: { $in: withPost } }).select('_id').lean()).map((p) => String(p._id)));
    res.json({ reels: reels.filter((r) => !r.post || alive.has(String(r.post))).map(publicReel) });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const reel = await SceneReel.findOne({ _id: req.params.id, ...ownerFilter(req) });
    if (!reel) return res.status(404).json({ error: 'Reel not found.' });
    res.json(publicReel(reel));
  } catch (err) {
    next(err);
  }
}

/** Try again after a failure: scenes that finished are kept, only the rest are made. */
export async function retry(req, res, next) {
  try {
    const reel = await SceneReel.findOne({ _id: req.params.id, ...ownerFilter(req) });
    if (!reel) return res.status(404).json({ error: 'Reel not found.' });
    if (reel.status === 'running') return res.status(409).json({ error: 'This reel is already being made.' });
    const todo = reel.scenes.filter((s) => s.status !== 'done').length;
    if (!(await checkRoom(req, res, Math.max(1, todo)))) return;
    reel.status = 'running'; reel.stage = 'Getting started'; reel.error = '';
    await reel.save();
    setImmediate(() => runReel(reel._id, usageCtx(req)));
    res.json(publicReel(reel));
  } catch (err) {
    next(err);
  }
}

/** "Redo this scene": optionally with a changed brief / caption / length, then the reel is joined again. */
export async function redoScene(req, res, next) {
  try {
    const reel = await SceneReel.findOne({ _id: req.params.id, ...ownerFilter(req) });
    if (!reel) return res.status(404).json({ error: 'Reel not found.' });
    if (reel.status === 'running') return res.status(409).json({ error: 'This reel is already being made.' });
    const index = reel.scenes.findIndex((s) => s.id === req.params.sceneId);
    if (index < 0) return res.status(404).json({ error: 'Scene not found.' });
    const b = req.body || {};
    if (typeof b.brief === 'string' && str(b.brief, 500)) reel.scenes[index].brief = str(b.brief, 500);
    if (typeof b.caption === 'string') reel.scenes[index].caption = str(b.caption, 60);
    if (b.seconds) reel.scenes[index].seconds = clampSeconds(b.seconds);
    if (TRANSITIONS.includes(b.transition)) reel.scenes[index].transition = b.transition;
    await reel.save();
    await resetScene(reel._id, index);
    const fresh = await SceneReel.findById(reel._id);
    const todo = fresh.scenes.filter((s) => s.status !== 'done').length;
    if (!(await checkRoom(req, res, todo))) return;
    fresh.status = 'running'; fresh.stage = 'Getting started'; fresh.error = '';
    await fresh.save();
    setImmediate(() => runReel(fresh._id, usageCtx(req)));
    res.json(publicReel(fresh));
  } catch (err) {
    next(err);
  }
}
