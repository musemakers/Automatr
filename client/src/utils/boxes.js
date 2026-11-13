// Boxes are { x, y, w, h } as fractions (0-1) of the image. describeBox turns one into words
// the image model can act on ("the upper-left area, about a third of the width and half the height").
const third = (v) => (v < 0.34 ? 0 : v < 0.67 ? 1 : 2);
const size = (v) => (v > 0.8 ? 'almost the full' : v > 0.55 ? 'over half the' : v > 0.4 ? 'about half the' : v > 0.28 ? 'about a third of the' : 'a small part of the');

export function describeBox(box) {
  if (!box) return '';
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const col = ['left', 'centre', 'right'][third(cx)];
  const row = ['upper', 'middle', 'lower'][third(cy)];
  const place = row === 'middle' && col === 'centre' ? 'the centre of the image' : row === 'middle' ? `the ${col} side of the image` : col === 'centre' ? `the ${row} centre of the image` : `the ${row}-${col} area of the image`;
  return `located in ${place}, spanning ${size(box.w)} width and ${size(box.h)} height`;
}

export const pct = (v) => `${(v * 100).toFixed(2)}%`;
