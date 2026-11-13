import { generateText } from './router.js';
import { extractJsonObject } from './brandAnalysisService.js';
import { PHOTO_SOURCE_LIMIT, PHOTO_TEXT_LIMITS, cleanPhotography, scrubPhotoText } from '../../utils/photographyGuide.js';
import { splitUnits, assembleFields } from '../../utils/photographyMd.js';

// "Photography guide": the super admin uploads a .md describing how photographs should look. The file is cut into numbered units
// (sentences, list items, table rows, code lines) and the AI only SORTS them by number into people / product / look / avoid / finishing
// lines. It never writes or rewrites any text, so the wording that reaches the editor (and image prompts) is the file's own.
// Nothing is saved here: the editor shows the result and "Save brand guide" stores it. See utils/photographyGuide.js for how the
// fields reach image prompts and what is kept out.

const SYSTEM = 'You sort numbered lines of a photography style document into categories. You output only JSON containing line numbers. You never write or change any line.';
const UNIT_CLIP = 220;

function buildPrompt({ units, brandName }) {
  const list = units.map((u) => `${u.id} | ${u.section} | ${u.kind === 'code' ? '[code] ' : ''}${u.text.slice(0, UNIT_CLIP)}`).join('\n');
  return [
    `Below are the numbered lines of a document from ${brandName ? `the brand "${brandName}"` : 'a brand'} describing how its PHOTOGRAPHS should look. Each line is: number | section | text.`,
    'Decide which lines to include in each category, by line number only. Do NOT write, quote, shorten or reword anything: your answer contains numbers only.',
    'Categories:',
    '- "look": lines that describe the overall photographic look for every image.',
    '- "people": lines about photographing people: casting, skin and how it is rendered, hair, make-up, nails, wardrobe, jewellery, expression, hands, camera crop, lens, light and backdrop for people shots.',
    '- "product": lines about photographing products and ingredients: how ingredients are shown, set-ups, surfaces and backdrops, light, colour world, freshness, droplets, liquids, glass.',
    '- "avoid": the line(s) listing what the photographs must not look like (a negative prompt), if there is one. Use the code line that holds the list.',
    '- "modelSuffix": the single code line that is the locked style suffix for people photographs, if there is one.',
    '- "productSuffix": the single code line that is the locked style suffix for product photographs, if there is one.',
    'A line may go in more than one of look / people / product only if it genuinely applies to both (for example light that is used for people and products).',
    'LEAVE OUT (do not list them anywhere): headings; anything about typography, fonts, text, headlines, copy, logos, product labels or packaging artwork; page layout, grids, where elements or copy sit, empty space reserved for copy; aspect ratios and format sizes; compositing, design or post-production steps; advice on how to write prompts or use image tools; full example prompts and shot recipes; prompt templates; QA checklists; the instruction to leave packs unlabelled.',
    'When a line mixes photography direction with something to leave out, include it only if the photography part is the point of the line.',
    'Respond with ONLY a JSON object (no fences, no commentary) in this shape, using line numbers:',
    JSON.stringify({ look: [0], people: [1, 2], product: [3, 4], avoid: [5], modelSuffix: 6, productSuffix: 7 }),
    'Use [] or null for a category the document does not cover.',
    '',
    'LINES:',
    list
  ].join('\n');
}

/** Returns { brief, omitted, trimmed, modelUsed }. brief = look/people/product/avoid/modelSuffix/productSuffix, all in the file's own words. */
export async function readPhotographyGuide({ text, brandName = '' }) {
  const body = String(text || '').replace(/\r/g, '').trim().slice(0, PHOTO_SOURCE_LIMIT);
  if (body.length < 40) { const e = new Error('That file is empty or too short to read.'); e.status = 400; throw e; }
  const units = splitUnits(body);
  if (!units.length) { const e = new Error('No readable lines were found in that file.'); e.status = 422; throw e; }

  const { text: out, modelUsed } = await generateText({
    system: SYSTEM,
    prompt: buildPrompt({ units, brandName }),
    maxTokens: 1600,
    purpose: 'sorting the photography guide'
  });
  if (!out || modelUsed === 'placeholder' || modelUsed === 'none') {
    const e = new Error('No AI text provider is configured, so the photography guide could not be read.');
    e.noAI = true;
    throw e;
  }
  let selection;
  try {
    selection = JSON.parse(extractJsonObject(out.replace(/^```json|```$/gim, '').trim()));
  } catch {
    const e = new Error('The AI answer could not be understood. Please try again.');
    e.status = 502;
    throw e;
  }

  const { fields, usedIds } = assembleFields(units, selection);
  // The scope filter (utils/photographyGuide.js) is a second check: it can still remove a sentence about type, layout or labels.
  const omitted = [];
  const seen = new Set();
  const note = (t, why) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    if (!s || seen.has(s) || omitted.length >= 120) return;
    seen.add(s);
    omitted.push({ text: s.length > 200 ? `${s.slice(0, 200)}…` : s, why });
  };
  const checked = {};
  let trimmed = false;
  for (const [k, v] of Object.entries(fields)) {
    const r = scrubPhotoText(v, { list: ['avoid', 'modelSuffix', 'productSuffix'].includes(k), scope: k !== 'avoid' }); // an avoid list keeps items like "garbled text": they protect, not instruct
    r.droppedItems.forEach((d) => note(d, 'not about how photographs look'));
    checked[k] = r.text;
  }
  const brief = cleanPhotography(checked);
  for (const k of Object.keys(PHOTO_TEXT_LIMITS)) if ((checked[k] || '').length > (brief[k] || '').length + 2) trimmed = true;
  // Lines the AI did not choose (headings are never lines, so these are all content), except example prompts and templates which are always left out.
  units.filter((u) => !usedIds.has(u.id) && u.kind !== 'code').forEach((u) => note(u.text, 'not photography direction'));

  if (!Object.values(brief).some(Boolean)) {
    const e = new Error('No photography direction could be found in that file.');
    e.status = 422;
    throw e;
  }
  return { brief, omitted, trimmed, modelUsed };
}
