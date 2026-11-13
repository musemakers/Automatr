import sharp from 'sharp';

// Image models occasionally return a creative with a solid black band along an
// edge (letterbox/pillarbox, usually when a reference image has a different
// aspect ratio than the requested canvas). This finds such bands so the router
// can retry instead of showing a half-empty creative.
//
// A band counts only if it is (a) near-pure black across the full row/column,
// (b) at least MIN_FRACTION of that dimension deep, and (c) sits right next to
// clearly lit content - so a deliberately dark design that fades to black is
// not flagged.

const ANALYSIS_SIZE = 320;
const BLACK = 22; // luminance (0-255) at or below which a pixel counts as black
const ROW_BLACK_SHARE = 0.985; // share of pixels in a row/column that must be black
const MIN_FRACTION = 0.035; // band must cover at least 3.5% of that dimension
const CONTENT_LUMA = 45; // mean luminance of the strip just inside the band

export async function detectBlackBars(b64OrBuffer) {
  const input = Buffer.isBuffer(b64OrBuffer) ? b64OrBuffer : Buffer.from(b64OrBuffer, 'base64');
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  const rowShare = (y) => {
    let n = 0;
    for (let x = 0; x < W; x++) if (data[y * W + x] <= BLACK) n++;
    return n / W;
  };
  const colShare = (x) => {
    let n = 0;
    for (let y = 0; y < H; y++) if (data[y * W + x] <= BLACK) n++;
    return n / H;
  };
  const rowMean = (y0, y1) => {
    let s = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { s += data[y * W + x]; c++; }
    return c ? s / c : 0;
  };
  const colMean = (x0, x1) => {
    let s = 0, c = 0;
    for (let x = x0; x < x1; x++) for (let y = 0; y < H; y++) { s += data[y * W + x]; c++; }
    return c ? s / c : 0;
  };

  // depth (in px of the analysis image) of the black band starting at an edge
  const depth = (len, share, fromStart) => {
    let d = 0;
    while (d < len && share(fromStart ? d : len - 1 - d) >= ROW_BLACK_SHARE) d++;
    return d;
  };
  const bars = { top: depth(H, rowShare, true), bottom: depth(H, rowShare, false), left: depth(W, colShare, true), right: depth(W, colShare, false) };

  const out = { top: 0, bottom: 0, left: 0, right: 0 };
  const strip = (len) => Math.max(2, Math.round(len * 0.03));
  if (bars.top / H >= MIN_FRACTION && bars.top < H * 0.9 && rowMean(bars.top, bars.top + strip(H)) > CONTENT_LUMA) out.top = bars.top / H;
  if (bars.bottom / H >= MIN_FRACTION && bars.bottom < H * 0.9 && rowMean(H - bars.bottom - strip(H), H - bars.bottom) > CONTENT_LUMA) out.bottom = bars.bottom / H;
  if (bars.left / W >= MIN_FRACTION && bars.left < W * 0.9 && colMean(bars.left, bars.left + strip(W)) > CONTENT_LUMA) out.left = bars.left / W;
  if (bars.right / W >= MIN_FRACTION && bars.right < W * 0.9 && colMean(W - bars.right - strip(W), W - bars.right) > CONTENT_LUMA) out.right = bars.right / W;

  return { hasBars: Object.values(out).some((v) => v > 0), bars: out };
}
