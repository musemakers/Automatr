// Small helpers shared by the video screens (Convert to Video and the New Creative video steps).

// Idea categories shown under the "Basic" tab; everything else is "Advanced".
// (Same split the older Generate Designs video card uses - see videoIdeasService on the server.)
export const BASIC_IDEA_CATEGORIES = ['subject', 'text', 'environment', 'light'];

export const VIDEO_ERROR = 'We couldn’t create your video. Your selections are saved, so you can try again.';

export const pad2 = (n) => String(n).padStart(2, '0');

export function measureImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The server turns the chosen size into the nearest shape the video model supports and crops to the exact size. */
export const SIZE_MIN = 16;
export const SIZE_MAX = 8000;
export const validSize = (s) => Boolean(s && s.w >= SIZE_MIN && s.h >= SIZE_MIN && s.w <= SIZE_MAX && s.h <= SIZE_MAX);

export const sizeText = (s) => (s ? `${s.w} × ${s.h} px` : '');

/** The size the clip is actually rendered at (the server caps the long edge at 1920 px and keeps both sides even). */
export function outputSize(s) {
  if (!s) return null;
  const k = Math.min(1, 1920 / Math.max(s.w, s.h));
  const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(s.w), h: even(s.h) };
}
