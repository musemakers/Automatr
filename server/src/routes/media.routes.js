import { Router } from 'express';
import fs from 'node:fs';
import { requireAuth } from '../middleware/auth.js';
import { resolveUploadPath } from '../utils/storage.js';
import { videoToGif, GifBusyError, FfmpegMissingError } from '../utils/videoToGif.js';

const router = Router();
router.use(requireAuth);

/** "/uploads/..." path from a stored path or full URL ('' when it is anything else). */
function uploadPathFromUrl(raw) {
  let p = String(raw || '');
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { return ''; }
  p = p.split('?')[0].split('#')[0];
  try { p = decodeURIComponent(p); } catch { return ''; }
  return p.startsWith('/uploads/') ? p : '';
}

// GET /api/media/video-gif?url=/uploads/.../video.mp4[&name=my-video]
// Converts a stored video to an animated GIF with ffmpeg and sends it as a download.
router.get('/video-gif', async (req, res) => {
  const urlPath = uploadPathFromUrl(req.query.url);
  const file = urlPath ? resolveUploadPath(urlPath) : '';
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Video not found.' });
  const base = String(req.query.name || file.split(/[\\/]/).pop() || 'video').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'video';
  try {
    const { gifPath, cleanup } = await videoToGif(file);
    res.setHeader('Content-Type', 'image/gif');
    res.download(gifPath, `${base}.gif`, () => cleanup());
  } catch (err) {
    if (err instanceof GifBusyError) return res.status(429).json({ error: err.message });
    if (err instanceof FfmpegMissingError) return res.status(501).json({ error: err.message });
    console.warn('[media] GIF conversion failed:', err.message);
    return res.status(500).json({ error: 'Could not make the GIF.' });
  }
});

export default router;
