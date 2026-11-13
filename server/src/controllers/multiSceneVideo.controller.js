import MultiSceneJob from '../models/MultiSceneJob.js';
import { capabilities, planStoryboard, applyEdits, runReel, listReels } from '../services/ai/multiSceneVideoService.js';

function parseBrief(raw) {
  let b = {};
  try { b = typeof raw === 'string' ? JSON.parse(raw) : raw || {}; } catch { b = {}; }
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  return {
    product: str(b.product, 120),
    theme: str(b.theme, 400),
    audience: str(b.audience, 200),
    tone: str(b.tone, 120),
    notes: str(b.notes, 600),
    urlText: str(b.urlText, 60),
    lookCount: Number(b.lookCount) || 4,
    labels: Array.isArray(b.labels) ? b.labels.slice(0, 5).map((l) => str(l, 18)) : []
  };
}

const publicJob = (j) => ({
  id: j._id,
  status: j.status,
  stage: j.stage,
  error: j.error,
  capSeconds: j.capSeconds,
  totalSeconds: j.totalSeconds,
  scenes: j.scenes,
  videoUrl: j.videoUrl,
  updatedAt: j.updatedAt
});

/** The person's earlier reels (completed, failed and saved drafts) - nothing is lost on redeploy. */
export async function list(req, res, next) {
  try {
    res.json({ reels: await listReels(req.user._id) });
  } catch (err) {
    next(err);
  }
}

export function config(_req, res) {
  res.json(capabilities());
}

/** Step 1: upload product + logos, get an editable storyboard back. Nothing expensive runs yet. */
export async function plan(req, res, next) {
  try {
    const f = req.files || {};
    const product = f.product?.[0]?.filename;
    if (!product) return res.status(400).json({ error: 'Upload the product image first.' });

    const brief = parseBrief(req.body.brief);
    const { scenes, endCard, totalSeconds, note } = await planStoryboard({ brief });

    const job = await MultiSceneJob.create({
      user: req.user._id,
      status: 'storyboard',
      stage: 'Review the storyboard',
      brief,
      capSeconds: capabilities().capSeconds,
      totalSeconds,
      scenes,
      endCard,
      files: {
        product,
        // File NAMES inside the upload root (not absolute paths) so a moved/renamed volume mount never breaks old reels.
        endLogo: f.endLogo?.[0]?.filename || '',
        marketLogos: (f.marketLogos || []).slice(0, 6).map((x) => x.filename)
      }
    });
    res.json({ ...publicJob(job), note });
  } catch (err) {
    next(err);
  }
}

/** Step 2: take the (possibly edited) storyboard and render. Returns immediately; the client polls. */
export async function generate(req, res, next) {
  try {
    const job = await MultiSceneJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ error: 'Storyboard not found.' });
    if (['running', 'stitching'].includes(job.status)) return res.status(409).json({ error: 'This reel is already being generated.' });

    applyEdits(job, Array.isArray(req.body.scenes) ? req.body.scenes : []);
    job.status = 'running';
    job.stage = 'Starting';
    job.error = '';
    job.videoUrl = '';
    await job.save();

    // Spend for the stills and clips is logged against this person (AI Usage page).
    const usageContext = { userId: req.user._id, userName: req.user.name, userEmail: req.user.email, action: 'multiscene_video', postId: null };
    setImmediate(() => runReel(job._id, usageContext));
    res.json(publicJob(job));
  } catch (err) {
    next(err);
  }
}

export async function getJob(req, res, next) {
  try {
    const job = await MultiSceneJob.findOne({ _id: req.params.id, user: req.user._id });
    if (!job) return res.status(404).json({ error: 'Not found.' });
    res.json(publicJob(job));
  } catch (err) {
    next(err);
  }
}
