import fs from 'node:fs';
import mongoose from 'mongoose';
import CustomFeature from '../models/CustomFeature.js';
import CustomFeatureRun from '../models/CustomFeatureRun.js';
import Customer from '../models/Customer.js';
import { isStaff } from '../middleware/auth.js';
import { unscoped } from '../tenant/context.js';
import { normalizeSpec, publicSpec, cleanInputs } from '../constants/customFeature.js';
import { restrictGeneration } from '../middleware/budgetGuard.js';
import { analyzeReference } from '../services/ai/referenceAnalysisService.js';
import { designSpec, createRun, runPipeline, composeFinal } from '../services/ai/customFeatureService.js';

const REF_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });

/** Applies the image or the video generation limits, depending on what this feature produces. */
export async function outputGuard(req, res, next) {
  try {
    let spec = null;
    if (req.params.runId) spec = (await CustomFeatureRun.findById(req.params.runId))?.specSnapshot;
    else if (mongoose.isValidObjectId(req.params.id)) spec = (await CustomFeature.findById(req.params.id))?.spec;
    return restrictGeneration(spec?.output === 'video' ? 'video' : 'image')(req, res, next);
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------- shapes

const summary = (f) => ({ id: f._id, name: f.name, description: f.description, icon: f.icon || '✨' });

function adminShape(f, counts = {}) {
  const o = f.toObject ? f.toObject() : f;
  return {
    id: o._id,
    name: o.name,
    description: o.description,
    icon: o.icon || '✨',
    brief: o.brief,
    status: o.status,
    spec: o.spec,
    specVersion: o.specVersion,
    testedCurrent: o.lastTestedVersion === o.specVersion && o.lastTestedVersion > 0,
    lastTestedAt: o.lastTestedAt,
    availability: { mode: o.availability?.mode || 'none', customers: (o.availability?.customers || []).map(String) },
    publishedAt: o.publishedAt,
    designNote: o.designNote,
    reference: o.referenceKind ? { kind: o.referenceKind, name: o.referenceName || '', analysis: o.referenceAnalysis || '', textBlocks: (o.referenceLayout || []).length, usesImage: Boolean(o.referenceHasImage) } : null,
    runs: counts.runs || 0,
    testRuns: counts.testRuns || 0,
    updatedAt: o.updatedAt,
    createdAt: o.createdAt
  };
}

function publicRun(run, { prompts = false } = {}) {
  return {
    id: run._id,
    featureId: run.feature,
    featureName: run.featureName,
    isTest: run.isTest,
    status: run.status,
    stage: run.stage,
    error: run.error,
    finalUrl: run.finalUrl,
    steps: run.steps.map((s) => ({
      key: s.key,
      label: s.label,
      status: s.status,
      note: s.note,
      variants: (s.variants || []).map((v) => ({ url: v.url })),
      selected: s.selected,
      ...(prompts ? { prompt: s.prompt } : {})
    })),
    // The labels/layout of the final creative (never the prompts)
    composition: { mode: run.specSnapshot?.composition?.mode || 'none' },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

const validId = (id) => mongoose.isValidObjectId(id);

function usageContextFor(req, feature) {
  return { userId: req.user._id, userName: req.user.name, userEmail: req.user.email, action: `custom feature: ${feature.name}` };
}

function discardFiles(files = []) {
  for (const f of files) fs.unlink(f.path, () => {});
}

// ---------------------------------------------------------------- customers: use published features

/** Features a person can use in this workspace: published and switched on for this customer. */
export async function listAvailable(req, res, next) {
  try {
    const customerId = req.customer?._id;
    if (!customerId) return res.json({ features: [] });
    const features = await CustomFeature.find({
      status: 'published',
      $or: [{ 'availability.mode': 'all' }, { 'availability.mode': 'selected', 'availability.customers': customerId }]
    }).sort({ name: 1 });
    res.json({ features: features.map(summary) });
  } catch (err) {
    next(err);
  }
}

async function loadAvailable(req, res) {
  if (!validId(req.params.id)) { bad(res, 'Feature not found.', 404); return null; }
  const f = await CustomFeature.findById(req.params.id);
  if (!f || !f.isAvailableTo(req.customer?._id)) { bad(res, 'This feature is not available in your workspace.', 404); return null; }
  return f;
}

export async function getAvailable(req, res, next) {
  try {
    const f = await loadAvailable(req, res);
    if (!f) return;
    res.json({ feature: { ...summary(f), spec: publicSpec(f.spec) } });
  } catch (err) {
    next(err);
  }
}

/** Shared by customer runs and agency test runs: validate the form, save, and start the background pipeline. */
async function launch(req, res, feature, { isTest }) {
  const files = Array.isArray(req.files) ? req.files : [];
  try {
    let spec;
    try { spec = normalizeSpec(feature.spec); } catch (e) { discardFiles(files); return bad(res, `This feature is not set up correctly yet: ${e.message}`, 409); }

    // Group uploaded files by the image field they were sent under.
    const imageFields = new Map(spec.fields.filter((f) => f.type === 'image').map((f) => [f.key, f]));
    const filesByField = {};
    for (const f of files) {
      const field = imageFields.get(f.fieldname);
      if (!field) { discardFiles(files); return bad(res, `Unexpected file "${f.fieldname}".`); }
      if (!REF_MIMES.has(f.mimetype)) { discardFiles(files); return bad(res, `"${field.label}" must be a PNG, JPG or WebP image.`); }
      (filesByField[f.fieldname] ||= []).push(f);
    }
    for (const [key, arr] of Object.entries(filesByField)) {
      if (arr.length > imageFields.get(key).maxFiles) { discardFiles(files); return bad(res, `"${imageFields.get(key).label}" accepts up to ${imageFields.get(key).maxFiles} image(s).`); }
    }

    let inputs;
    try { inputs = cleanInputs(spec, req.body, filesByField); } catch (e) { discardFiles(files); return bad(res, e.message); }

    const run = await createRun({ feature, userId: req.user._id, inputs, filesByField, isTest });
    const ctx = usageContextFor(req, feature);
    setImmediate(() => runPipeline(run._id, ctx));
    return res.status(201).json({ run: publicRun(run, { prompts: isTest }) });
  } catch (err) {
    discardFiles(files);
    throw err;
  }
}

export async function startRun(req, res, next) {
  try {
    const f = await loadAvailable(req, res);
    if (!f) return;
    await launch(req, res, f, { isTest: false });
  } catch (err) {
    next(err);
  }
}

async function loadRun(req, res) {
  if (!validId(req.params.runId)) { bad(res, 'Not found.', 404); return null; }
  const run = await CustomFeatureRun.findById(req.params.runId);
  if (!run) { bad(res, 'Not found.', 404); return null; }
  // Owner, or a workspace/agency admin. (Customer scoping already applied by the tenant plugin.)
  if (String(run.user) !== String(req.user._id) && !isStaff(req.user)) { bad(res, 'Not found.', 404); return null; }
  return run;
}

export async function getRun(req, res, next) {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    res.json({ run: publicRun(run, { prompts: req.user.role === 'admin' }) });
  } catch (err) {
    next(err);
  }
}

export async function listRuns(req, res, next) {
  try {
    if (!validId(req.params.id)) return bad(res, 'Not found.', 404);
    const runs = await CustomFeatureRun.find({ feature: req.params.id, isTest: false, user: req.user._id }).sort({ createdAt: -1 }).limit(24);
    res.json({ runs: runs.map((r) => ({ id: r._id, status: r.status, finalUrl: r.finalUrl, thumb: r.steps?.[0]?.variants?.[0]?.url || '', createdAt: r.createdAt })) });
  } catch (err) {
    next(err);
  }
}

/** The person picked their favourite option for each step that offered several; builds the final creative. */
export async function composeRun(req, res, next) {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (!['review', 'completed'].includes(run.status)) return bad(res, 'This run is not ready to be put together yet.', 409);
    const picks = req.body?.selections && typeof req.body.selections === 'object' ? req.body.selections : {};
    const $set = {};
    run.steps.forEach((s, i) => {
      if (picks[s.key] === undefined) return;
      const n = Number(picks[s.key]);
      if (Number.isInteger(n) && n >= 0 && n < s.variants.length) $set[`steps.${i}.selected`] = n;
    });
    if (Object.keys($set).length) await CustomFeatureRun.updateOne({ _id: run._id }, { $set });
    await composeFinal(run._id);
    const fresh = await CustomFeatureRun.findById(run._id);
    res.json({ run: publicRun(fresh, { prompts: req.user.role === 'admin' }) });
  } catch (err) {
    next(err);
  }
}

/** "Try again" after a failure: finished images are kept, only the missing ones are made. */
export async function retryRun(req, res, next) {
  try {
    const run = await loadRun(req, res);
    if (!run) return;
    if (run.status !== 'failed') return bad(res, 'Only a failed run can be retried.', 409);
    const feature = await CustomFeature.findById(run.feature);
    if (!feature) return bad(res, 'This feature no longer exists.', 404);
    if (!run.isTest && !feature.isAvailableTo(req.customer?._id)) return bad(res, 'This feature is not available in your workspace.', 404);
    await CustomFeatureRun.updateOne({ _id: run._id }, { $set: { status: 'running', stage: 'Starting', error: '' } });
    const ctx = usageContextFor(req, feature);
    setImmediate(() => runPipeline(run._id, ctx));
    const fresh = await CustomFeatureRun.findById(run._id);
    res.json({ run: publicRun(fresh, { prompts: req.user.role === 'admin' }) });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------- agency admin: Brief Studio

async function runCounts() {
  const rows = await unscoped(async () => CustomFeatureRun.aggregate([{ $group: { _id: { f: '$feature', t: '$isTest' }, n: { $sum: 1 } } }]));
  const m = new Map();
  for (const r of rows) {
    const k = String(r._id.f);
    const cur = m.get(k) || { runs: 0, testRuns: 0 };
    if (r._id.t) cur.testRuns += r.n; else cur.runs += r.n;
    m.set(k, cur);
  }
  return m;
}

export async function adminList(_req, res, next) {
  try {
    const [features, counts] = await Promise.all([CustomFeature.find({ status: { $ne: 'archived' } }).sort({ updatedAt: -1 }), runCounts()]);
    res.json({ features: features.map((f) => adminShape(f, counts.get(String(f._id)))) });
  } catch (err) {
    next(err);
  }
}

async function loadAdmin(req, res) {
  if (!validId(req.params.id)) { bad(res, 'Feature not found.', 404); return null; }
  const f = await CustomFeature.findById(req.params.id);
  if (!f) { bad(res, 'Feature not found.', 404); return null; }
  return f;
}

/** Step 1: the admin writes a brief; the AI designs the form + image steps. */
export async function adminCreate(req, res, next) {
  try {
    let brief = String(req.body?.brief || '').trim().slice(0, 6000);
    const refFile = req.file || null;
    if (!refFile && brief.length < 12) return bad(res, 'Describe what the creative should be - a sentence or two at least - or upload a reference image or video.');
    let reference = null;
    if (refFile) {
      try {
        reference = await analyzeReference({ buffer: refFile.buffer, mimeType: refFile.mimetype, filename: refFile.originalname });
      } catch (e) {
        return bad(res, e.message, 422);
      }
      if (brief.length < 12) brief = `Recreate the style of the uploaded reference ${reference.kind} (${String(refFile.originalname || 'reference').slice(0, 60)}).`;
    }
    const outputType = req.body?.outputType === 'video' ? 'video' : req.body?.outputType === 'image' ? 'image' : (reference?.kind === 'video' ? 'video' : 'image');
    const { spec, note } = await designSpec({ brief, outputType, referenceAnalysis: reference?.analysis || '', referenceKind: reference?.kind || '', referenceLayout: reference?.layout || null, styleReference: Boolean(reference?.styleJpeg), textMode: req.body?.textMode === 'code' ? 'code' : 'ai' });
    const name = String(req.body?.name || '').trim().slice(0, 60) || spec.name || 'Untitled feature';
    const f = await CustomFeature.create({
      name,
      description: spec.description,
      icon: spec.icon || '✨',
      brief,
      status: 'testing',
      spec,
      specVersion: 1,
      createdBy: req.user._id,
      referenceKind: reference?.kind || '',
      referenceName: reference ? String(refFile.originalname || '').slice(0, 160) : '',
      referenceAnalysis: reference?.analysis || '',
      referenceLayout: reference?.layout || null,
      referenceHasImage: Boolean(reference?.styleJpeg),
      referenceImage: reference?.styleJpeg || undefined,
      designNote: note
    });
    res.status(201).json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

export async function adminGet(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    const counts = (await runCounts()).get(String(f._id));
    res.json({ feature: adminShape(f, counts) });
  } catch (err) {
    next(err);
  }
}

/** Edit the details or the spec by hand. A changed spec needs a fresh test before it can be published. */
export async function adminUpdate(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    const b = req.body || {};
    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 60);
      if (!name) return bad(res, 'The feature needs a name.');
      f.name = name;
    }
    if (b.description !== undefined) f.description = String(b.description).trim().slice(0, 200);
    if (b.icon !== undefined) f.icon = String(b.icon).trim().slice(0, 8) || '✨';
    if (b.brief !== undefined) {
      const brief = String(b.brief).trim().slice(0, 6000);
      if (brief.length < 12) return bad(res, 'The brief needs a sentence or two at least.');
      f.brief = brief; // the brief is a note for the admin; it never affects a running feature
    }
    // Brief Studio's editor only changes form LABELS and the hidden PROMPTS. A label change does not
    // affect generation (no re-test needed, allowed while live); a prompt change is a new version that
    // must be tested again and cannot be made while the feature is live.
    if ((b.labels && typeof b.labels === 'object') || (b.prompts && typeof b.prompts === 'object')) {
      const next = JSON.parse(JSON.stringify(f.spec));
      let labelsChanged = false;
      let promptsChanged = false;
      if (b.labels && typeof b.labels === 'object') {
        for (const fld of next.fields || []) {
          const v = b.labels[fld.key];
          if (typeof v !== 'string') continue;
          const t = v.replace(/\s+/g, ' ').trim().slice(0, 60);
          if (!t) return bad(res, `The label for "${fld.label}" can't be empty.`);
          if (t !== fld.label) { fld.label = t; labelsChanged = true; }
        }
      }
      if (b.prompts && typeof b.prompts === 'object') {
        for (const st of next.steps || []) {
          const v = b.prompts[st.key];
          if (typeof v !== 'string') continue;
          const t = v.replace(/[ \t]+/g, ' ').trim().slice(0, 1800);
          if (!t) return bad(res, `The prompt for "${st.label}" can't be empty.`);
          if (t !== st.prompt) { st.prompt = t; promptsChanged = true; }
        }
      }
      if (promptsChanged && f.status === 'published') return bad(res, 'Unpublish this feature before changing its prompts, then test it again.', 409);
      if (labelsChanged || promptsChanged) {
        let clean;
        try { clean = normalizeSpec(next); } catch (e) { return bad(res, e.message); }
        f.spec = clean;
        if (promptsChanged) f.specVersion += 1;
        f.markModified('spec');
      }
    }
    if (b.spec !== undefined) {
      let next;
      try { next = normalizeSpec(b.spec); } catch (e) { return bad(res, e.message); }
      if (JSON.stringify(next) !== JSON.stringify(f.spec)) {
        if (f.status === 'published') return bad(res, 'Unpublish this feature before changing how it works, then test it again.', 409);
        f.spec = next;
        f.specVersion += 1;
        f.markModified('spec');
      }
    }
    await f.save();
    res.json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

/** Throw the current spec away and have the AI design it again from the (possibly edited) brief. */
export async function adminRedesign(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    if (f.status === 'published') return bad(res, 'Unpublish this feature before redesigning it.', 409);
    if (req.body?.brief !== undefined) f.brief = String(req.body.brief).trim().slice(0, 6000);
    // Reference: a new upload replaces the old one; "removeReference" drops it; otherwise the saved analysis is reused.
    if (req.file) {
      try {
        const r = await analyzeReference({ buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname });
        f.referenceKind = r.kind; f.referenceName = String(req.file.originalname || '').slice(0, 160); f.referenceAnalysis = r.analysis;
        f.referenceLayout = r.layout || null; f.referenceHasImage = Boolean(r.styleJpeg); f.referenceImage = r.styleJpeg || undefined;
      } catch (e) {
        return bad(res, e.message, 422);
      }
    } else if (req.body?.removeReference === 'true' || req.body?.removeReference === true) {
      f.referenceKind = ''; f.referenceName = ''; f.referenceAnalysis = ''; f.referenceLayout = null; f.referenceHasImage = false; f.referenceImage = undefined;
    }
    if (f.brief.length < 12 && !f.referenceKind) return bad(res, 'Add a brief first.');
    const outputType = req.body?.outputType === 'video' ? 'video' : req.body?.outputType === 'image' ? 'image' : f.spec?.output;
    const { spec, note } = await designSpec({ brief: f.brief, outputType, referenceAnalysis: f.referenceAnalysis, referenceKind: f.referenceKind, referenceLayout: f.referenceLayout, styleReference: f.referenceHasImage, textMode: req.body?.textMode === 'code' ? 'code' : req.body?.textMode === 'ai' ? 'ai' : (f.spec?.overlay?.mode === 'code' ? 'code' : 'ai') });
    f.spec = spec;
    f.specVersion += 1;
    f.markModified('spec');
    f.designNote = note;
    if (!f.description) f.description = spec.description;
    await f.save();
    res.json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

/** "Make the after image more subtle", "add a skin-tone dropdown" ... applied to the current spec by the AI. */
export async function adminRefine(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    if (f.status === 'published') return bad(res, 'Unpublish this feature before changing it.', 409);
    const instruction = String(req.body?.instruction || '').trim().slice(0, 1500);
    if (instruction.length < 4) return bad(res, 'Say what you want changed.');
    const { spec } = await designSpec({ brief: f.brief, current: f.spec, instruction, outputType: f.spec?.output });
    f.spec = spec;
    f.specVersion += 1;
    f.markModified('spec');
    f.designNote = '';
    await f.save();
    res.json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

/** Step 2: try it. Same form, same pipeline - marked as a test so it never counts as customer usage. */
export async function adminTest(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) { discardFiles(Array.isArray(req.files) ? req.files : []); return; }
    await launch(req, res, f, { isTest: true });
  } catch (err) {
    next(err);
  }
}

export async function adminTestRuns(req, res, next) {
  try {
    if (!validId(req.params.id)) return bad(res, 'Not found.', 404);
    // Test runs happen in whichever workspace the admin had selected - list them all.
    const runs = await unscoped(async () => CustomFeatureRun.find({ feature: req.params.id, isTest: true }).sort({ createdAt: -1 }).limit(20));
    res.json({ runs: runs.map((r) => ({ id: r._id, status: r.status, finalUrl: r.finalUrl, featureVersion: r.featureVersion, thumb: r.steps?.[0]?.variants?.[0]?.url || '', createdAt: r.createdAt })) });
  } catch (err) {
    next(err);
  }
}

/** Step 3: deploy to every customer or a chosen few. Needs a successful test of the current version. Also edits availability of a live feature. */
export async function adminPublish(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    if (!(f.lastTestedVersion === f.specVersion && f.lastTestedVersion > 0)) {
      return bad(res, 'Run a successful test of the current version first - the feature changed since it was last tested (or has not been tested yet).', 409);
    }
    const mode = req.body?.mode;
    if (!['all', 'selected'].includes(mode)) return bad(res, 'Choose all customers or specific customers.');
    let customers = [];
    if (mode === 'selected') {
      const ids = [...new Set((Array.isArray(req.body.customers) ? req.body.customers : []).map(String).filter(validId))];
      if (!ids.length) return bad(res, 'Pick at least one customer.');
      const found = await Customer.find({ _id: { $in: ids } }).select('_id');
      if (found.length !== ids.length) return bad(res, 'One of the selected customers no longer exists.');
      customers = ids;
    }
    f.availability = { mode, customers };
    f.status = 'published';
    f.publishedAt = f.publishedAt || new Date();
    await f.save();
    res.json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

export async function adminUnpublish(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    f.status = 'testing';
    await f.save();
    res.json({ feature: adminShape(f) });
  } catch (err) {
    next(err);
  }
}

/** A feature that was never published is deleted; one that has been live is archived so old runs keep working. */
export async function adminRemove(req, res, next) {
  try {
    const f = await loadAdmin(req, res);
    if (!f) return;
    if (f.publishedAt) {
      f.status = 'archived';
      f.availability = { mode: 'none', customers: [] };
      await f.save();
      return res.json({ ok: true, archived: true });
    }
    await CustomFeature.deleteOne({ _id: f._id });
    res.json({ ok: true, archived: false });
  } catch (err) {
    next(err);
  }
}
