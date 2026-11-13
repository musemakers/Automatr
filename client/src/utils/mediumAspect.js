import { getFormat } from '../constants/postFormats.js';

// Extra CSS modifier class (beyond the default portrait shape) needed for
// a given format's orientation - "" for portrait since that's the default
// .preview-canvas shape already.
export function previewCanvasClass(formatId) {
  const orientation = getFormat(formatId).orientation;
  if (orientation === 'landscape') return 'preview-canvas wide';
  if (orientation === 'square') return 'preview-canvas square';
  return 'preview-canvas';
}

export function imageOptionCanvasModifier(formatId) {
  const orientation = getFormat(formatId).orientation;
  if (orientation === 'landscape') return 'image-option-card__canvas--wide';
  if (orientation === 'square') return 'image-option-card__canvas--square';
  return '';
}

// The .wide/.square/default modifier classes above only bucket a format
// into one of 3 generic shapes (3:2, 1:1, 2:3) - fine for picking a rough
// skeleton shape before anything has loaded, but most real formats don't
// actually match any of those 3 ratios exactly (Instagram Feed is 4:5,
// Stories/Reels are 9:16, Facebook/LinkedIn Feed are 1.91:1, X is 16:9 -
// none of which equal 2:3 / 3:2 / 1:1). Since images are now generated at
// the format's true pixel ratio (see postFormats.js + openai.js arbitrary
// dimension support), the preview frame should match that same true ratio
// exactly, rather than force the image into the nearest generic bucket and
// let object-fit:cover crop away the difference. Pass this as an inline
// `style={{ aspectRatio: ... }}` alongside the modifier class (which still
// usefully sets the loading-skeleton background/orientation) to make the
// frame itself the correct shape.
export function previewAspectRatio(formatId) {
  const [w, h] = getFormat(formatId).ratio.split(':').map(Number);
  if (!w || !h) return undefined;
  return `${w} / ${h}`;
}

export { getFormat };
