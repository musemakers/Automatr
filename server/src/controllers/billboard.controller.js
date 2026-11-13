import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { BILLBOARD_PRESETS, CUSTOM_FT_MIN, CUSTOM_FT_MAX, BILLBOARD_PPI, SCALES, MAX_TRIM_PIXELS, BLEED_REAL_IN, SAFE_FRACTION, DOOH_DEFAULT_WIDTH, specFor } from '../constants/billboard.js';
import { startBillboardExport, getJob, publicJob, smartUpscaleAvailable, BusyError } from '../services/billboardService.js';

const usageCtx = (req) => ({ userId: req.user._id, userName: req.user.name, userEmail: req.user.email, action: 'billboard_export', postId: null });

/** "/uploads/..." path from a stored path or full URL ('' when it is anything else). */
function uploadPathFromUrl(raw) {
  let p = String(raw || '');
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { return ''; }
  p = p.split('?')[0].split('#')[0];
  try { p = decodeURIComponent(p); } catch { return ''; }
  return p.startsWith('/uploads/') ? p : '';
}

export function config(req, res) {
  res.json({
    presets: BILLBOARD_PRESETS.map((p) => ({ ...p, spec: specFor(p.widthFt, p.heightFt) })),
    custom: { min: CUSTOM_FT_MIN, max: CUSTOM_FT_MAX },
    print: { ppi: BILLBOARD_PPI, scales: SCALES, maxPixels: MAX_TRIM_PIXELS, bleedRealIn: BLEED_REAL_IN, safePercent: Math.round(SAFE_FRACTION * 100) },
    doohWidth: DOOH_DEFAULT_WIDTH,
    smartUpscale: smartUpscaleAvailable()
  });
}

export async function startExport(req, res, next) {
  try {
    const b = req.body || {};
    const preset = BILLBOARD_PRESETS.find((p) => p.id === b.presetId);
    const widthFt = preset ? preset.widthFt : Number(b.widthFt);
    const heightFt = preset ? preset.heightFt : Number(b.heightFt);
    const sourceUrl = uploadPathFromUrl(b.sourceUrl);
    if (!sourceUrl) return res.status(400).json({ error: 'Pick a creative to prepare.' });
    const job = startBillboardExport({
      userId: req.user._id, sourceUrl, widthFt, heightFt,
      outputs: Array.isArray(b.outputs) ? b.outputs : [],
      doohWidth: Number(b.doohWidth) || DOOH_DEFAULT_WIDTH,
      title: String(b.title || '').slice(0, 80),
      usageContext: usageCtx(req)
    });
    res.status(202).json({ job: publicJob(job) });
  } catch (err) {
    if (err instanceof BusyError) return res.status(429).json({ error: err.message });
    if (err.userMessage) return res.status(400).json({ error: err.userMessage });
    next(err);
  }
}

function sendJobFile(res, job, name) {
  const entry = (job.files || []).find((f) => f.name === name);
  const full = entry ? path.join(job.dir, entry.name) : '';
  if (!full || !fs.existsSync(full)) {
    console.warn('[billboard] download: file missing', full);
    return res.status(404).json({ error: 'That file is no longer available. Please make the files again.' });
  }
  // Streamed by hand (not res.download) so odd characters or dot-folders in the storage path can never block it.
  const types = { tif: 'image/tiff', pdf: 'application/pdf', jpg: 'image/jpeg' };
  res.setHeader('Content-Type', types[entry.name.split('.').pop().toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(full).size);
  res.setHeader('Content-Disposition', `attachment; filename="${entry.name.replace(/[^\w.-]/g, '_')}"`);
  const stream = fs.createReadStream(full);
  stream.on('error', (err) => { console.warn('[billboard] download stream failed:', err.message); res.destroy(err); });
  stream.pipe(res);
}

// Signed, short-lived download links: the browser downloads the file itself (no fetch / blob in the page), so big files
// stream straight to disk and work the same in local dev and when deployed.
export function downloadLink(req, res) {
  const job = getJob(req.params.id);
  if (!job || job.userId !== String(req.user._id)) return res.status(404).json({ error: 'These files are no longer available. Please make them again.' });
  if (!(job.files || []).some((f) => f.name === req.params.name)) return res.status(404).json({ error: 'That file is no longer available. Please make the files again.' });
  const token = jwt.sign({ bb: job.id, f: req.params.name, u: String(req.user._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: `/api/billboard/dl/${token}` });
}

export function downloadByToken(req, res) {
  let claims;
  try { claims = jwt.verify(req.params.token, process.env.JWT_SECRET); } catch { return res.status(401).send('This download link has expired. Go back and click Download again.'); }
  const job = getJob(claims.bb);
  if (!job || job.userId !== claims.u) return res.status(404).send('These files are no longer available. Please make them again.');
  return sendJobFile(res, job, claims.f);
}

export function downloadExportFile(req, res) {
  const job = getJob(req.params.id);
  if (!job || job.userId !== String(req.user._id)) return res.status(404).json({ error: 'These files are no longer available. Please make them again.' });
  return sendJobFile(res, job, req.params.name);
}

export function getExport(req, res) {
  const job = getJob(req.params.id);
  if (!job || job.userId !== String(req.user._id)) return res.status(404).json({ error: 'These files are no longer available. Please make them again.' });
  res.json({ job: publicJob(job) });
}
