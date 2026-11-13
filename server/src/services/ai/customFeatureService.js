import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import * as router from './router.js';
import { getSettings } from '../appSettingsService.js';
import { saveGeneratedImage } from '../../utils/saveGeneratedImage.js';
import { uploadDir, uploadUrl, resolveUploadPath } from '../../utils/storage.js';
import { estimateImageCostUsdByProvider } from '../costEstimateService.js';
import { logUsageSafely, logVideoUsage, attachVideoUrl } from '../aiUsageLogService.js';
import { submitVideoJob, checkVideoJob, providerStatus as videoProviderStatus } from './videoRouter.js';
import { ruleText } from '../blanketRulesService.js';
import { GENERIC_STRICT_TEXT } from '../../utils/textVerify.js';
import { composeCreative } from '../../utils/featureComposite.js';
import { renderOverlay } from '../../utils/featureOverlay.js';
import { unscoped } from '../../tenant/context.js';
import CustomFeature from '../../models/CustomFeature.js';
import CustomFeatureRun from '../../models/CustomFeatureRun.js';
import {
  SIZES, SPEC_SYSTEM_PROMPT, FEATURE_SYSTEM_TAIL, VARIANT_HINT,
  normalizeSpec, fillTemplate, cleanKey
} from '../../constants/customFeature.js';

// Custom features: (1) designSpec() turns an admin's brief into a form + image steps with the text
// model; (2) createRun()/runPipeline()/composeFinal() run those steps on the image model and assemble the
// final creative. All model calls go through router.js, so the API keys, per-customer model choices, AI
// Blocks pipelines, usage logging, black-bar and colour-integrity checks all apply exactly as elsewhere.

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function parseJson(text) {
  const t = String(text || '').replace(/```json|```/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI did not return a usable answer.');
  return JSON.parse(t.slice(a, b + 1));
}

// ---------------------------------------------------------------- designing

const wantsVideo = (brief) => /\b(video|reel|clip|animation|animated|motion)\b/i.test(String(brief || ''));

// Used only when the AI text model is unavailable. Always ONE output (image or video).
function fallbackSpec(brief, outputType, noProduct = false) {
  const video = outputType ? outputType === 'video' : wantsVideo(brief);
  const wantsBeforeAfter = /before\s*(&|and|\/|-|to)?\s*after/i.test(brief);
  const fields = noProduct ? [] : [
    { key: 'productImage', label: 'Product image', type: 'image', required: true, help: 'A clear photo of the product.' }
  ];
  let prompt;
  if (wantsBeforeAfter) {
    fields.push(
      { key: 'modelImage', label: 'Model reference photo', type: 'image', required: false, help: 'Optional: a photo of the model to use.' },
      { key: 'beforeScene', label: 'What does the "before" show?', type: 'textarea', required: true, placeholder: 'e.g. dull, tired-looking skin' },
      { key: 'afterScene', label: 'What does the "after" show?', type: 'textarea', required: true, placeholder: 'e.g. fresh, even, glowing skin' },
      { key: 'subject', label: 'Who is in the image?', type: 'text', required: false, placeholder: 'e.g. woman in her late 20s' }
    );
    prompt = video
      ? 'One continuous, natural, realistic clip of {{subject}} (if a model reference image is supplied, use that person). It starts showing: {{beforeScene}}, and gradually, believably transforms into: {{afterScene}}. Same person, pose, framing, lighting and neutral background throughout. The product from the supplied product image appears naturally near the end, exactly as supplied. Slow, gentle camera move.'
      : 'One natural, realistic photograph divided into two equal side-by-side panels with a thin clean divider. Both panels show the same person ({{subject}}; if a model reference image is supplied, use that person) with identical face, pose, framing, lighting and neutral background. Left panel (before): {{beforeScene}}. Right panel (after): a realistic, believable improvement: {{afterScene}}. The product from the supplied product image appears naturally in the right panel only, exactly as supplied.';
  } else {
    fields.push({ key: 'idea', label: 'Describe the creative', type: 'textarea', required: true, placeholder: video ? 'What should happen in the video?' : 'What should the image show?' });
    prompt = `${video ? 'Premium advertising video.' : 'Premium advertising photograph.'} ${clip(brief, 400)} Specific request: {{idea}}.${noProduct ? '' : ' The product from the supplied product image appears exactly as supplied.'}`;
  }
  return {
    name: wantsBeforeAfter ? 'Before & After' : 'Custom creative',
    description: wantsBeforeAfter ? `A single before-and-after ${video ? 'video' : 'image'} from one product photo.` : 'A creative made from your brief.',
    icon: '',
    output: video ? 'video' : 'image',
    fields,
    steps: [{ key: 'creative', label: video ? 'Video' : 'Image', prompt, imageInputs: wantsBeforeAfter ? ['productImage', 'modelImage'] : noProduct ? [] : ['productImage'], useSteps: [], aspect: video ? 'portrait' : wantsBeforeAfter ? 'landscape' : 'portrait', variants: 1, ...(video ? { seconds: 5 } : {}) }]
  };
}

/**
 * Text printed on an image reference becomes form fields (the customer types it) plus overlay blocks (code
 * draws it in the same place and style). The image itself is told to leave that area clean.
 */
export function overlayFromLayout(layout, takenKeys = new Set()) {
  const fields = [];
  const blocks = [];
  const taken = new Set(takenKeys);
  (Array.isArray(layout) ? layout : []).slice(0, 8).forEach((b, i) => {
    const kind = b?.kind === 'list' ? 'list' : 'text';
    const label = clip(b?.label, 40) || (kind === 'list' ? 'Key points' : i === 0 ? 'Headline' : `Text ${i + 1}`);
    const key = cleanKey(label, taken, `text${i + 1}`);
    const example = String(b?.example ?? '').replace(/\*\*/g, '').slice(0, 160);
    fields.push({
      key, label, type: kind === 'list' ? 'textarea' : 'text', required: i === 0 && kind === 'text',
      help: kind === 'list' ? 'One point per line. Put **double asterisks** around words to make them bold.' : 'Shown on the image. Put **double asterisks** around words to make them bold.',
      placeholder: example.split('\n')[0] ? (kind === 'list' ? example.replace(/\n/g, ' / ').slice(0, 100) : example.slice(0, 100)) : ''
    });
    blocks.push({ ...b, kind, fieldKey: key });
  });
  if (!blocks.length) return { fields: [], blocks: [], zone: '' };
  const boxes = blocks.map((b) => b.box).filter((x) => Array.isArray(x) && x.length === 4).map((x) => x.map(Number));
  const l = Math.max(0, Math.min(...boxes.map((x) => x[0])) - 2);
  const t = Math.max(0, Math.min(...boxes.map((x) => x[1])) - 2);
  const r = Math.min(100, Math.max(...boxes.map((x) => x[2])) + 2);
  const bt = Math.min(100, Math.max(...boxes.map((x) => x[3])) + 2);
  const zone = `the area from ${Math.round(l)}% to ${Math.round(r)}% across the frame and ${Math.round(t)}% to ${Math.round(bt)}% down`;
  return { fields, blocks, zone };
}


// Rough colour name for a hex value (used when the image model is asked to write the text itself).
function colourWord(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 'white';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  if (max < 60) return 'black';
  if (max - min < 28) return max > 200 ? 'white' : max > 120 ? 'grey' : 'dark grey';
  if (r > 190 && g > 140 && b < 150 && r >= g) return g > 190 ? 'pale yellow' : 'warm gold';
  if (r >= g && r >= b) return g > b + 40 ? (r > 200 ? 'orange' : 'brown') : 'red';
  if (g >= r && g >= b) return 'green';
  return 'blue';
}

/** Describes the reference text so the image model writes it itself (text mode "ai"). */
function textInstructions(blocks) {
  const lines = blocks.map((b) => {
    const [l, t, r, bt] = b.box.map(Number);
    const where = `${Math.round(l)}-${Math.round(r)}% across and ${Math.round(t)}-${Math.round(bt)}% down the frame`;
    const style = `${b.font === 'serif' ? 'elegant serif' : 'clean modern sans-serif'}, ${b.weight === 'bold' ? 'bold' : 'regular weight'}${b.uppercase ? ', ALL CAPITAL LETTERS' : ''}, ${colourWord(b.color)} colour, ${b.align || 'left'}-aligned`;
    if (b.kind === 'list') return `- A list, one item per line, in ${where}, in ${style}. Each item has a small round ${colourWord(b.bulletColor || b.color)} bullet dot before it${b.divider ? ' and a thin horizontal divider line between items' : ''}. The items are exactly: {{${b.fieldKey}}}`;
    return `- One line of text in ${where}, in ${style}. The text is exactly: "{{${b.fieldKey}}}"`;
  });
  return `Typeset this text on the image, spelled exactly as given, with sharp, legible lettering and nothing misspelt or invented (words wrapped in ** are bold, never print the asterisks):\n${lines.join('\n')}\n${GENERIC_STRICT_TEXT}`;
}

function referenceBlock(analysis, kind, overlay = null, textMode = 'ai') {
  const k = kind === 'video' ? 'video' : 'image';
  return `REFERENCE ${k.toUpperCase()} ANALYSIS - the admin uploaded a reference ${k} and wants the final creative to be as SIMILAR to it as possible: same composition and framing, camera, lighting, colour palette, finish, style and mood${k === 'video' ? ', pacing, motion and timeline' : ''}.
Rules for using it:
- Design ONLY the form fields a customer must supply to recreate this look. Add a product image field (key "productImage") ONLY IF the analysis says a product (pack, bottle, tube, device, garment) is clearly shown in the reference. If the PRODUCT section says no product is shown, or only texture / swatches / applied makeup, do NOT add any product image field and do not mention a supplied product image in the prompt. Add an optional model reference photo (key "modelImage") only when people appear, plus plain choices that change the look (for example skin tone, makeup shade, background colour, mood). Follow "CUSTOMER INPUTS" below, but never invent an upload the reference does not need.
- If the analysis says PRODUCT-DRIVEN SCENE: YES, set "productDriven" to true and follow the PRODUCT-DRIVEN SCENES rules: the ingredient-dependent props, background and palette must be derived at generation time from the customer's own pack (read its ingredient / fragrance / variant / colours), never hard-coded from the reference. Keep only the ingredient-independent parts of the reference (camera, composition, surface, lighting, depth of field) fixed in the prompt. Do not add a field that asks for the ingredient as a required choice; the optional "heroIngredient" override is enough.
- Write the single prompt as a detailed, specific description of the reference look (scene, composition, camera, lighting, colour, style${k === 'video' ? ', motion over time' : ''}), with {{fieldKey}} placeholders for what the customer chooses. If (and only if) you added a product image field, that product replaces any product in the reference and must appear exactly as supplied.
- Do not copy brand names, logos, slogans, on-image text or any recognisable person or character from the reference. People are generic and realistic.
- Use the SUGGESTED OUTPUT only if the admin did not state an output type.
${overlay?.zone ? (textMode === 'ai' ? `- Text printed on the reference (headline, key points ...) is handled separately: the image model will write it, from form fields added afterwards. Do NOT create form fields for it and do not describe that text in the prompt; just leave room for it in ${overlay.zone}.\n` : `- Text printed on the reference (headline, key points ...) is added by software AFTER generation, in ${overlay.zone}. Do NOT create form fields for it. In the prompt say that this area is a plain, smooth, uncluttered continuation of the background (same colour and lighting) with no text, bullets, lines or graphics.\n`) : ''}
${analysis}

`;
}

/** Adds the text overlay fields/blocks and the style-reference flag, then validates the whole spec again. */
function applyReference(spec, overlayPlan, styleReference, textMode = 'ai') {
  if (!overlayPlan?.blocks?.length && !styleReference) return spec;
  const out = JSON.parse(JSON.stringify(spec));
  if (out.output === 'image' && overlayPlan?.blocks?.length) {
    const taken = new Set(out.fields.map((f) => f.key));
    const plan = overlayFromLayout(overlayPlan.blocks.map((b) => ({ ...b, label: overlayPlan.fields.find((f) => f.key === b.fieldKey)?.label })), taken);
    out.fields.push(...plan.fields);
    if (textMode === 'code') {
      out.overlay = { mode: 'code', blocks: plan.blocks };
      out.steps[0].prompt = `${out.steps[0].prompt} Keep ${overlayPlan.zone} a plain, smooth, uncluttered continuation of the background with no text, bullets, lines or graphics (text is added afterwards).`;
    } else {
      out.overlay = { mode: 'ai', blocks: plan.blocks };
      out.steps[0].prompt = `${out.steps[0].prompt}\n\n${textInstructions(plan.blocks)}`;
    }
  }
  out.styleReference = Boolean(styleReference) && out.output === 'image';
  return normalizeSpec(out);
}

/**
 * Brief -> validated spec. With `current` + `instruction` it edits an existing spec instead.
 * @returns {Promise<{spec: object, note: string}>}
 */
export async function designSpec({ brief, current = null, instruction = '', outputType = '', referenceAnalysis = '', referenceKind = '', referenceLayout = null, styleReference = false, textMode = 'ai' }) {
  const overlayPlan = referenceLayout && referenceKind === 'image' ? overlayFromLayout(referenceLayout, new Set()) : null;
  const forced = outputType === 'video' ? 'video' : outputType === 'image' ? 'image' : '';
  const prompt = current
    ? `BRIEF:\n${brief}\n\nCURRENT SPEC (JSON):\n${JSON.stringify(current)}\n\nCHANGE REQUEST FROM THE ADMIN:\n${instruction}\n\nApply the change and return the complete updated spec JSON.`
    : `BRIEF:\n${brief || 'Recreate the reference creative for the customer\'s own product.'}\n\n${referenceAnalysis ? referenceBlock(referenceAnalysis, referenceKind, overlayPlan, textMode) : ''}${forced ? `OUTPUT TYPE (chosen by the admin, do not change it): the output is ONE ${forced}. Set "output" to "${forced}".\n\n` : ''}${FEATURE_SYSTEM_TAIL}`;
  let note = '';
  for (const model of ['claude', 'auto']) {
    try {
      const { text, modelUsed } = await router.generateText({ model, system: SPEC_SYSTEM_PROMPT, prompt, maxTokens: 4500, purpose: 'custom feature design' });
      if (modelUsed === 'placeholder') { note = 'The AI text model is not set up yet.'; continue; }
      let parsed = parseJson(text);
      if (!current && Array.isArray(parsed.steps) && parsed.steps.length > 1) {
        // The output must be ONE image or video: ask once more, otherwise move on (next model / starter template).
        note = 'The AI returned more than one output for this brief.';
        const again = await router.generateText({ model, system: SPEC_SYSTEM_PROMPT, prompt: `${prompt}\n\nIMPORTANT: the output must be exactly ONE image or ONE video. Return "steps" with exactly ONE entry and describe the whole creative inside that single prompt (for before/after: two panels in one image).`, maxTokens: 4500, purpose: 'custom feature design' });
        parsed = parseJson(again.text);
        if (!Array.isArray(parsed.steps) || parsed.steps.length !== 1) continue;
      }
      if (forced) parsed.output = forced;
      let spec = normalizeSpec(parsed);
      spec = applyReference(spec, overlayPlan, styleReference, textMode);
      return { spec, note: '' };
    } catch (err) {
      note = err.message;
    }
  }
  if (current) throw new Error(`The AI could not apply that change${note ? ` (${note})` : ''}. Try rephrasing it, or edit the spec by hand.`);
  return { spec: applyReference(normalizeSpec(fallbackSpec(brief || referenceAnalysis.slice(0, 400), forced, /NO PRODUCT SHOWN/i.test(referenceAnalysis))), overlayPlan, styleReference, textMode), note: `AI design unavailable${note ? ` (${note})` : ''} - a starter template was used. Edit it, or press "Redesign with AI" once the AI is set up.` };
}

// ------------------------------------------------------------------ running

const IMAGE_ALIASES = new Set(['gpt', 'openai', 'chatgpt', 'gemini', 'google', 'seedream', 'bytedance']);
async function workspaceImageModel() {
  try {
    const s = await getSettings();
    const m = String(s?.imageModel || 'auto').toLowerCase();
    return IMAGE_ALIASES.has(m) ? m : 'auto';
  } catch {
    return 'auto';
  }
}

const mimeOf = (p) => ({ '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(p).toLowerCase()] || 'image/png');

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

const patchStep = (runId, i, fields) =>
  CustomFeatureRun.updateOne({ _id: runId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`steps.${i}.${k}`, v])) });
const setRun = (runId, fields) => CustomFeatureRun.updateOne({ _id: runId }, { $set: fields });

/** Creates the run document with each step's prompt filled in from the person's inputs. */
export async function createRun({ feature, userId, inputs, filesByField, isTest }) {
  const spec = normalizeSpec(feature.spec);
  const steps = spec.steps.map((s) => ({
    key: s.key,
    label: s.label,
    status: 'pending',
    prompt: fillTemplate(s.prompt, spec, inputs),
    variants: [],
    selected: 0
  }));
  return CustomFeatureRun.create({
    feature: feature._id,
    featureName: feature.name,
    featureVersion: feature.specVersion,
    isTest: Boolean(isTest),
    user: userId,
    status: 'running',
    stage: 'Starting',
    inputs,
    files: Object.fromEntries(Object.entries(filesByField).map(([k, arr]) => [k, arr.map((f) => f.filename)])),
    specSnapshot: spec,
    steps
  });
}

function referencesFor(run, specStep) {
  const refs = [];
  const notes = [];
  const fieldLabel = new Map((run.specSnapshot.fields || []).map((f) => [f.key, f.label]));
  for (const k of specStep.imageInputs || []) {
    for (const name of run.files?.[k] || []) {
      const abs = resolveUploadPath(name);
      if (abs && fs.existsSync(abs)) {
        refs.push({ filePath: abs, mimeType: mimeOf(abs), filename: path.basename(abs) });
        notes.push(`reference image ${refs.length} is the supplied "${fieldLabel.get(k) || k}"`);
      }
    }
  }
  for (const k of specStep.useSteps || []) {
    const st = run.steps.find((s) => s.key === k);
    const url = st?.variants?.[st.selected]?.url;
    const abs = url ? resolveUploadPath(url) : '';
    if (abs && fs.existsSync(abs)) {
      refs.push({ filePath: abs, mimeType: mimeOf(abs), filename: path.basename(abs) });
      notes.push(`reference image ${refs.length} is the already-created "${st.label}" image - keep the same person/subject identity, face, hairstyle, clothing, camera framing, lighting and background unless the instructions above change them`);
    }
  }
  return { refs, refNote: notes.length ? `Reference images, in order: ${notes.join('; ')}.` : '' };
}

// The reference image of a feature built from one, written to a temp file once per feature version.
async function styleReferenceFile(run) {
  const f = await CustomFeature.findById(run.feature).select('+referenceImage');
  if (!f?.referenceImage?.length) return null;
  const file = path.join(os.tmpdir(), `featref-${f._id}-${f.updatedAt ? new Date(f.updatedAt).getTime() : 0}.jpg`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, f.referenceImage);
  return file;
}

const STYLE_GUIDE_NOTE_PRODUCT_DRIVEN = 'The LAST reference image is a LAYOUT AND STYLE GUIDE only: match its composition, framing, camera distance, product position, surface material, lighting, depth of field, colour grade and mood. Do NOT copy its props, plants, flowers, background scenery or colour palette: those must come from the supplied product itself. Read the supplied pack, find its hero ingredient / fragrance / variant and pack colours, and build the props and background from that instead. Do not copy any text, logos or the product from the guide.';

const STYLE_GUIDE_NOTE = 'The LAST reference image is a LAYOUT AND STYLE GUIDE only: match its composition, framing, crop, camera distance, subject position, lighting, background, colour grade and mood as closely as possible. Do NOT copy the face or identity of the person in it, and do not copy any text, logos or products from it. If a model photo was supplied, use that person; otherwise create a different, natural-looking person.';

// When the customer supplied a photo of a person (the "model" photo), the feature's own layout guide must not bring its own
// person into the result. The guide is then passed blurred: composition, framing, light and colour survive, a face does not.
const PERSON_FIELD = /model|person|face|portrait|selfie|woman|man\b/i;
function suppliedPersonPhoto(run) {
  const label = new Map((run.specSnapshot.fields || []).map((f) => [f.key, f.label]));
  return Object.entries(run.files || {}).some(([k, names]) => (names || []).length && PERSON_FIELD.test(`${k} ${label.get(k) || ''}`));
}

async function blurredGuideFile(file) {
  const out = file.replace(/\.jpg$/i, '-blur.jpg');
  if (!fs.existsSync(out)) {
    const { default: sharp } = await import('sharp');
    await sharp(file).resize({ width: 512, height: 512, fit: 'inside' }).blur(14).jpeg({ quality: 80 }).toFile(out);
  }
  return out;
}

const STYLE_GUIDE_NOTE_WITH_PERSON = 'The LAST reference image is a deliberately blurred LAYOUT GUIDE only. Take from it just the composition, framing, crop, camera distance, subject position, lighting, background colour and mood. The person in it is a different, unrelated person and must NOT appear: IDENTITY PRIORITY (non-negotiable): the woman or man in the finished image must be exactly the person in the supplied model photo, with her/his own face, skin tone, hair and expression, and nobody else. Do not copy any text, logos or products from the guide.';

async function makeVariant({ run, specStep, runStep, variantIdx, total, model, usageContext }) {
  const { refs, refNote } = referencesFor(run, specStep);
  const userRefs = refs.length;
  let styleNote = '';
  if (run.specSnapshot.styleReference) {
    try {
      let file = await styleReferenceFile(run);
      const personPhoto = !run.specSnapshot.productDriven && suppliedPersonPhoto(run);
      if (file && personPhoto) file = await blurredGuideFile(file);
      if (file) {
        refs.push({ filePath: file, mimeType: 'image/jpeg', filename: 'layout-guide.jpg' });
        const note = personPhoto ? STYLE_GUIDE_NOTE_WITH_PERSON : run.specSnapshot.productDriven ? STYLE_GUIDE_NOTE_PRODUCT_DRIVEN : STYLE_GUIDE_NOTE;
        styleNote = note.replace('LAST reference image', refs.length > 1 ? 'LAST reference image' : 'reference image');
      }
    } catch (err) {
      console.warn('[custom-feature] could not load the style reference:', err.message);
    }
  }
  const size = SIZES[specStep.aspect] || SIZES.portrait;
  // Generation-time instructions are added here and never stored inside run.steps[].prompt.
  const prompt = [runStep.prompt, refNote, styleNote, ruleText('customStepGuard'), total > 1 ? VARIANT_HINT(variantIdx, total) : ''].filter(Boolean).join(' ');
  const img = await router.generateImage({
    model,
    prompt,
    size: size.size,
    quality: 'high',
    referenceImages: refs,
    purpose: `custom feature "${run.featureName}" - ${runStep.label}`,
    // High fidelity only protects the customer's own photos; the style guide must not be copied pixel for pixel.
    inputFidelity: userRefs ? 'high' : undefined
  });
  if (img.placeholder) throw new Error(img.note || 'The AI image model is not available.');
  const url = await saveGeneratedImage(img, size.ratio);
  logUsageSafely(usageContext, {
    type: 'image',
    provider: img.modelUsed,
    estimatedCostUsd: estimateImageCostUsdByProvider(img.modelUsed, 'high'),
    imageUrl: url
  });
  return url;
}

/** Steps grouped so each group only depends on earlier groups; a group runs in parallel. */
function levelGroups(spec) {
  const level = new Map();
  for (const s of spec.steps) level.set(s.key, s.useSteps.length ? 1 + Math.max(...s.useSteps.map((k) => level.get(k) ?? 0)) : 0);
  const groups = [];
  for (const s of spec.steps) (groups[level.get(s.key)] ||= []).push(s);
  return groups.filter(Boolean);
}


// Veo and others generate sound by default and refuse clips whose audio trips a filter: ask for none.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Video output: one clip, started from the first supplied image when there is one (image-to-video). */
async function runVideo(runId, usageContext) {
  const run = await CustomFeatureRun.findById(runId);
  const specStep = run.specSnapshot.steps[0];
  const runStep = run.steps[0];
  if (runStep.status === 'done' && runStep.variants.length) return composeFinal(runId); // finished earlier - never pay twice
  await patchStep(runId, 0, { status: 'running', note: '', variants: [], selected: 0 });
  await setRun(runId, { status: 'running', stage: 'Creating video (this can take a few minutes)', error: '' });
  try {
    const { refs } = referencesFor(run, specStep);
    const imagePath = refs[0]?.filePath;
    const prompt = [runStep.prompt, imagePath ? ruleText('sceneProductLock') : '', ruleText('sceneMotionGuard'), ruleText('videoSilent')].filter(Boolean).join(' ');
    const seconds = specStep.seconds === 10 ? 10 : 5;
    const aspectRatio = specStep.aspect === 'landscape' ? '16:9' : '9:16';

    // A provider can refuse after accepting the job (e.g. a safety / audio filter). Try again, then try the
    // other configured video models, before giving up. Only a finished video is logged as usage.
    const configured = Object.entries(videoProviderStatus()).filter(([, ok]) => ok).map(([k]) => k);
    const tried = [];
    let url = '';
    let lastError = '';
    for (let attempt = 0; attempt < 3 && !url; attempt++) {
      const provider = attempt === 0 ? 'auto' : (configured.find((k) => !tried.includes(k)) || tried[tried.length - 1] || 'auto');
      try {
        if (attempt > 0) await setRun(runId, { stage: 'Trying again with a different setting' });
        const sub = await submitVideoJob({ provider, prompt, aspectRatio, durationSeconds: seconds, imagePath });
        if (!sub.submitted) throw new Error(sub.note || 'The video model did not accept the job.');
        if (sub.provider) tried.push(sub.provider);
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline && !url) {
          await sleep(5000);
          const r = await checkVideoJob({ provider: sub.provider, externalJobId: sub.externalJobId, providerMeta: sub.providerMeta });
          if (r.status === 'failed') throw new Error(r.note || 'Video generation failed.');
          if (r.status === 'completed') {
            const res = await fetch(r.videoUrl);
            if (!res.ok) throw new Error(`Could not download the video (${res.status}).`);
            const name = `gen-${uuidv4()}.mp4`;
            fs.writeFileSync(path.join(uploadDir(), `${name}.part`), Buffer.from(await res.arrayBuffer()));
            fs.renameSync(path.join(uploadDir(), `${name}.part`), path.join(uploadDir(), name));
            url = uploadUrl(name);
            await logVideoUsage(usageContext, { provider: sub.provider, externalJobId: sub.externalJobId, requestedSeconds: seconds });
            await attachVideoUrl(sub.externalJobId, url, r.usage);
          }
        }
        if (!url) throw new Error('Video generation timed out.');
      } catch (err) {
        lastError = String(err.message || err);
        console.warn(`[custom-feature] video attempt ${attempt + 1} failed:`, lastError.slice(0, 200));
      }
    }
    if (!url) throw new Error(`${lastError.slice(0, 220) || 'Video generation failed.'} Reword the prompt (avoid speech or people talking) and test again.`);
    await CustomFeatureRun.updateOne({ _id: runId }, { $push: { 'steps.0.variants': { url } } });
    await patchStep(runId, 0, { status: 'done', note: '' });
    await composeFinal(runId);
  } catch (err) {
    const msg = String(err.message || err).slice(0, 300);
    await patchStep(runId, 0, { status: 'failed', note: msg });
    await setRun(runId, { status: 'failed', stage: 'Failed', error: msg });
  }
}

/**
 * Generates every step that is not done yet (so "Try again" re-uses finished images instead of paying twice).
 * Ends in 'review' (several options to pick from), 'completed' (composed) or 'failed'.
 */
export async function runPipeline(runId, usageContext) {
  try {
    const first = await CustomFeatureRun.findById(runId);
    if (!first) return;
    const spec = first.specSnapshot;
    if (spec.output === 'video') return await runVideo(runId, usageContext);
    const model = await workspaceImageModel();
    await setRun(runId, { status: 'running', stage: 'Creating images', error: '' });

    let firstError = '';
    for (const group of levelGroups(spec)) {
      const run = await CustomFeatureRun.findById(runId); // fresh: earlier groups' results are references now
      const tasks = [];
      const touched = [];
      for (const specStep of group) {
        const idx = run.steps.findIndex((s) => s.key === specStep.key);
        const runStep = run.steps[idx];
        if (runStep.status === 'done' && runStep.variants.length) continue;
        const depsOk = (specStep.useSteps || []).every((k) => run.steps.find((s) => s.key === k)?.status === 'done');
        if (!depsOk) {
          await patchStep(runId, idx, { status: 'failed', note: 'Skipped because an earlier image was not created.' });
          continue;
        }
        await patchStep(runId, idx, { status: 'running', note: '', variants: [], selected: 0 });
        touched.push({ idx, specStep });
        for (let v = 0; v < specStep.variants; v++) tasks.push({ idx, specStep, runStep, v, total: specStep.variants });
      }
      if (!tasks.length) continue;
      await setRun(runId, { stage: `Creating ${group.map((g) => g.label).join(' + ')}` });
      const results = await pool(tasks, 3, async (t) => {
        try {
          const url = await makeVariant({ run, specStep: t.specStep, runStep: t.runStep, variantIdx: t.v, total: t.total, model, usageContext });
          await CustomFeatureRun.updateOne({ _id: runId }, { $push: { [`steps.${t.idx}.variants`]: { url } } });
          return { ok: true };
        } catch (err) {
          return { ok: false, message: String(err.message || err) };
        }
      });
      for (const { idx, specStep } of touched) {
        const mine = results.filter((_r, i) => tasks[i].idx === idx);
        const okCount = mine.filter((r) => r.ok).length;
        if (okCount === 0) {
          const msg = (mine.find((r) => !r.ok)?.message || 'Image generation failed.').slice(0, 220);
          firstError ||= msg;
          await patchStep(runId, idx, { status: 'failed', note: msg });
        } else {
          await patchStep(runId, idx, { status: 'done', note: okCount < specStep.variants ? `${okCount} of ${specStep.variants} options were created.` : '' });
        }
      }
    }

    const done = await CustomFeatureRun.findById(runId);
    if (done.steps.some((s) => s.status !== 'done')) {
      await setRun(runId, { status: 'failed', stage: 'Failed', error: firstError || 'Some images could not be created. Press "Try again" - finished images are kept.' });
      return;
    }
    if (done.steps.some((s) => s.variants.length > 1)) {
      await setRun(runId, { status: 'review', stage: 'Pick your favourites' });
      return;
    }
    await composeFinal(runId);
  } catch (err) {
    console.warn('[custom-feature] run failed:', err.message);
    await setRun(runId, { status: 'failed', stage: 'Failed', error: String(err.message || err).slice(0, 400) }).catch(() => {});
  }
}

/** Assembles the final creative from the chosen image of each step. */
export async function composeFinal(runId) {
  try {
    await setRun(runId, { status: 'composing', stage: 'Putting the final creative together', error: '' });
    const run = await CustomFeatureRun.findById(runId);
    const comp = run.specSnapshot.composition || { mode: 'none', stepKeys: [] };
    const picks = comp.stepKeys.map((k) => run.steps.find((s) => s.key === k)).filter(Boolean).map((s) => s.variants[s.selected]?.url).filter(Boolean);
    if (!picks.length) throw new Error('There are no images to put together.');

    let finalUrl;
    if (comp.mode === 'none' || picks.length < 2) {
      finalUrl = picks[0];
    } else {
      const paths = picks.map((u) => resolveUploadPath(u));
      if (paths.some((p) => !p || !fs.existsSync(p))) throw new Error('One of the generated images is missing from storage.');
      const buf = await composeCreative({ imagePaths: paths, labels: comp.labels, mode: comp.mode, showLabels: comp.showLabels, disclaimer: comp.disclaimer, background: comp.background });
      const name = `gen-${uuidv4()}.jpg`;
      fs.writeFileSync(path.join(uploadDir(), name), buf);
      finalUrl = uploadUrl(name);
    }
    // Text printed on the reference is drawn here by code, in the same place and style (image output only).
    const blocks = run.specSnapshot.output !== 'video' && run.specSnapshot.overlay?.mode !== 'ai' ? run.specSnapshot.overlay?.blocks || [] : [];
    if (blocks.length) {
      try {
        const src = resolveUploadPath(finalUrl);
        if (src && fs.existsSync(src)) {
          const buf = await renderOverlay({ imagePath: src, blocks, values: run.inputs || {} });
          const name = `gen-${uuidv4()}.jpg`;
          fs.writeFileSync(path.join(uploadDir(), name), buf);
          finalUrl = uploadUrl(name);
        }
      } catch (err) {
        console.warn('[custom-feature] adding text failed, keeping the image without it:', err.message);
      }
    }
    await setRun(runId, { status: 'completed', stage: 'Done', finalUrl });

    if (run.isTest) {
      // A successful test of the CURRENT spec version unlocks publishing (see the controller's publish rule).
      await CustomFeature.updateOne({ _id: run.feature, specVersion: run.featureVersion }, { $set: { lastTestedVersion: run.featureVersion, lastTestedAt: new Date() } });
    }
  } catch (err) {
    console.warn('[custom-feature] compose failed:', err.message);
    await setRun(runId, { status: 'failed', stage: 'Failed', error: String(err.message || err).slice(0, 400) }).catch(() => {});
  }
}

/** Boot task: runs that were mid-flight when the server stopped can never finish. */
export async function recoverStaleFeatureRuns() {
  await unscoped(async () => CustomFeatureRun.updateMany(
    { status: { $in: ['running', 'composing'] } },
    { $set: { status: 'failed', stage: 'Interrupted', error: 'The server restarted while this was being made. Press "Try again" - images that already finished are re-used, not paid for twice.' } }
  ));
}
