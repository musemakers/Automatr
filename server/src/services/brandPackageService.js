import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { extractJsonObject, sanitizeColors, sanitizeColorRoles } from './ai/brandAnalysisService.js';
import { cleanGuide } from '../utils/brandGuide.js';

// BRAND PACKAGES: a ZIP the agency uploads on Brand Assets instead of single files. It can be a design-system export
// (tokens.json / tokens.css, fonts, logos, photos, tone-of-voice.md, formats.md ...) or just a folder of logos, photos and
// guideline PDFs. This file does three things, and never touches the database (the controller does that):
//   openPackage()        reads the ZIP safely and sorts its files into logos, photos, docs, tokens, fonts ...
//   classifyUnknownImages()  asks the AI to say what an image is when its folder and name do not
//   interpretPackage()   asks the AI to turn the tokens + written guidelines into the brand kit and the brand guide
// Everything has a plain, no-AI fallback, so a package still imports (logos, photos, colours, fonts) when no AI is set up.

export const ZIP_MIMES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip', 'application/octet-stream']);
export function isZipUpload(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (ext === '.zip') return true;
  return ['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'multipart/x-zip'].includes(file?.mimetype);
}

const LIMITS = {
  entries: 4000,
  docBytes: 1024 * 1024,
  imageBytes: 25 * 1024 * 1024,
  logos: 24,
  photos: 20,
  textures: 10,
  layouts: 6,
  references: 6,
  pdfs: 4,
  docChars: 10000,
  docsTotalChars: 45000,
  classifyImages: 10
};

export const LOGO_VARIANTS = ['primary', 'secondary', 'icon', 'horizontal', 'stacked', 'white', 'black', 'one-colour'];
const LOGO_TYPES = ['wordmark', 'lettermark', 'symbol', 'combination', 'emblem', 'not-a-logo'];
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
export const mimeOfExt = (ext) => IMAGE_MIME[ext] || (ext === '.pdf' ? 'application/pdf' : '');
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const DOC_EXT = new Set(['.md', '.markdown', '.txt']);

// ---------------------------------------------------------------------------
// 1. Opening the ZIP
// ---------------------------------------------------------------------------

const FOLDER_KIND = [
  ['logo', /(^|\/)(logos?|wordmarks?|brand-?marks?|logotypes?)(\/|$)/i],
  ['texture', /(^|\/)(textures?|patterns?)(\/|$)/i],
  ['layout', /(^|\/)(layouts?|templates?)(\/|$)/i],
  ['reference', /(^|\/)(references?|moodboards?|inspiration)(\/|$)/i],
  ['product', /(^|\/)(photos?|photography|products?|product-?shots?|gallery|vehicles?|cars?)(\/|$)/i]
];
const IGNORED_FOLDERS = /(^|\/)(api|previews?|thumbnails?|screenshots?|icons?|node_modules)(\/|$)/i;
const LOGO_NAME = /logo|wordmark|logotype|lettermark|brandmark/i;

function kindFromPath(p) {
  for (const [kind, re] of FOLDER_KIND) if (re.test(p)) return kind;
  return LOGO_NAME.test(path.basename(p)) ? 'logo' : '';
}

/** Safe, readable list of the files in a ZIP (no path tricks, no hidden or Mac junk files, one wrapper folder removed). */
function listZipFiles(zipPath) {
  let entries;
  try {
    entries = new AdmZip(zipPath).getEntries();
  } catch {
    throw new Error('That ZIP file could not be opened. It may be damaged or password protected.');
  }
  if (entries.length > LIMITS.entries) throw new Error(`That ZIP has ${entries.length} files. Packages can hold up to ${LIMITS.entries}.`);

  let files = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    const parts = name.split('/');
    if (name.startsWith('/') || parts.includes('..') || parts.some((s) => s.startsWith('.') || s === '__MACOSX')) continue;
    files.push({ path: name, size: entry.header.size, entry });
  }
  // A package is usually one folder ("skoda-partner-design-system/..."): drop it so paths read from the package root.
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const prefix = `${[...tops][0]}/`;
    files = files.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  }
  return files.map((f) => ({
    path: f.path,
    name: path.basename(f.path),
    ext: path.extname(f.path).toLowerCase(),
    size: f.size,
    read(limit) {
      if (f.size > limit) return null;
      const buf = f.entry.getData();
      return buf.length > limit ? null : buf;
    }
  }));
}

const hex6 = (v) => {
  const m = String(v || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.slice(0, 6).toUpperCase()}`;
};

const firstFamily = (css) => (String(css || '').match(/['"]([^'"]+)['"]/)?.[1] || String(css || '').split(',')[0].replace(/['"]/g, '').trim());

/** Colours from a tokens.json: the design-system layout ({color:{tokens:[{name,value:{light,dark},usage}]}}), or any nested JSON that holds hex values. */
function colorsFromJson(json) {
  const out = [];
  const add = (name, value, usage = '') => {
    const v = hex6(value);
    if (v) out.push({ name: String(name).slice(0, 60), value: v, usage: String(usage || '').slice(0, 220) });
  };
  const list = json?.color?.tokens;
  if (Array.isArray(list)) {
    for (const t of list) {
      const val = t?.value;
      // Creatives use the light theme; dark values are for web and app surfaces.
      add(t?.name, typeof val === 'object' && val ? val.light ?? val.default ?? Object.values(val)[0] : val, t?.usage);
    }
    return out;
  }
  const walk = (node, trail) => {
    if (out.length >= 60 || !node || typeof node !== 'object') return;
    if (/dark/i.test(trail.join('.'))) return;
    const direct = node.$value ?? node.value;
    if (typeof direct === 'string' && hex6(direct)) return add(trail.join('-'), direct, node.$description || node.description);
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && hex6(v)) add([...trail, k].join('-'), v);
      else walk(v, [...trail, k]);
    }
  };
  walk(json, []);
  return out;
}

/** Colours from a tokens.css: custom properties in the light / default block, with the trailing comment kept as usage. */
function colorsFromCss(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/dark/i.test(m[1])) continue;
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;\s*(?:\/\*([^*]*)\*\/)?/g)) {
      const v = hex6(d[2]);
      if (v) out.push({ name: d[1], value: v, usage: (d[3] || '').trim().slice(0, 220) });
    }
  }
  return out;
}

function fontsFromJson(json) {
  const families = {};
  for (const [key, css] of Object.entries(json?.type?.families || {})) families[key] = firstFamily(css);
  const styles = [];
  for (const g of json?.type?.groups || []) {
    for (const s of g.styles || []) {
      styles.push({ name: s.name, family: families[s.family] || firstFamily(s.family), size: s.fontSize, weight: s.fontWeight, usage: s.usage || '' });
    }
  }
  const files = (json?.type?.fonts || []).map((f) => f.family).filter(Boolean);
  // Only the typefaces the brand actually ships or sets text in; web fallbacks (a system sans, a mono) are not the brand's fonts.
  const used = new Set([...styles.map((s) => s.family), ...files]);
  return { families: [...used].filter(Boolean), styles };
}

/** Plain-words family name from a font file name: "SKODANext-BoldItalic.ttf" -> "SKODANext". */
function familyFromFileName(file) {
  return file.replace(/\.[^.]+$/, '').replace(/[-_ ](thin|extralight|light|regular|medium|semibold|bold|extrabold|black|italic|oblique|\d{3})+$/i, '').replace(/[-_]+/g, ' ').trim();
}

const pickDisplayBody = (fonts) => {
  const by = (names) => fonts.styles.find((s) => names.includes(String(s.name).toLowerCase()));
  const display = by(['display', 'h1', 'headline', 'title'])?.family || '';
  const body = by(['body', 'body-md', 'text', 'paragraph'])?.family || '';
  return { display, body };
};

const DOC_PRIORITY = [/start-?here/i, /^readme/i, /brand|guideline/i, /tone|voice/i, /format|layout/i, /motion|video/i, /visual|design/i];
const docRank = (p) => {
  if (/(^|\/)components\//i.test(p)) return 50;
  const base = path.basename(p);
  const i = DOC_PRIORITY.findIndex((re) => re.test(base));
  return i === -1 ? 20 : i;
};

/**
 * Reads a brand package ZIP into plain data. Nothing is written to disk or the database here.
 * Large things (photos, fonts) are not read into memory: each file keeps a read() that opens it on demand.
 */
export function openPackage(zipPath, originalName = 'package.zip') {
  const files = listZipFiles(zipPath);
  if (!files.length) throw new Error('That ZIP file is empty.');

  const pkg = {
    originalName,
    fileCount: files.length,
    name: '',
    tokens: { hasTokens: false, colors: [], fonts: { families: [], styles: [] } },
    docs: [],
    logos: [], photos: [], textures: [], layouts: [], references: [], pdfs: [], unknown: [],
    fontFiles: [],
    skipped: { logos: 0, photos: 0, textures: 0, layouts: 0, references: 0, pdfs: 0, tooBig: 0, ignored: 0 }
  };

  const shallow = (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path);
  const byName = (re) => files.filter((f) => re.test(f.name)).sort(shallow)[0];

  // Tokens: tokens.json is the source of truth, tokens.css next, then any JSON with a name for the brand.
  const tokensJson = byName(/^tokens\.json$/i) || byName(/\.tokens\.json$/i);
  const tokensCss = byName(/^tokens\.css$/i);
  let json = null;
  if (tokensJson) {
    try { json = JSON.parse(tokensJson.read(LIMITS.docBytes * 4)?.toString('utf8') || ''); } catch { json = null; }
  }
  if (json) {
    pkg.tokens.colors = colorsFromJson(json);
    pkg.tokens.fonts = fontsFromJson(json);
    pkg.name = typeof json.name === 'string' ? json.name.trim() : '';
  }
  if (!pkg.tokens.colors.length && tokensCss) {
    pkg.tokens.colors = colorsFromCss(tokensCss.read(LIMITS.docBytes * 2)?.toString('utf8') || '');
  }
  for (const manifest of ['manifest.json', 'design-system.json']) {
    if (pkg.name) break;
    const f = byName(new RegExp(`^${manifest.replace('.', '\\.')}$`, 'i'));
    try { pkg.name = String(JSON.parse(f?.read(LIMITS.docBytes * 8)?.toString('utf8') || '{}').name || '').trim(); } catch { /* ignore */ }
  }
  pkg.tokens.hasTokens = pkg.tokens.colors.length > 0 || pkg.tokens.fonts.styles.length > 0;

  for (const f of files) {
    if (FONT_EXT.has(f.ext)) { pkg.fontFiles.push(f.path); continue; }
    if (IGNORED_FOLDERS.test(f.path)) { pkg.skipped.ignored++; continue; }
    if (DOC_EXT.has(f.ext)) {
      const buf = f.read(LIMITS.docBytes);
      if (buf) pkg.docs.push({ path: f.path, rank: docRank(f.path), text: buf.toString('utf8').replace(/\r/g, '').trim() });
      continue;
    }
    if (f.ext === '.pdf') {
      if (pkg.pdfs.length < LIMITS.pdfs) pkg.pdfs.push(f); else pkg.skipped.pdfs++;
      continue;
    }
    if (!IMAGE_MIME[f.ext]) continue;
    if (f.size > LIMITS.imageBytes) { pkg.skipped.tooBig++; continue; }
    const kind = kindFromPath(f.path);
    const bucket = { logo: 'logos', product: 'photos', texture: 'textures', layout: 'layouts', reference: 'references' }[kind] || 'unknown';
    pkg[bucket].push(f);
  }
  pkg.docs = pkg.docs.filter((d) => d.text).sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));

  // Fallbacks for a package with no tokens file.
  if (!pkg.tokens.fonts.families.length && pkg.fontFiles.length) {
    pkg.tokens.fonts.families = [...new Set(pkg.fontFiles.map((p) => familyFromFileName(path.basename(p))))];
  }
  if (!pkg.name) pkg.name = path.basename(originalName, path.extname(originalName)).replace(/[-_]+/g, ' ').replace(/\b(design system|brand package|brand assets?)\b/i, '').trim();
  return pkg;
}

/** Applies the per-kind caps after unknown images have been sorted, and counts what was left out. */
export function applyCaps(pkg) {
  for (const [bucket, cap] of [['logos', LIMITS.logos], ['photos', LIMITS.photos], ['textures', LIMITS.textures], ['layouts', LIMITS.layouts], ['references', LIMITS.references]]) {
    pkg[bucket].sort((a, b) => a.path.localeCompare(b.path));
    if (pkg[bucket].length > cap) {
      pkg.skipped[bucket] += pkg[bucket].length - cap;
      pkg[bucket] = pkg[bucket].slice(0, cap);
    }
  }
}

/** True when the package carries real brand information to interpret (not just a folder of images). */
export const hasBrandInfo = (pkg) => pkg.tokens.hasTokens || pkg.docs.length > 0;

// ---------------------------------------------------------------------------
// 2. Images whose folder and name do not say what they are
// ---------------------------------------------------------------------------

/**
 * Sorts pkg.unknown into logos / photos / textures / references by looking at each image (AI vision, a few at a time).
 * With no AI configured an unknown image is treated as a photo, the safest kind (it is never read for the palette).
 */
export async function classifyUnknownImages(pkg) {
  const unknown = pkg.unknown.splice(0);
  if (!unknown.length) return { ranAI: false };
  let router = null;
  try { router = await import('./ai/router.js'); } catch { router = null; }

  const place = (f, kind) => {
    const bucket = { logo: 'logos', texture: 'textures', reference: 'references', other: 'photos', product: 'photos' }[kind] || 'photos';
    pkg[bucket].push(f);
  };
  let ranAI = false;
  const queue = unknown.slice(0, LIMITS.classifyImages);
  for (const f of unknown.slice(LIMITS.classifyImages)) place(f, 'product');

  await Promise.all(queue.map(async (f) => {
    let kind = 'product';
    try {
      const buf = f.read(LIMITS.imageBytes);
      if (buf && router) {
        const thumb = await sharp(buf, { density: 96 }).resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
        const { text } = await router.analyzeImage({
          base64: thumb.toString('base64'),
          mimeType: 'image/jpeg',
          maxTokens: 120,
          purpose: 'brand package: what is this file',
          instruction: [
            `This image came from a brand's asset package (path: "${f.path}"). Say what kind of asset it is.`,
            'Reply with ONLY a JSON object: {"kind":"logo"|"product"|"texture"|"reference"|"other"}.',
            'logo = a logo, wordmark or brand mark on a plain or transparent background. product = a photo of the brand\'s product, vehicle, pack or service.',
            'texture = a pattern or background. reference = a finished ad, social post, moodboard or screenshot used as inspiration. other = anything else.'
          ].join(' ')
        });
        if (text) {
          ranAI = true;
          const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
          if (['logo', 'product', 'texture', 'reference', 'other'].includes(parsed.kind)) kind = parsed.kind;
        }
      }
    } catch { /* keep the default */ }
    place(f, kind);
  }));
  return { ranAI };
}

// ---------------------------------------------------------------------------
// 3. Turning tokens + guidelines into the brand kit and brand guide
// ---------------------------------------------------------------------------

const prettyFile = (name) => {
  const base = name.replace(/\.[^.]+$/, '').replace(/_[0-9a-f]{8}$/i, '').replace(/[_-]+/g, ' ').replace(/\brgb\b/i, '').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
};

/** Logo version from the file name alone. Anything it cannot tell stays empty for the AI (or the team) to set. */
export function variantFromName(name) {
  const n = name.toLowerCase();
  if (/(^|[^a-z])(white|reversed?|negative|inverse)([^a-z]|$)/.test(n)) return 'white';
  if (/(^|[^a-z])(black|mono(chrome)?)([^a-z]|$)/.test(n)) return 'black';
  if (/icon|symbol|emblem|badge|favicon|monogram/.test(n)) return 'icon';
  if (/stack/.test(n)) return 'stacked';
  if (/horizontal|landscape/.test(n)) return 'horizontal';
  if (/one[-_ ]?colou?r|single[-_ ]?colou?r/.test(n)) return 'one-colour';
  if (/primary|main|default|full[-_ ]?colou?r/.test(n)) return 'primary';
  return '';
}

const tok = (pkg, ...names) => {
  for (const n of names) {
    const t = pkg.tokens.colors.find((c) => c.name.toLowerCase() === n);
    if (t) return t.value;
  }
  return '';
};

/** What the package says without any AI: palette from the tokens, fonts, and a first guess at each logo's version. */
export function baselineInterpretation(pkg) {
  const roles = {
    primary: tok(pkg, 'brand', 'primary', 'brand-primary'),
    secondary: tok(pkg, 'brand-strong', 'secondary', 'brand-secondary', 'night'),
    accent: tok(pkg, 'accent', 'highlight', 'brand-accent'),
    neutral: tok(pkg, 'surface', 'neutral', 'background', 'surface-sunken')
  };
  const brandish = pkg.tokens.colors.filter((c) => /^(brand|primary|secondary|accent|night)/i.test(c.name)).map((c) => c.value);
  const colors = [...new Set([roles.primary, roles.secondary, roles.accent, roles.neutral, tok(pkg, 'ink', 'text'), ...brandish, ...pkg.tokens.colors.map((c) => c.value)].filter(Boolean))].slice(0, 6);
  const fonts = pickDisplayBody(pkg.tokens.fonts);
  const logoType = pkg.logos.length && pkg.logos.every((l) => /wordmark|logotype/i.test(l.name)) ? 'wordmark' : '';
  return {
    colors,
    colorRoles: Object.fromEntries(Object.entries(roles).filter(([, v]) => v)),
    fonts,
    logoType,
    logos: pkg.logos.map((l) => ({ file: l.name, variant: variantFromName(l.name), label: prettyFile(l.name).slice(0, 80), notes: '' })),
    guide: {}
  };
}

const SYSTEM = [
  'You are a brand strategist and senior designer onboarding a brand\'s design-system package into a platform that generates social posts, videos and banner ads with AI.',
  'You are given the package\'s colour and type tokens, its written guidelines, and the list of logo files. Turn them into the brand kit and a brand guide the platform will pass to its AI.',
  'Rules: ground every field in the supplied files and never invent facts. When the files do not say, return an empty string or empty list for that field.',
  'Colours must be copied from the token list (6-digit hex). Never write hex codes, token names, CSS variable names or backticks inside any text field: describe colours in plain words (for example "the dark green panel").',
  'Keep only what helps create ads and captions: voice and writing rules, layout and photo rules, logo rules, accessibility rules that change how a creative looks. Leave out web or app UI details (hover states, grids, components for websites).',
  'Write do/don\'t items as short, imperative, self-contained sentences (under 150 characters each). No emoji. Respond with ONLY a JSON object: no markdown, no commentary.'
].join(' ');

const SCHEMA = {
  brandName: 'the brand\'s name as the files give it',
  colors: ['#RRGGBB (up to 6, brand-defining first, copied from the token list)'],
  colorRoles: { primary: '#RRGGBB', secondary: '#RRGGBB', accent: '#RRGGBB', neutral: '#RRGGBB' },
  fonts: { display: 'headline typeface family name exactly as the files name it', body: 'body typeface family name exactly as the files name it' },
  logoType: 'one of: wordmark, lettermark, symbol, combination, emblem, not-a-logo',
  typographyImpression: 'one sentence on the typefaces (weight, character) and where each is used',
  moodTags: ['3 to 5 short lowercase adjectives'],
  imageryStyle: 'one sentence on the photographic style the files require',
  voiceTone: 'the tone of voice in one to two sentences, quoting the files\' own words where possible; empty if none is stated',
  summary: '2 to 3 sentences: the design language in plain English for a new designer',
  guide: {
    instructions: 'up to 800 characters: what matters most when creating anything for this brand',
    copyInstructions: 'up to 1200 characters: how to write (structure, sentence style, price and CTA style, punctuation, what to open with, length limits)',
    designInstructions: 'up to 1200 characters: layout, photo, colour use and text placement rules for images and video',
    audience: 'who the brand speaks to (one sentence)',
    positioning: 'what the brand stands for (one sentence)',
    logoRules: 'which logo goes where and what never to do to it (up to 500 characters)',
    mandatoryText: 'a disclaimer or legal line that must appear, word for word; empty if none',
    doList: ['up to 12 always-do rules'],
    dontList: ['up to 12 never-do rules'],
    preferredWords: ['up to 20 words or short phrases the brand prefers'],
    avoidWords: ['up to 20 words or phrases to avoid'],
    taglines: ['approved taglines, word for word; empty if none']
  },
  logos: [{
    file: 'exact file name from the logo list',
    variant: `one of: ${LOGO_VARIANTS.join(', ')}, or "" when none fits`,
    label: 'short name, under 40 characters, e.g. "White wordmark"',
    notes: 'when to use this file, taken from the guidelines, under 200 characters'
  }]
};

function buildPrompt(pkg) {
  const colorLines = pkg.tokens.colors.slice(0, 60).map((c) => `- ${c.name}: ${c.value}${c.usage ? ` (${c.usage})` : ''}`);
  const f = pkg.tokens.fonts;
  const typeLines = [
    f.families.length ? `Families: ${f.families.join(', ')}` : '',
    ...f.styles.slice(0, 30).map((s) => `- ${s.name}: ${s.family}, ${s.size || '?'}, weight ${s.weight || '?'}${s.usage ? ` (${s.usage})` : ''}`)
  ].filter(Boolean);
  let budget = LIMITS.docsTotalChars;
  const docs = [];
  for (const d of pkg.docs) {
    if (budget <= 0) break;
    const cap = /(^|\/)components\//i.test(d.path) ? 1500 : LIMITS.docChars;
    const text = d.text.slice(0, Math.min(cap, budget));
    budget -= text.length;
    docs.push(`### ${d.path}\n${text}`);
  }
  return [
    `Package: "${pkg.name || pkg.originalName}"`,
    '',
    '## Colour tokens (light theme)',
    colorLines.join('\n') || '(none)',
    '',
    '## Type tokens',
    typeLines.join('\n') || '(none)',
    '',
    '## Logo files',
    pkg.logos.map((l) => `- ${l.name} (in ${path.dirname(l.path) || '.'})`).join('\n') || '(none)',
    '',
    '## Written guidelines',
    docs.join('\n\n') || '(none)',
    '',
    'Respond with ONLY a JSON object shaped exactly like this (omit nothing; use "" or [] where the files are silent):',
    JSON.stringify(SCHEMA, null, 2)
  ].join('\n');
}

const strip = (v, n) => String(v ?? '').replace(/#[0-9a-fA-F]{6}\b/g, '').replace(/[`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const stripList = (arr, n, len) => (Array.isArray(arr) ? arr : []).map((s) => strip(s, len)).filter(Boolean).slice(0, n);

/** Validates whatever the AI returned, so a bad value never reaches the brand kit. */
export function normalizeInterpretation(raw, pkg) {
  const known = new Set(pkg.tokens.colors.map((c) => c.value));
  const onlyKnown = (hexes) => hexes.map((h) => h.toUpperCase()).filter((h) => !known.size || known.has(h));
  const colors = onlyKnown(sanitizeColors(raw.colors)).slice(0, 6);
  const rolesRaw = sanitizeColorRoles(raw.colorRoles);
  const roles = {};
  for (const [r, h] of Object.entries(rolesRaw)) if (onlyKnown([h]).length) roles[r] = h.toUpperCase();

  const guide = raw.guide && typeof raw.guide === 'object' ? raw.guide : {};
  const cleanedGuide = cleanGuide({
    instructions: strip(guide.instructions, 3000),
    copyInstructions: strip(guide.copyInstructions, 2000),
    designInstructions: strip(guide.designInstructions, 2000),
    audience: strip(guide.audience, 500),
    positioning: strip(guide.positioning, 500),
    logoRules: strip(guide.logoRules, 600),
    mandatoryText: strip(guide.mandatoryText, 400),
    doList: stripList(guide.doList, 15, 160),
    dontList: stripList(guide.dontList, 15, 160),
    preferredWords: stripList(guide.preferredWords, 30, 40),
    avoidWords: stripList(guide.avoidWords, 30, 40),
    taglines: stripList(guide.taglines, 10, 120)
  });

  const fileNames = new Set(pkg.logos.map((l) => l.name));
  const logos = (Array.isArray(raw.logos) ? raw.logos : [])
    .filter((l) => l && fileNames.has(String(l.file)))
    .map((l) => ({
      file: String(l.file),
      variant: LOGO_VARIANTS.includes(String(l.variant || '').toLowerCase()) ? String(l.variant).toLowerCase() : '',
      label: strip(l.label, 80),
      notes: strip(l.notes, 300)
    }));

  return {
    brandName: strip(raw.brandName, 80),
    colors,
    colorRoles: roles,
    fonts: { display: strip(raw.fonts?.display, 60), body: strip(raw.fonts?.body, 60) },
    logoType: LOGO_TYPES.includes(raw.logoType) ? raw.logoType : '',
    typographyImpression: strip(raw.typographyImpression, 300),
    moodTags: [...new Set(stripList(raw.moodTags, 8, 30).map((t) => t.toLowerCase()))].slice(0, 5),
    imageryStyle: strip(raw.imageryStyle, 300),
    voiceTone: strip(raw.voiceTone, 500),
    summary: strip(raw.summary, 600),
    guide: cleanedGuide,
    logos
  };
}

/**
 * The interpretation of a package: the plain baseline (palette, fonts, logo versions) with the AI's reading of the written
 * guidelines laid on top. { ranAI, modelUsed, note, data }. Never throws: any AI failure just leaves the baseline.
 */
export async function interpretPackage(pkg) {
  const base = baselineInterpretation(pkg);
  const result = { ranAI: false, modelUsed: '', note: '', data: { ...base, typographyImpression: '', moodTags: [], imageryStyle: '', voiceTone: '', summary: '', brandName: pkg.name } };
  if (!hasBrandInfo(pkg)) return result;

  try {
    const router = await import('./ai/router.js');
    const { text, modelUsed, note } = await router.generateText({ system: SYSTEM, prompt: buildPrompt(pkg), maxTokens: 4000, purpose: 'brand package import' });
    if (!text || modelUsed === 'placeholder') {
      result.note = note || 'AI is not set up for text yet.';
      return result;
    }
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const ai = normalizeInterpretation(JSON.parse(extractJsonObject(cleaned)), pkg);

    // Palette and fonts: the AI's pick when it gave a valid one, otherwise the plain reading of the tokens.
    const logos = base.logos.map((b) => {
      const a = ai.logos.find((l) => l.file === b.file);
      return a ? { file: b.file, variant: a.variant || b.variant, label: a.label || b.label, notes: a.notes } : b;
    });
    result.ranAI = true;
    result.modelUsed = modelUsed;
    result.data = {
      brandName: ai.brandName || pkg.name,
      colors: ai.colors.length ? ai.colors : base.colors,
      colorRoles: { ...base.colorRoles, ...ai.colorRoles },
      fonts: { display: ai.fonts.display || base.fonts.display, body: ai.fonts.body || base.fonts.body },
      logoType: ai.logoType || base.logoType,
      typographyImpression: ai.typographyImpression,
      moodTags: ai.moodTags,
      imageryStyle: ai.imageryStyle,
      voiceTone: ai.voiceTone,
      summary: ai.summary,
      guide: ai.guide,
      logos
    };
  } catch (err) {
    console.warn('[brand-package] AI reading failed:', err.message);
    result.note = `The AI could not read the guidelines (${err.message}).`;
  }
  return result;
}
