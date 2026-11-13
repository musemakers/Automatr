import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { uploadDir, uploadUrl, resolveUploadPath } from '../utils/storage.js';
import { specFor, feetLabel, SAFE_FRACTION, DOOH_DEFAULT_WIDTH, CUSTOM_FT_MIN, CUSTOM_FT_MAX } from '../constants/billboard.js';
import { upscaleTo, aiUpscaleConfigured } from './upscaleService.js';
import { writeCmykPdf } from '../utils/cmykPdf.js';
import * as router from './ai/router.js';
import { logUsageSafely } from './aiUsageLogService.js';
import { aiLog } from '../utils/aiLog.js';

// Billboard print files for a finished creative: fit to the board shape, scale up, add bleed, then write the
// requested files (CMYK TIFF, CMYK PDF at the reduced scale, RGB preview with guides, pixel-exact digital billboard image),
// plus a readability check for distance viewing. Jobs live in memory (like the video providers); the files live in the
// customer's uploads folder and are cleared after a day.

const JOBS = new Map();
const MAX_RUNNING = 2;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

export class BusyError extends Error {}

export function getJob(id) { return JOBS.get(id) || null; }
export const smartUpscaleAvailable = () => aiUpscaleConfigured();

function pruneOld() {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.createdAt > JOB_TTL_MS) JOBS.delete(id);
  try {
    const dir = uploadDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('billboard-')) continue;
      const full = path.join(dir, name);
      if (now - fs.statSync(full).mtimeMs > JOB_TTL_MS) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

/** Fits the creative to the board shape without cropping: a near match is trimmed a hair, a different shape sits on a blurred copy of itself. */
async function fitToRatio(input, ratio) {
  const meta = await sharp(input).metadata();
  const cur = meta.width / meta.height;
  if (Math.abs(cur - ratio) / ratio < 0.02) {
    const w = meta.width;
    const h = Math.round(w / ratio);
    return { buffer: await sharp(input).resize(w, h, { fit: 'cover' }).png().toBuffer(), mismatch: false };
  }
  let W = meta.width;
  let H = Math.round(W / ratio);
  if (H < meta.height) { H = meta.height; W = Math.round(H * ratio); }
  const bg = await sharp(input).resize(W, H, { fit: 'cover' }).blur(30).modulate({ brightness: 0.95 }).toBuffer();
  const fg = await sharp(input).resize(W, H, { fit: 'inside' }).toBuffer();
  return { buffer: await sharp(bg).composite([{ input: fg, gravity: 'centre' }]).removeAlpha().png().toBuffer(), mismatch: true, from: `${meta.width} × ${meta.height}` };
}

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Distance-readability check: the vision model sees the board small and soft, the way a driver does. Returns plain-language warnings. */
async function readabilityCheck(fitted, usageContext) {
  try {
    const small = await sharp(fitted).resize({ width: 220 }).toBuffer();
    const thumb = await sharp(small).resize({ width: 640 }).blur(0.8).jpeg({ quality: 80 }).toBuffer();
    const instruction = [
      'This image is a roadside billboard design, shown deliberately small and soft, the way a driver sees it from about 100 metres away. Judge it as a billboard.',
      'Reply with JSON only, exactly: {"score": 1-10, "headlineReadable": true|false, "wordCount": number, "textNearEdges": true|false, "issues": ["short plain sentences"], "advice": "one short sentence"}',
      'score = how well a viewer gets the message in 3 seconds (10 = instantly). wordCount = all words of text in the image. textNearEdges = true when text or a logo sits within the outer 5% of any edge. issues = only real problems: text too small or thin, low contrast, too many words, too busy, key element too small. Empty list if it works.'
    ].join('\n');
    const { text, modelUsed } = await router.analyzeImage({ purpose: 'billboard readability check', detail: 'high', base64: thumb.toString('base64'), mimeType: 'image/jpeg', instruction, maxTokens: 350 });
    if (modelUsed && modelUsed !== 'none') await logUsageSafely(usageContext, { type: 'text', provider: modelUsed, purpose: 'billboard readability check', estimatedCostUsd: 0.01 });
    const d = parseJson(text);
    if (!d) return null;
    const issues = (Array.isArray(d.issues) ? d.issues : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    const words = Number(d.wordCount) || 0;
    if (words > 8 && !issues.some((t) => /\bwords?\b/i.test(t))) issues.push(`There are ${words} words. Billboards work best with 7 or fewer.`);
    if (d.textNearEdges) issues.push('Some text or a logo sits very close to the edge. Keep key content inside the safe margin.');
    return { score: Math.max(1, Math.min(10, Math.round(Number(d.score) || 0))) || null, words, issues, advice: String(d.advice || '').slice(0, 200) };
  } catch (err) {
    aiLog('vision', 'fail', { msg: `billboard readability check failed: ${err.message}` });
    return null;
  }
}

async function previewWithGuides(fullPng, spec, outPath) {
  const PW = 2000;
  const s = PW / spec.fullW;
  const ph = Math.round(spec.fullH * s);
  const bleed = spec.bleedPx * s;
  const safeX = spec.trimW * SAFE_FRACTION * s;
  const safeY = spec.trimH * SAFE_FRACTION * s;
  const bar = 64;
  const label = `${spec.widthFt} x ${spec.heightFt} ft  |  file at 1:${spec.scale} scale: ${spec.trimW} x ${spec.trimH} px at ${spec.ppi} PPI + bleed  |  green = safe area, white = trim`;
  const svg = Buffer.from(`<svg width="${PW}" height="${ph + bar}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${PW}" height="${bleed}" fill="#000" fill-opacity="0.4"/>
    <rect x="0" y="${ph - bleed}" width="${PW}" height="${bleed}" fill="#000" fill-opacity="0.4"/>
    <rect x="0" y="${bleed}" width="${bleed}" height="${ph - bleed * 2}" fill="#000" fill-opacity="0.4"/>
    <rect x="${PW - bleed}" y="${bleed}" width="${bleed}" height="${ph - bleed * 2}" fill="#000" fill-opacity="0.4"/>
    <rect x="${bleed}" y="${bleed}" width="${PW - bleed * 2}" height="${ph - bleed * 2}" fill="none" stroke="#fff" stroke-width="3"/>
    <rect x="${bleed + safeX}" y="${bleed + safeY}" width="${PW - (bleed + safeX) * 2}" height="${ph - (bleed + safeY) * 2}" fill="none" stroke="#19d36b" stroke-width="3" stroke-dasharray="14 10"/>
    <rect x="0" y="${ph}" width="${PW}" height="${bar}" fill="#111"/>
    <text x="24" y="${ph + 40}" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#fff">${label}</text>
  </svg>`);
  await sharp(fullPng).resize(PW, ph, { fit: 'fill' }).extend({ bottom: bar, background: '#111' }).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 90 }).toFile(outPath);
}

const fileEntry = (kind, label, name, dirUrl, dir, extra = {}) => ({ kind, label, name, url: `${dirUrl}/${name}`, bytes: fs.statSync(path.join(dir, name)).size, ...extra });

async function runJob(job, { sourcePath, spec, outputs, doohWidth, base, usageContext }) {
  const dir = job.dir;
  const dirUrl = job.dirUrl;
  const set = (stage) => { job.stage = stage; };
  try {
    if (spec.scale !== 10) job.notes.push(`This board is very large, so the files are built at 1:${spec.scale} scale to keep them a workable size. Tell your printer the scale (they enlarge it ${spec.scale}x).`);
    set('Preparing your creative');
    const prepared = await sharp(sourcePath, { limitInputPixels: false }).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb').png().toBuffer();
    const fit = await fitToRatio(prepared, spec.ratio);
    if (fit.mismatch) job.notes.push(`Your creative (${fit.from} px) is a different shape from a ${spec.widthFt} × ${spec.heightFt} ft board, so it was placed on a matching background without cropping. For the best result, create the design at the billboard size.`);

    set('Checking readability and scaling up');
    const [readability, scaled] = await Promise.all([
      readabilityCheck(fit.buffer, usageContext),
      upscaleTo(fit.buffer, spec.trimW, spec.trimH, usageContext)
    ]);
    job.readability = readability;
    job.upscale = scaled.method;
    if (scaled.note) job.notes.push(scaled.note);

    set('Adding bleed');
    const b = spec.bleedPx;
    const fullPng = await sharp(scaled.buffer, { limitInputPixels: false }).removeAlpha().extend({ top: b, bottom: b, left: b, right: b, extendWith: 'mirror' }).png({ compressionLevel: 3 }).toBuffer();
    const tag = `${base}-${feetLabel(spec.widthFt, spec.heightFt)}`;
    const files = [];

    if (outputs.includes('tiff')) {
      set('Writing the print TIFF');
      const name = `${tag}-print-cmyk-150ppi.tif`;
      const res = spec.ppi / 25.4;
      await sharp(fullPng, { limitInputPixels: false }).toColourspace('cmyk').tiff({ compression: 'lzw', xres: res, yres: res, resolutionUnit: 'inch' }).toFile(path.join(dir, name));
      files.push(fileEntry('tiff', 'Print TIFF (CMYK)', name, dirUrl, dir, { detail: `${spec.fullW} × ${spec.fullH} px, ${spec.ppi} PPI, 1:${spec.scale} scale, includes bleed` }));
    }
    if (outputs.includes('pdf')) {
      set('Writing the print PDF');
      const name = `${tag}-print-cmyk-1to${spec.scale}.pdf`;
      const { data, info } = await sharp(fullPng, { limitInputPixels: false }).toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 4) throw new Error('CMYK conversion did not produce four channels');
      const pageW = (spec.fullW / spec.ppi) * 72;
      const pageH = (spec.fullH / spec.ppi) * 72;
      await writeCmykPdf({ outPath: path.join(dir, name), raw: data, width: info.width, height: info.height, pageW, pageH, bleedPt: (spec.bleedPx / spec.ppi) * 72, title: `${spec.widthFt} x ${spec.heightFt} ft billboard` });
      files.push(fileEntry('pdf', 'Print PDF (CMYK)', name, dirUrl, dir, { detail: `${(pageW / 72).toFixed(1)} × ${(pageH / 72).toFixed(1)} in page at 1:${spec.scale} scale, trim and bleed marked` }));
    }
    if (outputs.includes('preview')) {
      set('Making the preview');
      const name = `${tag}-preview.jpg`;
      await previewWithGuides(fullPng, spec, path.join(dir, name));
      files.push(fileEntry('preview', 'Preview with guides (RGB)', name, dirUrl, dir, { detail: 'Shows trim, bleed and safe area. For approvals only, not for print.' }));
    }
    if (outputs.includes('dooh')) {
      set('Writing the digital billboard image');
      // doohWidth is the long edge: a landscape board is that wide, a portrait board that tall
      const long = Math.min(7680, Math.max(480, Math.round(doohWidth || DOOH_DEFAULT_WIDTH)));
      const w = spec.ratio >= 1 ? long : Math.round(long * spec.ratio);
      const h = spec.ratio >= 1 ? Math.round(long / spec.ratio) : long;
      const name = `${tag}-digital-${w}x${h}.jpg`;
      await sharp(scaled.buffer, { limitInputPixels: false }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).toColourspace('srgb').jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toFile(path.join(dir, name));
      files.push(fileEntry('dooh', 'Digital billboard image (RGB)', name, dirUrl, dir, { detail: `${w} × ${h} px, ratio matches the board` }));
    }
    if (files.some((f) => f.kind === 'tiff' || f.kind === 'pdf')) job.notes.push('CMYK conversion can shift very bright colours slightly. Ask your printer for a hard or soft proof of brand colours before the full run.');

    job.files = files;
    job.status = 'done';
    set('Done');
  } catch (err) {
    console.warn('[billboard] export failed:', err.message);
    job.status = 'failed';
    job.error = 'Could not make the billboard files. Please try again.';
    set('Failed');
  } finally {
    job.finishedAt = Date.now();
  }
}

/** Starts an export. Throws BusyError when too many are running, Error with .userMessage for bad input. */
export function startBillboardExport({ userId, sourceUrl, widthFt, heightFt, outputs, doohWidth, title, usageContext }) {
  const spec = specFor(widthFt, heightFt);
  if (!spec) { const e = new Error('bad size'); e.userMessage = `That size is outside what we can prepare. Use ${CUSTOM_FT_MIN} to ${CUSTOM_FT_MAX} ft per side.`; throw e; }
  const sourcePath = sourceUrl ? resolveUploadPath(sourceUrl) : '';
  if (!sourcePath || !fs.existsSync(sourcePath)) { const e = new Error('no source'); e.userMessage = 'That creative could not be found.'; throw e; }
  const kinds = [...new Set((outputs || []).filter((k) => ['tiff', 'pdf', 'preview', 'dooh'].includes(k)))];
  if (!kinds.length) { const e = new Error('no outputs'); e.userMessage = 'Pick at least one file to make.'; throw e; }

  const running = [...JOBS.values()].filter((j) => j.status === 'running').length;
  if (running >= MAX_RUNNING) throw new BusyError('Other billboard files are being made right now. Please try again in a minute.');

  pruneOld();
  const id = uuidv4();
  const folder = `billboard-${id}`;
  const dir = path.join(uploadDir(), folder);
  fs.mkdirSync(dir, { recursive: true });
  const job = {
    id, userId: String(userId), status: 'running', stage: 'Starting', createdAt: Date.now(),
    dir, dirUrl: uploadUrl(folder), files: [], notes: [], readability: null, upscale: '', error: '',
    spec: { widthFt: spec.widthFt, heightFt: spec.heightFt, trimW: spec.trimW, trimH: spec.trimH, fullW: spec.fullW, fullH: spec.fullH, ppi: spec.ppi, scale: spec.scale, bleedPx: spec.bleedPx }
  };
  JOBS.set(id, job);
  const base = String(title || 'creative').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'creative';
  runJob(job, { sourcePath, spec, outputs: kinds, doohWidth, base, usageContext });
  return job;
}

export const publicJob = (j) => ({
  id: j.id, status: j.status, stage: j.stage, error: j.error, files: j.files, notes: j.notes,
  readability: j.readability, upscale: j.upscale, spec: j.spec
});
