// The photography guide: a customer's written direction on HOW PHOTOGRAPHS should look (people, skin, styling,
// products, ingredients, light, lens). The super admin uploads a .md file (Brand Assets -> Brand guide -> Photography
// guide); the file is sorted into a few editable fields (people / product / avoid ...) stored on Customer.brandKit.guide.photography.
// The wording is the file's own: nothing is summarised or rewritten (see utils/photographyMd.js and services/ai/photographyService.js).
//
// Scope is deliberately narrow. It shapes the photographic content of an image and nothing else: it never carries
// typography, text, logos, packaging labels, layout, grid, aspect ratio or where elements sit. Those are kept out in
// three places: the condensing prompt (services/ai/photographyService.js), scrubPhotoText() below (runs on everything
// that is saved), and the wording of the prompt line itself (photographyLines()).

export const PHOTO_TEXT_LIMITS = {
  look: 800,
  people: 7000,
  product: 7000,
  avoid: 1200,
  modelSuffix: 800,
  productSuffix: 800
};
export const PHOTO_SOURCE_LIMIT = 60000;
const FILE_NAME_LIMIT = 120;

// A sentence or clause that mentions any of these is about type, layout, branding or post-production, not photography.
const OFF_TOPIC = new RegExp(
  [
    'fonts?', 'typefaces?', 'typograph\\w*', 'lettering', 'headlines?', 'sub-?headlines?', 'captions?', 'copy', 'copywriting',
    'text', 'logos?', 'wordmarks?', 'watermarks?', 'labels?', 'unlabell?ed', 'packaging', 'packshots?',
    'layouts?', 'grid', 'aspect ratios?', '\\d{1,2}\\s?:\\s?\\d{1,2}', '--ar', 'negative space', 'empty space', 'open space',
    'space for', 'room for', 'leave (?:the |some )?(?:space|room)', 'composit(?:e|ed|ing)', 'cut-?outs?', 'graphic elements?',
    'in design', 'in post', 'post-production'
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i'
);

const LIST_KEYS = new Set(['avoid', 'modelSuffix', 'productSuffix']);
const txt = (v) => (typeof v === 'string' ? v.replace(/\r/g, '').trim() : '');
const oneLine = (v) => txt(v).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');

/**
 * Removes anything that is not photographic direction. Works sentence by sentence (and on "; " clauses), so one stray
 * sentence about a headline does not cost the rest of the paragraph. Also strips hex codes, backticks, [placeholders]
 * and aspect-ratio flags. Returns { text, dropped } so the caller can say how much was left out.
 */
export function scrubPhotoText(input, { list = false, scope = true } = {}) {
  const raw = oneLine(input)
    .replace(/`+/g, '')
    // Template placeholders from prompt-writing guides ([SUBJECT], [PRODUCT: ...]) are removed; ordinary [a / b] options become (a / b).
    .replace(/\[(?:PRODUCT|MODEL SUFFIX|PRODUCT SUFFIX|SUBJECT|ACTION|BACKDROP|FRAMING|LIGHT|COLOUR|COLOR|STYLE SUFFIX|ASPECT RATIO)[^\]]*\]/g, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/#[0-9a-f]{3,8}\b/gi, '')
    .replace(/--ar\s*\d+\s*:\s*\d+/gi, '')
    .replace(/\s+([.,;:])/g, '$1');
  // Comma lists (negative prompts, style suffixes) are filtered item by item; prose is filtered sentence by sentence.
  const parts = list ? raw.split(/,\s*/) : raw.split(/(?<=[.!?])\s+/).flatMap((s) => (s.length > 220 ? s.split(/;\s+/) : [s]));
  const kept = [];
  let dropped = 0;
  const droppedItems = [];
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (scope && OFF_TOPIC.test(s)) { dropped++; droppedItems.push(s); continue; }
    kept.push(s);
  }
  return { text: kept.join(list ? ', ' : ' ').replace(/\s{2,}/g, ' ').trim(), dropped, droppedItems };
}

const cutAt = (s, n) => {
  if (s.length <= n) return s;
  const slice = s.slice(0, n);
  // Prefer to stop at the end of a sentence so a long field loses whole sentences, not half of one.
  const sentence = slice.lastIndexOf('. ');
  if (sentence > n * 0.6) return slice.slice(0, sentence + 1);
  const end = Math.max(sentence, slice.lastIndexOf('; '), slice.lastIndexOf(', '));
  return (end > n * 0.6 ? slice.slice(0, end) : slice).replace(/[,;\s]+$/, '');
};

/** Only the keys that were actually sent come back, so a partial save never wipes other fields. */
export function cleanPhotography(input) {
  const body = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, max] of Object.entries(PHOTO_TEXT_LIMITS)) {
    if (typeof body[key] === 'string') out[key] = cutAt(scrubPhotoText(body[key], { list: LIST_KEYS.has(key), scope: key !== 'avoid' }).text, max);
  }
  if (typeof body.fileName === 'string') out.fileName = oneLine(body.fileName).slice(0, FILE_NAME_LIMIT);
  if (typeof body.source === 'string') out.source = txt(body.source).slice(0, PHOTO_SOURCE_LIMIT);
  return out;
}

// A field read into a prompt always ends like a sentence, so the line that follows it never runs on.
const stop = (s) => { const t = oneLine(s); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

const hasAny = (p) => Boolean(p && Object.keys(PHOTO_TEXT_LIMITS).some((k) => txt(p[k])));

export function photographyIsEmpty(kit) {
  return !hasAny(kit?.guide?.photography);
}

/**
 * Prompt sentences for image requests. Each is one line with no prefix (callers add their own).
 *   people: 'include' | 'auto' | 'none'  - from the brief's People setting. 'none' leaves every people line out.
 *   compact: only the one-line look (used when planning creative directions, where the full detail would be noise)
 * The wording tells the model what this does NOT control, so it cannot be read as typography or layout guidance.
 */
export function photographyLines(kit, { people = 'auto', compact = false } = {}) {
  const p = kit?.guide?.photography;
  if (!hasAny(p)) return [];
  const out = [];
  const add = (s) => { if (s) out.push(s); };
  const look = stop(p.look);

  add(`Photography direction for any photographed people, products or ingredients in this image (it controls how they are shot, lit and styled only, and never the fonts, text, logo, layout or placement of elements): ${look || 'follow the details below.'}`);
  if (compact) return out;

  if (people !== 'none' && oneLine(p.people)) {
    add(`When a person is shown: ${stop(p.people)} These are defaults; the People settings of this brief win wherever they say something different.`);
  }
  if (oneLine(p.product)) add(`When a product or ingredients are shown: ${stop(p.product)} Keep the product's own packaging, label and colours exactly as supplied.`);
  const finish = people === 'include' ? oneLine(p.modelSuffix) || oneLine(p.productSuffix) : oneLine(p.productSuffix) || oneLine(p.modelSuffix);
  add(finish && `Photographic finish: ${finish}`);
  add(oneLine(p.avoid) && `Avoid in the photography: ${oneLine(p.avoid)}`);
  return out;
}
