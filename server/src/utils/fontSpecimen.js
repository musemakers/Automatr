import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { uploadDir, uploadUrl } from './storage.js';

// A type-specimen image of a brand's headline and body fonts (A-Z, a-z, 0-9, common punctuation),
// attached to image prompts as a reference so the model can copy the letterforms instead of
// guessing from a font name. Real font files come from Google Fonts; both the font files and the
// finished specimen are cached on disk. Anything that goes wrong returns null (no specimen sent).

const run = promisify(execFile);
const CACHE_DIR = () => path.join(uploadDir(), 'font-cache');
const LEGACY_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'; // old browsers get plain .ttf from Google Fonts
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PUNCT = '& ! ? . , : ; \' " - – ( ) @ # % $ ₹ + / * =';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function save(file, res) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('empty font file');
  fs.mkdirSync(CACHE_DIR(), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

// Route 1: the Google Fonts CSS API (an old browser user-agent makes it answer with plain .ttf links).
async function viaCssApi(family, weight, file) {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  for (const spec of [`:wght@${weight}`, '']) {
    try {
      const css = await fetch(`https://fonts.googleapis.com/css2?family=${fam}${spec}`, { headers: { 'User-Agent': LEGACY_UA }, signal: AbortSignal.timeout(8000) });
      if (!css.ok) continue;
      const m = (await css.text()).match(/url\(['"]?(https:[^)'"]+\.(?:ttf|otf))['"]?\)/);
      if (!m) continue;
      const bin = await fetch(m[1], { signal: AbortSignal.timeout(15000) });
      if (bin.ok) return await save(file, bin);
    } catch { /* next */ }
  }
  return null;
}

// Route 2: the google/fonts repository, whose METADATA.pb lists each family's font files.
async function viaRepo(family, weight, file) {
  const folder = String(family).toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const dir of ['ofl', 'apache', 'ufl']) {
    try {
      const base = `https://raw.githubusercontent.com/google/fonts/main/${dir}/${folder}`;
      const meta = await fetch(`${base}/METADATA.pb`, { signal: AbortSignal.timeout(8000) });
      if (!meta.ok) continue;
      const fonts = [...(await meta.text()).matchAll(/fonts\s*\{([^}]*)\}/g)].map((m) => ({
        style: (m[1].match(/style:\s*"([^"]+)"/) || [])[1],
        weight: Number((m[1].match(/weight:\s*(\d+)/) || [])[1] || 400),
        filename: (m[1].match(/filename:\s*"([^"]+)"/) || [])[1]
      })).filter((f) => f.filename && f.style === 'normal');
      if (!fonts.length) continue;
      const pick = fonts.find((f) => f.filename.includes('[')) || fonts.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
      const bin = await fetch(`${base}/${encodeURIComponent(pick.filename)}`, { signal: AbortSignal.timeout(20000) });
      if (bin.ok) return await save(file, bin);
    } catch { /* next folder */ }
  }
  return null;
}

async function fetchFontFile(family, weight) {
  const file = path.join(CACHE_DIR(), `${slug(family)}-${weight}.ttf`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  return (await viaCssApi(family, weight, file)) || (await viaRepo(family, weight, file));
}


// ---- Fonts the team supplies themselves --------------------------------------------------------------------------------

const FILES_DIR = () => path.join(uploadDir(), 'font-files');

/** Reads family name, weight and variable-ness out of a .ttf/.otf. Throws a readable message for anything else. */
export function parseFontMeta(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw new Error('That file is empty or not a font.');
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOFF' || tag === 'wOF2') throw new Error('Web fonts (.woff / .woff2) cannot be used. Upload the .ttf or .otf version of the font.');
  if (tag === 'ttcf') throw new Error('Font collections (.ttc) are not supported. Upload a single .ttf or .otf file.');
  if (!(tag === '\x00\x01\x00\x00' || tag === 'true' || tag === 'OTTO')) throw new Error('That file is not a .ttf or .otf font.');
  const n = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (o + 16 > buf.length) break;
    tables[buf.toString('latin1', o, o + 4)] = { offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) };
  }
  const nm = tables.name;
  if (!nm) throw new Error('This font file has no name table, so its family name cannot be read.');
  const count = buf.readUInt16BE(nm.offset + 2);
  const strBase = nm.offset + buf.readUInt16BE(nm.offset + 4);
  const names = {};
  for (let i = 0; i < count; i++) {
    const r = nm.offset + 6 + i * 12;
    const platform = buf.readUInt16BE(r), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6), len = buf.readUInt16BE(r + 8), off = buf.readUInt16BE(r + 10);
    if (id !== 1 && id !== 16) continue;
    const raw = buf.subarray(strBase + off, strBase + off + len);
    const text = platform === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
    const rank = platform === 3 && lang === 0x409 ? 3 : platform === 3 ? 2 : 1;
    if (!names[id] || rank > names[id].rank) names[id] = { text: text.trim(), rank };
  }
  const family = (names[16]?.text || names[1]?.text || '').slice(0, 80);
  if (!family) throw new Error('Could not read this font\'s family name.');
  const os2 = tables['OS/2'];
  const weight = os2 && os2.offset + 6 <= buf.length ? Math.min(900, Math.max(100, buf.readUInt16BE(os2.offset + 4))) : 400;
  return { family, weight, variable: Boolean(tables.fvar), ext: tag === 'OTTO' ? 'otf' : 'ttf' };
}

/** Stores an uploaded font so every specimen and image for a font with this family name uses it. */
export function saveCustomFont(buf) {
  const meta = parseFontMeta(buf);
  fs.mkdirSync(FILES_DIR(), { recursive: true });
  for (const e of ['ttf', 'otf']) { try { fs.unlinkSync(path.join(FILES_DIR(), `${slug(meta.family)}.${e}`)); } catch { /* none */ } }
  fs.writeFileSync(path.join(FILES_DIR(), `${slug(meta.family)}.${meta.ext}`), buf);
  clearSpecimens(); // existing sheets were drawn without this file
  return meta;
}

function customFontFor(family) {
  for (const e of ['ttf', 'otf']) {
    const file = path.join(FILES_DIR(), `${slug(family)}.${e}`);
    if (fs.existsSync(file)) {
      try { return { file, ...parseFontMeta(fs.readFileSync(file)) }; } catch { return null; }
    }
  }
  return null;
}

export function clearSpecimens() {
  try { for (const f of fs.readdirSync(uploadDir())) if (f.startsWith('font-specimen-')) fs.unlinkSync(path.join(uploadDir(), f)); } catch { /* nothing to clear */ }
}

// ---- Fonts installed on the server -------------------------------------------------------------------------------------

let systemCache = { at: 0, list: [] };
/** Font families installed on the server (via fontconfig), for the "system fonts" dropdown. Empty when fc-list is unavailable. */
export async function systemFonts() {
  if (Date.now() - systemCache.at < 10 * 60 * 1000) return systemCache.list;
  let list = [];
  try {
    const { stdout } = await run('fc-list', [':', 'family'], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
    list = [...new Set(stdout.split('\n').map((l) => l.split(',')[0].trim()).filter((n) => n && !n.startsWith('.')))].sort((a, b) => a.localeCompare(b));
  } catch { /* no fontconfig here */ }
  systemCache = { at: Date.now(), list };
  return list;
}

/** Picks where a font comes from: an uploaded file, Google Fonts, then the server's own fonts. */
export async function resolveFont(family, weight) {
  const custom = customFontFor(family);
  if (custom) return { file: custom.file, weight: custom.variable ? weight : custom.weight };
  const google = await fetchFontFile(family, weight);
  if (google) return { file: google, weight };
  const sys = await systemFonts();
  if (sys.some((n) => n.toLowerCase() === String(family).toLowerCase())) return { file: undefined, weight };
  return null;
}

async function textLayer(fontfile, family, text, px, width, weight) {
  return sharp({ text: { text: `<span foreground="#111111" font_weight="${weight}" font_size="${px * 1024}">${esc(text)}</span>`, font: family, ...(fontfile ? { fontfile } : {}), width, rgba: true, align: 'left', wrap: 'word', spacing: Math.round(px * 0.2) } }).png().toBuffer({ resolveWithObject: true });
}

const specimenName = (display, body) => `font-specimen-${slug(display)}__${slug(body)}.png`;

/** Where the specimen for these fonts is (or would be), and whether it has been made. Never generates. */
export function specimenInfo(fonts) {
  const display = String(fonts?.display || '').trim();
  const body = String(fonts?.body || '').trim();
  if (!display && !body) return { display, body, exists: false, url: '', filePath: '', missing: [] };
  const name = specimenName(display, body);
  const filePath = path.join(uploadDir(), name);
  const exists = fs.existsSync(filePath) && fs.statSync(filePath).size > 1000;
  let missing = [];
  try { missing = JSON.parse(fs.readFileSync(`${filePath}.json`, 'utf8')).missing || []; } catch { /* none recorded */ }
  return { display, body, exists, url: exists ? uploadUrl(name) : '', filePath, missing };
}

/**
 * Makes the specimen for these fonts (reusing the saved one unless force). Fonts that are not on Google Fonts are
 * left off the sheet and reported in `missing`. Returns null when nothing could be drawn.
 */
export async function buildFontSpecimen(fonts, { force = false } = {}) {
  try {
    const info = specimenInfo(fonts);
    if (!info.display && !info.body) return null;
    if (info.exists && !force) return info;
    const W = 1600;
    const blocks = [];
    if (info.display) blocks.push({ family: info.display, weight: 700, rows: [[UPPER, 78], [LOWER, 78], [DIGITS, 78], [PUNCT, 64]] });
    if (info.body) blocks.push({ family: info.body, weight: 400, rows: [[UPPER, 56], [LOWER, 56], [DIGITS, 56], [PUNCT, 48]] });

    const layers = [];
    const missing = [];
    let y = 50;
    for (const b of blocks) {
      const src = await resolveFont(b.family, b.weight);
      if (!src) { missing.push(b.family); continue; } // not uploaded, not on Google Fonts, not installed: leave it out rather than fake it
      for (const [text, px] of b.rows) {
        let { data, info: li } = await textLayer(src.file, b.family, text, px, W - 100, src.weight);
        if (li.width > W - 100) { // a wide typeface can run past the sheet: shrink that row to fit rather than fail
          ({ data, info: li } = await sharp(data).resize({ width: W - 100 }).png().toBuffer({ resolveWithObject: true }));
        }
        layers.push({ input: data, left: 50, top: y });
        y += li.height + 18;
      }
      y += 50;
    }
    if (!layers.length) return { ...info, exists: false, url: '', missing };
    await sharp({ create: { width: W, height: y + 10, channels: 3, background: '#ffffff' } }).composite(layers).png().toFile(info.filePath);
    try { fs.writeFileSync(`${info.filePath}.json`, JSON.stringify({ missing })); } catch { /* sidecar is optional */ }
    return { ...info, exists: true, url: uploadUrl(specimenName(info.display, info.body)), missing };
  } catch {
    return null;
  }
}

/** The specimen as a reference image for the image model (made on the spot when the brand has none yet), or null. */
export async function fontSpecimenFile(fonts) {
  const r = await buildFontSpecimen(fonts);
  return r?.exists ? { filePath: r.filePath, mimeType: 'image/png', filename: 'font-specimen.png', role: 'font-specimen' } : null;
}

/**
 * Where a line of text breaks. Sentences each get their own line when that reads well; otherwise the words are wrapped into
 * evenly balanced lines no longer than `max` characters. The proof is drawn with exactly these breaks and the prompt asks the
 * image model to use the same ones, so the proof and the finished design wrap alike.
 */
export function breakLines(text, max, bySentence = true) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const sentences = t.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) || [t];
  const out = [];
  const parts = bySentence && sentences.length > 1 && sentences.length <= 3 ? sentences : [t];
  for (const p of parts) {
    if (p.length <= max) { out.push(p); continue; }
    const n = Math.ceil(p.length / max);
    const target = Math.ceil(p.length / n);
    let line = '';
    for (const w of p.split(' ')) {
      if (line && (line + ' ' + w).length > target && out.length < 12) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * A proof of the ACTUAL wording of this creative: the headline set in the brand's headline font and the sub-headline in its
 * body font, on a plain white sheet. Sent to the image model instead of the A-Z specimen, so it copies the letterforms from
 * the real lines it has to draw rather than from a generic alphabet. Cached by wording + fonts. Returns null when neither line
 * can be set (no text, or fonts not found), and the caller falls back to the alphabet specimen.
 */
export async function fontProofFile(fonts, { headline = '', subHeadline = '' } = {}) {
  try {
    const display = String(fonts?.display || '').trim();
    const body = String(fonts?.body || '').trim();
    const head = String(headline || '').trim().slice(0, 160);
    const sub = String(subHeadline || '').trim().slice(0, 240);
    const lines = [];
    const headLines = breakLines(head, 30);
    const subLines = breakLines(sub, 52, false);
    if (head && display) lines.push({ family: display, weight: 700, text: headLines.join('\n'), px: 96 });
    if (sub && (body || display)) lines.push({ family: body || display, weight: 400, text: subLines.join('\n'), px: 56 });
    if (!lines.length) return null;

    const key = crypto.createHash('sha1').update(JSON.stringify(lines)).digest('hex').slice(0, 20);
    const dir = path.join(CACHE_DIR(), 'proofs');
    const filePath = path.join(dir, `font-proof-${key}.png`);
    const result = { filePath, mimeType: 'image/png', filename: 'font-proof.png', role: 'font-specimen', headLines: head && display ? headLines : [], subLines: sub ? subLines : [] };
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) return result;

    const W = 1600;
    const layers = [];
    let y = 60;
    for (const l of lines) {
      const src = await resolveFont(l.family, l.weight);
      if (!src) continue; // font not found anywhere: leave that line off rather than fake it
      let { data, info } = await textLayer(src.file, l.family, l.text, l.px, W - 120, src.weight);
      if (info.width > W - 120) ({ data, info } = await sharp(data).resize({ width: W - 120 }).png().toBuffer({ resolveWithObject: true }));
      layers.push({ input: data, left: 60, top: y });
      y += info.height + 50;
    }
    if (!layers.length) return null;
    fs.mkdirSync(dir, { recursive: true });
    await sharp({ create: { width: W, height: y + 10, channels: 3, background: '#ffffff' } }).composite(layers).png().toFile(filePath);
    try { // keep the folder small: proofs are cheap to rebuild, but the usage log links to recent ones, so keep a month
      for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (Date.now() - fs.statSync(p).mtimeMs > 30 * 864e5) fs.unlinkSync(p); }
    } catch { /* cleanup is optional */ }
    return result;
  } catch {
    return null;
  }
}

/** One line of text drawn with a real font file: { data (PNG with alpha), width, height }. Used by the precise-text overlay. */
export async function textLine({ fontfile, family, text, px, weight, color = '#111111' }) {
  const { data, info } = await sharp({ text: { text: `<span foreground="${color}" font_weight="${weight}" font_size="${Math.round(px * 1024)}">${esc(text)}</span>`, font: family, ...(fontfile ? { fontfile } : {}), rgba: true, align: 'left' } }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
