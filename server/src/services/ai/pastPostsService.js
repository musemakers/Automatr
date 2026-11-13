import sharp from 'sharp';
import { analyzeImage, generateText } from './router.js';
import { extractJsonObject } from './brandAnalysisService.js';

// Step 1 of "learn from past assets": the super admin uploads a hand-picked set of the brand's published images
//. Each image is read once, then all the notes are condensed into a short list of
// style rules. Nothing is saved here - the rules go back to the editor for review and are stored with the brand guide.

const MAX_IMAGES = 24;
const CONCURRENCY = 3;

const READ_INSTRUCTION = [
  'You are a senior art director studying one published creative asset from a brand, to learn its house style.',
  'Describe only what is visible. Respond with ONLY a JSON object (no fences, no commentary):',
  JSON.stringify({
    subject: 'what the image shows, 8 words max',
    composition: 'layout: where the subject sits, use of space, text placement, crop - one short sentence',
    colour: 'dominant colours and how they are used (background vs accents) - one short sentence',
    typography: 'any text on the image: size, weight, case, position, how much of it - one short sentence, or "none"',
    imagery: 'photo/illustration/3D/flat, lighting, mood, people or products - one short sentence',
    logo: 'whether and where the logo appears (position, size), or "none"',
    textOnImage: 'the exact headline text if there is any, otherwise ""'
  }, null, 2)
].join('\n');

async function readOne(file) {
  let buf = file.buffer;
  try {
    buf = await sharp(file.buffer).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch { /* unreadable by sharp: send the original bytes */ }
  const r = await analyzeImage({
    base64: buf.toString('base64'),
    mimeType: buf === file.buffer ? file.mimetype : 'image/jpeg',
    instruction: READ_INSTRUCTION,
    maxTokens: 500,
    purpose: 'reading a past asset'
  });
  if (!r.text) {
    const err = new Error(r.note || 'No AI provider is configured for image analysis.');
    err.noAI = true;
    err.isBillingError = r.isBillingError;
    throw err;
  }
  const parsed = JSON.parse(extractJsonObject(r.text.replace(/^```json|```$/gim, '').trim()));
  return parsed;
}

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Reads a small batch of images (the client sends them a few at a time so no request runs long).
 * Returns { notes, failed, firstError }.
 */
export async function readPastAssets(files) {
  const list = files.slice(0, 8);
  const notes = [];
  let failed = 0;
  let firstError = '';
  let fatal = null;
  let next = 0;
  async function worker() {
    while (next < list.length && !fatal) {
      const i = next++;
      try {
        const { n: _n, ...note } = { n: i, ...(await readOne(list[i])) };
        notes.push(note);
      } catch (err) {
        console.warn('[past-assets] could not read an asset:', err.message);
        if (err.noAI) fatal = err;
        else { failed++; firstError = firstError || err.message; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  if (fatal) throw fatal;
  return { notes, failed, firstError };
}

/** Condenses the per-asset notes into proposed style rules. Returns { rules, modelUsed }. */
export async function synthesizeRules({ notes, brandName = '' }) {
  notes = (Array.isArray(notes) ? notes : []).slice(0, MAX_IMAGES).map((n) => {
    const o = {};
    for (const k of ['subject', 'composition', 'colour', 'typography', 'imagery', 'logo', 'textOnImage']) o[k] = clip(n?.[k], 300);
    return o;
  });
  if (!notes.length) { const e = new Error('There is nothing to summarise yet.'); e.status = 400; throw e; }
  const prompt = [
    `Below are notes on ${notes.length} published asset${notes.length === 1 ? '' : 's'} from ${brandName ? `the brand "${brandName}"` : 'one brand'}, hand-picked by the agency as the best examples of its style. They may be social posts, banners, print, packaging or any other creative.`,
    'Find what is CONSISTENT across them (or, for one asset, what defines it) and turn that into short, specific, reusable style rules that an AI image generator and a copywriter can follow.',
    'Rules must be concrete and checkable ("Product sits right of centre on a flat pastel background", "Headlines are 3-6 words, sentence case, no punctuation"), never vague ("modern and clean").',
    notes.length === 1 ? 'There is only one asset: state the style choices it clearly shows as rules, without describing its subject matter. Do not mention it by number.' : 'Only include a rule if it holds for most of the assets. Do not describe a single asset. Do not mention asset numbers.',
    'Respond with ONLY a JSON object: {"design": ["..."], "copy": ["..."]}.',
    '"design" = 5 to 10 rules about composition, colour use, typography on the image, imagery/lighting, logo placement.',
    '"copy" = up to 4 rules about the headline text visible on the images (length, tone, case, structure, calls to action). Return [] if too few assets carry text to show a pattern.',
    'Each rule is one sentence, max 200 characters.',
    '',
    'IMAGE NOTES:',
    JSON.stringify(notes)
  ].join('\n');

  const { text, modelUsed } = await generateText({
    system: 'You distil brand style from examples into precise, short rules. You output only JSON.',
    prompt,
    maxTokens: 1500,
    purpose: 'learning brand style from past assets'
  });
  if (!text || modelUsed === 'placeholder' || modelUsed === 'none') {
    const e = new Error('No AI text provider is configured, so the style could not be summarised.');
    e.noAI = true;
    throw e;
  }
  const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
  const rules = [];
  for (const scope of ['design', 'copy']) {
    for (const r of Array.isArray(parsed[scope]) ? parsed[scope] : []) {
      const t = clip(r, 220);
      if (t) rules.push({ scope, text: t });
    }
  }
  return { rules, modelUsed };
}
