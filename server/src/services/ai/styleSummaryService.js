import fs from 'node:fs';
import sharp from 'sharp';
import { analyzeImage, generateText } from './router.js';
import { extractJsonObject } from './brandAnalysisService.js';
import { resolveUploadPath } from '../../utils/storage.js';

// "Style summary for AI image creation" (Brand Assets -> Imagery). Every reference image is read once, then the notes are
// condensed into a few short sections the super admin can review and edit. The colours shown with the colour section are
// measured from the pixels, never guessed by the model. Nothing is saved here; the controller stores the result on the profile.

const MAX_IMAGES = 8;
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const READ = {
  photo: [
    'You are a senior photography director studying one reference photo that shows the look a brand wants for its own photography.',
    'Describe only what is visible. Respond with ONLY a JSON object (no fences):',
    JSON.stringify({ subject: '8 words max', composition: 'framing, angle, crop, use of space - one sentence', lighting: 'light quality, direction, contrast - one sentence', people: 'how people look and act (or "none")', product: 'how products or objects are shown (or "none")', colour: 'colour mood and grading - one sentence', mood: 'feeling in 4 words' })
  ].join('\n'),
  illustration: [
    'You are an art director studying one reference illustration that shows the look a brand wants for its illustrations.',
    'Describe only what is visible. Respond with ONLY a JSON object (no fences):',
    JSON.stringify({ subject: '8 words max', shapes: 'shape language, line weight, level of detail - one sentence', shading: 'flat, gradient, texture, shadows - one sentence', characters: 'how people or characters are drawn (or "none")', colour: 'colour palette feel - one sentence', mood: 'feeling in 4 words' })
  ].join('\n')
};

const SECTIONS = {
  photo: [['look', 'Overall look'], ['composition', 'Composition and framing'], ['lighting', 'Light and colour grading'], ['people', 'People'], ['product', 'Products and objects'], ['colour', 'Colour palette']],
  illustration: [['look', 'Overall look'], ['shapes', 'Shapes and line'], ['shading', 'Shading and texture'], ['characters', 'People and characters'], ['colour', 'Colour palette']]
};

/** The 5 most common colours of an image (4 bits per channel buckets, near-greys last). */
async function dominantColours(buf, n = 5) {
  try {
    const { data } = await sharp(buf).resize(48, 48, { fit: 'inside' }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const bins = new Map();
    for (let i = 0; i < data.length; i += 3) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      bins.set(key, b);
    }
    return [...bins.values()].map((b) => {
      const r = b.r / b.n, g = b.g / b.n, bl = b.b / b.n;
      const sat = Math.max(r, g, bl) - Math.min(r, g, bl);
      return { n: b.n * (1 + sat / 128), hex: `#${[r, g, bl].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`, rgb: [r, g, bl] };
    }).sort((a, b) => b.n - a.n);
  } catch { return []; }
}

function pickPalette(all, n = 5) {
  const out = [];
  for (const c of all) {
    if (out.every((o) => Math.hypot(o.rgb[0] - c.rgb[0], o.rgb[1] - c.rgb[1], o.rgb[2] - c.rgb[2]) > 48)) out.push(c);
    if (out.length >= n) break;
  }
  return out.map((c) => c.hex);
}

async function readOne(asset, kind) {
  const buf = fs.readFileSync(resolveUploadPath(asset.filename));
  const small = await sharp(buf, { density: 96 }).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  const r = await analyzeImage({ base64: small.toString('base64'), mimeType: 'image/jpeg', instruction: READ[kind], maxTokens: 450, purpose: `style summary: reading a ${kind} reference` });
  if (!r.text) { const e = new Error(r.note || 'No AI provider is configured for image analysis.'); e.noAI = true; e.isBillingError = r.isBillingError; throw e; }
  const note = JSON.parse(extractJsonObject(r.text.replace(/^```json|```$/gim, '').trim()));
  return { note, colours: await dominantColours(small) };
}

/**
 * assets: BrandAsset docs of one style group. instructions: the super admin's own written notes for that group.
 * Returns { sections: [{id,title,text,palette}], count, at }.
 */
export async function buildStyleSummary({ assets, kind = 'photo', instructions = [], brandName = '' }) {
  const list = assets.slice(0, MAX_IMAGES);
  if (!list.length) { const e = new Error('Add at least one reference image first.'); e.status = 400; throw e; }
  const notes = [];
  const colours = [];
  let fatal = null;
  await Promise.all(list.map(async (a) => {
    try { const r = await readOne(a, kind); notes.push(r.note); colours.push(...r.colours); }
    catch (err) { console.warn('[style-summary] could not read a reference:', err.message); if (err.noAI) fatal = err; }
  }));
  if (fatal) throw fatal;
  if (!notes.length) { const e = new Error('None of the images could be read. Try again, or use different images.'); e.status = 422; throw e; }

  const secs = SECTIONS[kind];
  const prompt = [
    `Below are notes on ${notes.length} reference ${kind === 'photo' ? 'photograph' : 'illustration'}${notes.length === 1 ? '' : 's'} chosen by ${brandName ? `the brand "${brandName}"` : 'a brand'} to show the look it wants.`,
    `Write a style brief for an AI ${kind === 'photo' ? 'image' : 'illustration'} generator. Keep only what is consistent across the references (for one reference, what defines it). Never describe the subject matter of a single image and never mention image numbers.`,
    instructions.length ? `The team also wrote these instructions, which win over anything you infer: ${instructions.map((t) => clip(t, 300)).join(' | ')}` : '',
    'Be concrete and checkable. No hex codes. No brand names.',
    `Respond with ONLY a JSON object with these keys, each a string of 1 to 3 sentences (max 420 characters): ${secs.map(([id, title]) => `"${id}" (${title})`).join(', ')}.`,
    'If a key does not apply (for example no people in any reference) write "Not shown in the references."',
    '', 'NOTES:', JSON.stringify(notes)
  ].filter(Boolean).join('\n');
  const { text, modelUsed } = await generateText({ system: 'You write precise style briefs from visual notes. You output only JSON.', prompt, maxTokens: 1400, purpose: 'style summary for reference images' });
  if (!text || modelUsed === 'placeholder' || modelUsed === 'none') { const e = new Error('No AI text provider is configured, so the style summary could not be written.'); e.noAI = true; throw e; }
  const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
  const palette = pickPalette(colours.sort((a, b) => b.n - a.n));
  const sections = secs.map(([id, title]) => ({ id, title, text: clip(parsed[id], 600), palette: id === 'colour' ? palette : [] })).filter((s) => s.text);
  return { sections, count: list.length, at: new Date() };
}
