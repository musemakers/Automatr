import path from 'node:path';
import { aiLog } from './aiLog.js';
import sharp from 'sharp';
import { uploadDirPath } from '../middleware/upload.js';

// How much of the shorter canvas edge a single exact asset should occupy.
// Kept modest (like a logo lockup) rather than dominating the creative.
const TARGET_FRACTION = 0.22;
const MARGIN_FRACTION = 0.035;
const MAX_ASSETS_PER_CORNER = 3;
const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/**
 * Pastes "keep exact" assets (brand assets or reference creatives flagged
 * exact:true) onto an already-generated image completely unmodified - no
 * AI reinterpretation, no resampling artifacts beyond a simple resize to
 * fit the slot. This is the only way to actually guarantee "no
 * modification": asking an image model to reproduce a logo/asset exactly
 * is a prompt, not a guarantee, so exact assets are deliberately never
 * sent to the AI model as a reference image in the first place - see
 * resolveReferenceImages() in posts.controller.js.
 *
 * Each asset carries its own `anchor` corner (default 'bottom-right' for
 * assets that predate this field, e.g. brand-asset exact selections) -
 * this is what lets a logo sit bottom-right while a separate compliance/
 * QR element sits top-right in the same generation, rather than every
 * exact asset always stacking into one corner. Multiple assets at the
 * *same* corner stack inward from that corner, same as before.
 *
 * Silently returns the original URL unchanged if compositing fails for
 * any reason (corrupt file, unreadable format, etc) - this is a
 * finishing touch, not a step that should ever block a generation the
 * user is waiting on.
 *
 * @param {string} imageUrl - e.g. "/uploads/gen-xyz.png" (from saveGeneratedImage)
 * @param {Array<{filePath: string, mimeType: string, anchor?: string}>} exactAssets
 * @returns {Promise<string>} the (possibly unchanged) image URL
 */
export async function compositeExactAssets(imageUrl, exactAssets = []) {
  if (!imageUrl || !exactAssets.length) return imageUrl;

  try {
    const filename = path.basename(imageUrl);
    const basePath = path.join(uploadDirPath, filename);

    const base = sharp(basePath);
    const { width, height } = await base.metadata();
    if (!width || !height) return imageUrl;

    const slot = Math.round(Math.min(width, height) * TARGET_FRACTION);
    const margin = Math.round(Math.min(width, height) * MARGIN_FRACTION);

    // Group by corner, independently capped, so one corner being full
    // doesn't crowd out an asset meant for a different corner.
    const byCorner = new Map(CORNERS.map((c) => [c, []]));
    for (const asset of exactAssets) {
      const corner = CORNERS.includes(asset.anchor) ? asset.anchor : 'bottom-right';
      const bucket = byCorner.get(corner);
      if (bucket.length < MAX_ASSETS_PER_CORNER) bucket.push(asset);
    }

    const composites = [];

    for (const corner of CORNERS) {
      const assets = byCorner.get(corner);
      if (!assets.length) continue;

      const isRight = corner.endsWith('right');
      const isBottom = corner.startsWith('bottom');
      let cursor = margin; // distance from the anchor edge, grows as assets stack inward

      for (const asset of assets) {
        try {
          const resized = await sharp(asset.filePath)
            .resize({ width: slot, height: slot, fit: 'inside', withoutEnlargement: true })
            .toBuffer({ resolveWithObject: true });

          const { data, info } = resized;
          const left = isRight ? width - cursor - info.width : cursor;
          const top = isBottom ? height - margin - info.height : margin;
          if (left < 0 || top < 0) continue; // ran out of room - skip rather than overlap off-canvas

          composites.push({ input: data, left, top });
          cursor += info.width + Math.round(margin / 2);
        } catch {
          // One bad asset (unreadable file, unsupported format) shouldn't
          // sink the rest - skip it and keep going.
        }
      }
    }

    if (!composites.length) return imageUrl;

    aiLog('lock', 'done', { provider: 'sharp', msg: `pasted ${composites.length} exact brand asset(s) onto the finished image (logos / locked product)` });
    const outBuffer = await sharp(basePath).composite(composites).toBuffer();
    await sharp(outBuffer).toFile(basePath);
    return imageUrl;
  } catch (err) {
    console.warn('compositeExactAssets: skipped, keeping original image.', err.message);
    return imageUrl;
  }
}
