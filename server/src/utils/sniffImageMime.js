/**
 * Real image type from the first bytes of a base64 image. File extensions and
 * client-declared MIME types are often wrong (a JPEG saved as .png), and
 * Anthropic rejects an image whose declared type doesn't match its bytes.
 * Returns the sniffed type, or `fallback` when the format isn't recognised.
 */
export function sniffImageMime(base64, fallback) {
  let b;
  try {
    b = Buffer.from(String(base64 || '').slice(0, 64), 'base64');
  } catch {
    return fallback;
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b.toString('latin1', 0, 4) === '%PDF') return 'application/pdf';
  return fallback;
}
