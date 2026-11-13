import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { uploadDir, uploadUrl } from './storage.js';

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

// Accepts "4:5", "1.91:1", "16:9", etc. Returns a plain width/height number,
// or null if the string isn't parseable (caller then just skips cropping).
function parseRatio(ratioStr) {
  if (!ratioStr) return null;
  const parts = ratioStr.split(':').map((n) => Number(n.trim()));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts[0] / parts[1];
}

/**
 * Center-crops a buffer to exactly match a target aspect ratio, only ever
 * cropping (never upscaling/stretching) - so a 2:3 image requested against
 * a 4:5 slot loses a sliver off the long edge rather than being distorted
 * or left pillarboxed. Different image providers (OpenAI's fixed size enum,
 * Seedream's megapixel-floor-driven upscale, etc.) rarely return pixel-exact
 * matches for our platform ratios, so every generated image is normalized
 * here rather than trusting the provider's output dimensions directly -
 * this is what was causing Seedream images to render with visible
 * borders/empty space instead of filling the frame edge-to-edge.
 */
async function cropToRatio(buffer, targetRatio) {
  const image = sharp(buffer);
  const { width, height } = await image.metadata();
  if (!width || !height) return buffer;

  const currentRatio = width / height;
  // Close enough already (within ~1%) - skip the extra encode/decode pass.
  if (Math.abs(currentRatio - targetRatio) / targetRatio < 0.01) return buffer;

  let cropWidth = width;
  let cropHeight = height;
  if (currentRatio > targetRatio) {
    // Wider than target - trim off the sides.
    cropWidth = Math.round(height * targetRatio);
  } else {
    // Taller than target - trim off the top/bottom.
    cropHeight = Math.round(width / targetRatio);
  }

  const left = Math.floor((width - cropWidth) / 2);
  const top = Math.floor((height - cropHeight) / 2);

  return sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
}

/**
 * Writes a base64 image to the uploads directory and returns a public URL path.
 * @param {{b64: string, mimeType: string}} image
 * @param {string} [targetRatio] - e.g. "4:5", the platform format's declared
 *   ratio. When provided, the image is center-cropped to match it exactly
 *   before saving, regardless of what raw dimensions the provider returned.
 * @returns {Promise<string>} url path, e.g. /uploads/xyz.png
 */
export async function saveGeneratedImage({ b64, mimeType }, targetRatio) {
  const ext = EXT_BY_MIME[mimeType] || 'png';
  const filename = `gen-${uuidv4()}.${ext}`;
  const filePath = path.join(uploadDir(), filename);

  let buffer = Buffer.from(b64, 'base64');
  const parsedRatio = parseRatio(targetRatio);
  if (parsedRatio) {
    try {
      buffer = await cropToRatio(buffer, parsedRatio);
    } catch (err) {
      // Never let a cropping failure block the whole generation - worst
      // case the image keeps its original (possibly mismatched) framing.
      console.warn('[saveGeneratedImage] crop-to-ratio failed, saving original framing:', err.message);
    }
  }

  fs.writeFileSync(filePath, buffer);
  return uploadUrl(filename);
}
