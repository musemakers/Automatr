// Detection boxes arrive from a vision model, so they come in many shapes: { x, y, w, h },
// { x, y, width, height }, { left, top, right, bottom }, { x1, y1, x2, y2 }, [x, y, w, h],
// as fractions (0-1), percent (0-100) or thousandths (0-1000). Normalise all of them to
// fractions of the image { x, y, w, h }, clamp, and return null for anything unusable
// (callers then simply draw no outline).
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

export function normBox(raw) {
  if (!raw) return null;
  let x;
  let y;
  let w;
  let h;
  if (Array.isArray(raw)) {
    [x, y, w, h] = raw.map(num);
  } else if (typeof raw === 'object') {
    x = num(raw.x ?? raw.left ?? raw.x1 ?? raw.xmin);
    y = num(raw.y ?? raw.top ?? raw.y1 ?? raw.ymin);
    w = num(raw.w ?? raw.width);
    h = num(raw.h ?? raw.height);
    const x2 = num(raw.x2 ?? raw.right ?? raw.xmax);
    const y2 = num(raw.y2 ?? raw.bottom ?? raw.ymax);
    if (!Number.isFinite(w) && Number.isFinite(x2)) w = x2 - x;
    if (!Number.isFinite(h) && Number.isFinite(y2)) h = y2 - y;
  } else {
    return null;
  }
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const top = Math.max(x + w, y + h, x, y, w, h);
  const scale = top > 100 ? 1000 : top > 1.5 ? 100 : 1;
  [x, y, w, h] = [x, y, w, h].map((n) => n / scale);
  x = Math.min(1, Math.max(0, x));
  y = Math.min(1, Math.max(0, y));
  w = Math.min(1 - x, Math.max(0, w));
  h = Math.min(1 - y, Math.max(0, h));
  if (w < 0.02 || h < 0.01) return null;
  const r = (n) => Math.round(n * 1000) / 1000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

// Shown to the model as the value of "box" in the example JSON, so it answers with real numbers.
export const BOX_EXAMPLE = { x: 0.12, y: 0.2, w: 0.4, h: 0.3 };
export const BOX_RULE =
  'For every entry, "box" MUST be filled in: the tight bounding box of that entry as fractions of the WHOLE image, with x = left edge, y = top edge, w = width, h = height, all numbers between 0 and 1 (for example a subject filling the right half of the image is {"x":0.5,"y":0,"w":0.5,"h":1}).';
