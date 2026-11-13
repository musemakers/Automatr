import sharp from 'sharp';

// Pixel-evidence box refinement ("snap to content").
// The vision model is only trusted for roughly WHERE an element is. We then
// build natural content blobs from the image's own edges at several
// grouping scales (glyph -> line -> block -> panel), and pick the blob that
// best agrees with the model's box. The final edges are therefore measured
// from pixels, not estimated by the model.

const PROC = 1100;

export async function loadMaps(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: PROC, height: PROC, fit: 'inside', withoutEnlargement: false })
    .blur(0.7)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const G = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let m = 0;
      const i = y * W + x;
      for (let c = 0; c < 3; c++) {
        const g = Math.abs(data[(i + 1) * C + c] - data[(i - 1) * C + c]) + Math.abs(data[(i + W) * C + c] - data[(i - W) * C + c]);
        if (g > m) m = g;
      }
      G[i] = m;
    }
  }
  return { W, H, G };
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
function median(arr) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.floor(s.length / 2)];
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy;
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}

// rectangular dilation of a window-local mask via running window counts
function dilate(mask, w, h, rx, ry) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(w, rx); x++) cnt += mask[row + x];
    for (let x = 0; x < w; x++) {
      if (x + rx < w) cnt += mask[row + x + rx];
      if (x - rx - 1 >= 0) cnt -= mask[row + x - rx - 1];
      tmp[row + x] = cnt > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y < Math.min(h, ry); y++) cnt += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + ry < h) cnt += tmp[(y + ry) * w + x];
      if (y - ry - 1 >= 0) cnt -= tmp[(y - ry - 1) * w + x];
      out[y * w + x] = cnt > 0 ? 1 : 0;
    }
  }
  return out;
}

// connected components of `dil`; each blob's bbox is measured on the ORIGINAL edge pixels (tight)
function blobs(dil, edge, w, h, free) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let s = 0; s < w * h; s++) {
    if (!dil[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0, touches = false;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      if (edge[p]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if ((x === 0 && !free.l) || (y === 0 && !free.t) || (x === w - 1 && !free.r) || (y === h - 1 && !free.b)) touches = true;
      if (x > 0 && dil[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && dil[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && dil[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && dil[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (n >= 6 && x1 >= x0) out.push({ box: [x0, y0, x1 + 1, y1 + 1], n, touches });
  }
  return out;
}


const SCALES = [0.0035, 0.007, 0.012, 0.02, 0.034]; // dilation radius as a fraction of min(W, H)
const EDGE_LEVELS = [110, 190]; // fixed, strong edge thresholds that isolate crisp overlays on busy photos

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const unionBox = (bs) => [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

// All content blobs near the model's box, at several edge strengths and grouping scales (window-local pixel boxes).
function blobCandidates({ W, H, G, R }) {
  const M = Math.min(W, H);
  const rw = R[2] - R[0], rh = R[3] - R[1];
  const sx = Math.max(rw * 0.6, W * 0.08), sy = Math.max(rh * 0.6, H * 0.08);
  const wx0 = clamp(Math.floor(R[0] - sx), 0, W), wx1 = clamp(Math.ceil(R[2] + sx), 0, W);
  const wy0 = clamp(Math.floor(R[1] - sy), 0, H), wy1 = clamp(Math.ceil(R[3] + sy), 0, H);
  const w = wx1 - wx0, h = wy1 - wy0;
  const samp = [];
  for (let y = wy0; y < wy1; y += 2) for (let x = wx0; x < wx1; x += 2) samp.push(G[y * W + x]);
  const tauLocal = Math.round(clamp(2.2 * median(samp), 28, 90));
  const free = { l: wx0 === 0, t: wy0 === 0, r: wx1 === W, b: wy1 === H };
  const tall = rh > rw * 2.2; // vertical text / thin vertical strips group along y first
  const cands = [];
  for (const tau of new Set([tauLocal, ...EDGE_LEVELS])) {
    const edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge[y * w + x] = G[(y + wy0) * W + x + wx0] > tau ? 1 : 0;
    for (const sc of SCALES) {
      const r = Math.max(1, Math.round(sc * M));
      const dil = tall ? dilate(edge, w, h, r, Math.round(r * 1.6)) : dilate(edge, w, h, Math.round(r * 1.6), r);
      for (const b of blobs(dil, edge, w, h, free)) {
        if (b.touches) continue;
        cands.push({ box: [b.box[0] + wx0, b.box[1] + wy0, b.box[2] + wx0, b.box[3] + wy0], tau, scale: sc });
      }
    }
  }
  return cands;
}

function pickBlob(R, cands, orient = false) {
  const ra = area(R);
  if (orient) {
    // text keeps the shape the model described: tall box -> tall content, wide box -> wide content
    const ar = (R[2] - R[0]) / (R[3] - R[1]);
    cands = cands.filter((c) => {
      const cr = (c.box[2] - c.box[0]) / (c.box[3] - c.box[1]);
      return ar < 1 / 2.2 ? cr < 1 / 2.2 : ar > 1.6 ? cr > 1.6 : true;
    });
  }
  let best = null;
  for (const c of cands) {
    const ratio = area(c.box) / ra;
    if (ratio < 0.12 || ratio > 3.5) continue;
    const i = inter(c.box, R);
    const score = i / (area(c.box) + ra - i);
    if (!best || score > best.score) best = { ...c, score };
  }
  if (best && best.score >= 0.1) return { box: best.box, score: best.score, via: 'blob' };
  // nothing overlaps the model's box (it missed the element entirely): take the nearest plausibly-sized blob
  const rc = centre(R);
  const diag = Math.hypot(R[2] - R[0], R[3] - R[1]);
  let near = null;
  for (const c of cands) {
    const ratio = area(c.box) / ra;
    if (ratio < 0.25 || ratio > 4) continue;
    const cc = centre(c.box);
    const d = Math.hypot(cc[0] - rc[0], cc[1] - rc[1]) / diag;
    if (d <= 1.2 && (!near || d < near.d)) near = { ...c, d };
  }
  return near ? { box: near.box, score: 0, via: 'blob-near' } : null;
}

// ───────────────────────── OCR-assisted text boxes ─────────────────────────
const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const similarity = (a, b) => (a || b ? 1 - editDistance(a, b) / Math.max(a.length, b.length) : 0);

function usableLines(ocr, W, H) {
  return (ocr || [])
    .map((l) => ({ text: l.text, conf: l.conf, vertical: Boolean(l.vertical), box: [l.box[0] * W, l.box[1] * H, l.box[2] * W, l.box[3] * H] }))
    .filter((l) => l.conf >= 35 && norm(l.text).length >= 2 && l.box[2] - l.box[0] > 2 && l.box[3] - l.box[1] > 2)
    .filter((l) => l.vertical || (l.box[2] - l.box[0]) / (l.box[3] - l.box[1]) > 0.8) // upright lines must be wider than tall (drops junk); sideways lines are the opposite
    .filter((l) => !l.vertical || (l.box[3] - l.box[1]) / (l.box[2] - l.box[0]) > 1.2);
}

function groupBlocks(lines) {
  const n = lines.length;
  const parent = lines.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = lines[i].box, b = lines[j].box;
      const ha = a[3] - a[1], hb = b[3] - b[1];
      if (Math.max(ha, hb) / Math.min(ha, hb) > 1.7) continue;
      const gap = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
      if (gap > 0.9 * Math.min(ha, hb) || gap < -0.5 * Math.min(ha, hb)) continue;
      const tol = 0.9 * Math.max(ha, hb);
      if (Math.abs(a[0] - b[0]) < tol || Math.abs(a[2] - b[2]) < tol || Math.abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) < tol * 1.5) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  lines.forEach((l, i) => (groups[find(i)] ||= []).push(l));
  return Object.values(groups).map((ls) => ({ lines: ls, box: unionBox(ls.map((l) => l.box)) }));
}

// every run of up to 6 consecutive lines whose text matches the literal; ties broken by closeness to the model's box
function matchLiteral(literal, lines, R) {
  const t = norm(literal);
  if (t.length < 3) return null;
  const found = [];
  const lists = [
    [...lines.filter((l) => !l.vertical)].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]),
    [...lines.filter((l) => l.vertical)].sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1])
  ];
  for (const sorted of lists) for (let i = 0; i < sorted.length; i++) {
    let s = '';
    let best = null;
    for (let j = i; j < Math.min(sorted.length, i + 6); j++) {
      s += norm(sorted[j].text);
      if (s.length > t.length * 1.6) break;
      const sim = similarity(s, t);
      if (!best || sim > best.sim + 0.02) best = { sim, lines: sorted.slice(i, j + 1) };
    }
    if (best && best.sim >= 0.55) found.push({ sim: best.sim, box: unionBox(best.lines.map((l) => l.box)) });
  }
  if (!found.length) return null;
  const top = Math.max(...found.map((f) => f.sim));
  const rc = centre(R);
  const diag = Math.hypot(R[2] - R[0], R[3] - R[1]) || 1;
  return found
    .filter((f) => f.sim >= top - 0.12)
    .map((f) => ({ ...f, d: Math.hypot(centre(f.box)[0] - rc[0], centre(f.box)[1] - rc[1]) / diag }))
    .sort((a, b) => a.d - b.d)[0];
}

function pickBlock(R, blocks) {
  const sx = (R[2] - R[0]) * 0.35, sy = (R[3] - R[1]) * 0.35;
  const Rexp = [R[0] - sx, R[1] - sy, R[2] + sx, R[3] + sy];
  let best = null;
  for (const b of blocks) {
    if (inter(b.box, Rexp) / area(b.box) < 0.55) continue;
    const i = inter(b.box, R);
    const v = i / (area(b.box) + area(R) - i);
    if (!best || v > best.v) best = { box: b.box, v };
  }
  return best && best.v >= 0.3 ? best : null;
}


// ───────────────── text strips without OCR ─────────────────
// Tiny or low-contrast print can't be read, but it can still be found: along a line of text the ink
// switches on and off with every letter, unlike line art, edges of objects or smooth gradients. Works
// for sideways text too (the box orientation tells us which way the line runs).
function stripOf(edge, w, h, lo = 0, hi = w) {
  // vertical text strip: returns [x0, y0, x1, y1] (window-local) and a strength, or null
  const trans = new Float32Array(w);
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) if (edge[y * w + x] && !edge[(y - 1) * w + x]) trans[x]++;
  const sorted = Float32Array.from(trans.subarray(Math.max(0, lo), Math.min(w, hi))).sort();
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const bw = Math.max(3, Math.round(Math.min(w, h) * 0.05));
  let best = -1, bx = 0;
  for (let x = Math.max(0, lo); x + bw <= Math.min(w, hi); x++) {
    let sum = 0;
    for (let k = 0; k < bw; k++) sum += trans[x + k];
    if (sum > best) { best = sum; bx = x; }
  }
  if (best < 8 || best < 2 * (med * bw + 1)) return null;
  // grow the band to every neighbouring column that still carries text-like activity
  let x0 = bx, x1 = bx + bw;
  const floor = Math.max(2, (best / bw) * 0.3);
  while (x0 > 0 && trans[x0 - 1] >= floor) x0--;
  while (x1 < w && trans[x1] >= floor) x1++;
  // rows with ink inside the band, bridged across small gaps -> the run with the most letters
  const rows = new Uint8Array(h);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (edge[y * w + x]) { rows[y] = 1; break; }
  const gap = Math.max(4, Math.round(h * 0.03));
  const runs = [];
  let s0 = -1, last = -1;
  for (let y = 0; y < h; y++) {
    if (!rows[y]) continue;
    if (s0 < 0) s0 = y;
    else if (y - last > gap) { runs.push([s0, last + 1]); s0 = y; }
    last = y;
  }
  if (s0 >= 0) runs.push([s0, last + 1]);
  let top = null, topScore = 0;
  for (const [a, b] of runs) {
    let sc = 0;
    for (let y = Math.max(1, a); y < b; y++) for (let x = x0; x < x1; x++) if (edge[y * w + x] && !edge[(y - 1) * w + x]) sc++;
    if (sc > topScore) { topScore = sc; top = [a, b]; }
  }
  if (!top || topScore < 8) return null;
  // tight x-extent of the ink inside the chosen rows
  let tx0 = x1, tx1 = x0;
  for (let y = top[0]; y < top[1]; y++) for (let x = x0; x < x1; x++) if (edge[y * w + x]) { if (x < tx0) tx0 = x; if (x + 1 > tx1) tx1 = x + 1; }
  return tx1 > tx0 ? { box: [tx0, top[0], tx1, top[1]], strength: topScore } : null;
}

function textRun({ W, H, G, R, orient }) {
  const rw = R[2] - R[0], rh = R[3] - R[1];
  const sx = Math.max(rw * 0.6, W * 0.08), sy = Math.max(rh * 0.6, H * 0.08);
  const wx0 = clamp(Math.floor(R[0] - sx), 0, W), wx1 = clamp(Math.ceil(R[2] + sx), 0, W);
  const wy0 = clamp(Math.floor(R[1] - sy), 0, H), wy1 = clamp(Math.ceil(R[3] + sy), 0, H);
  const w = wx1 - wx0, h = wy1 - wy0;
  const samp = [];
  for (let y = wy0; y < wy1; y += 2) for (let x = wx0; x < wx1; x += 2) samp.push(G[y * W + x]);
  const tauLocal = Math.round(clamp(2.2 * median(samp), 28, 90));
  let best = null;
  for (const tau of new Set([tauLocal, 70, 110])) {
    const edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge[y * w + x] = G[(y + wy0) * W + x + wx0] > tau ? 1 : 0;
    let r;
    const slackX = (R[2] - R[0]) * 0.5, slackY = (R[3] - R[1]) * 0.5;
    if (orient === 'v') r = stripOf(edge, w, h, Math.floor(R[0] - slackX - wx0), Math.ceil(R[2] + slackX - wx0));
    else {
      const t = new Uint8Array(w * h); // transpose so a horizontal line becomes a vertical strip
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = edge[y * w + x];
      const q = stripOf(t, h, w, Math.floor(R[1] - slackY - wy0), Math.ceil(R[3] + slackY - wy0));
      r = q && { box: [q.box[1], q.box[0], q.box[3], q.box[2]], strength: q.strength };
    }
    if (r && (!best || r.strength > best.strength)) best = r;
  }
  if (!best) return null;
  const b = [best.box[0] + wx0, best.box[1] + wy0, best.box[2] + wx0, best.box[3] + wy0];
  // must be close to where the model pointed
  const rc = centre(R), bc = centre(b);
  if (Math.hypot(bc[0] - rc[0], bc[1] - rc[1]) > 0.8 * Math.hypot(rw, rh) + 0.03 * Math.min(W, H)) return null;
  return { box: b, via: 'text-strip' };
}

const TEXT_KEYS = new Set(['primaryHeadline', 'secondaryText', 'complianceText', 'logo']);
const PAD = 1;
const ORIENT_KEYS = new Set(['primaryHeadline', 'secondaryText', 'complianceText']);
const LARGE_KEYS = new Set(['keyVisual', 'decorative', 'background']);

const toNorm = (b, W, H, pad = PAD) => {
  const x0 = clamp(b[0] - pad, 0, W), y0 = clamp(b[1] - pad, 0, H), x1 = clamp(b[2] + pad, 0, W), y1 = clamp(b[3] + pad, 0, H);
  return [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H];
};

/**
 * @param {Buffer} buffer the original image
 * @param {Object<string,[number,number,number,number]>} regions model boxes, normalized [x,y,w,h]
 * @param {{texts?: Object<string,string>, ocr?: Array|null, maps?: object}} opts
 *   texts: literal text the model read for text elements (headline etc.) - used to find them by OCR no matter where the model placed them
 * @returns {Promise<Object<string,{box: number[], snapped: boolean, via: string}>>}
 */
export async function snapRegions(buffer, regions, { texts = {}, ocr, maps } = {}) {
  const m = maps || (await loadMaps(buffer));
  const { W, H } = m;
  const lines = usableLines(ocr, W, H);
  const blocks = lines.length ? [...groupBlocks(lines.filter((l) => !l.vertical)), ...lines.filter((l) => l.vertical).map((l) => ({ lines: [l], box: l.box }))] : [];
  const out = {};
  for (const [key, nb] of Object.entries(regions)) {
    const R = [nb[0] * W, nb[1] * H, (nb[0] + nb[2]) * W, (nb[1] + nb[3]) * H];
    if (R[2] - R[0] < 4 || R[3] - R[1] < 4) { out[key] = { box: nb, snapped: false, via: 'none', reason: 'tiny' }; continue; }
    let hit = null;
    if (TEXT_KEYS.has(key) && lines.length) {
      const lit = texts[key] ? matchLiteral(texts[key], lines, R) : null;
      if (lit) {
        hit = { box: lit.box, via: 'ocr-text' };
        if (key === 'logo') {
          // a logo is usually wordmark + mark: widen to the smallest blob that contains the wordmark
          const wa = area(lit.box);
          const around = blobCandidates({ ...m, R: lit.box })
            .filter((c) => inter(c.box, lit.box) / wa >= 0.9 && area(c.box) <= 6 * wa && area(c.box) > wa * 1.05)
            .sort((a, b) => area(a.box) - area(b.box));
          if (around.length) {
            // prefer the blob that also agrees with the model's box
            const agree = around.filter((c) => inter(c.box, R) / area(c.box) > 0.5);
            hit = { box: (agree[0] || around[0]).box, via: 'ocr-text+blob' };
          }
        }
      } else {
        const blk = pickBlock(R, blocks);
        if (blk) hit = { box: blk.box, via: 'ocr-block' };
      }
    }
    if (!hit && key === 'complianceText') {
      const ar = (R[2] - R[0]) / (R[3] - R[1]);
      if (ar < 1 / 2.2 || ar > 2.5) hit = textRun({ ...m, R, orient: ar < 1 ? 'v' : 'h' });
    }
    if (!hit) {
      hit = pickBlob(R, blobCandidates({ ...m, R }), ORIENT_KEYS.has(key));
      // Large photographic subjects have no crisp outline to measure: only refine the model's box when
      // a blob clearly agrees with it, otherwise keep the model's box rather than snap to the wrong thing.
      if (hit && LARGE_KEYS.has(key)) {
        const ratio = area(hit.box) / area(R);
        if (hit.via !== 'blob' || hit.score < 0.55 || ratio < 0.6 || ratio > 1.7) hit = null;
      }
    }
    out[key] = hit ? { box: toNorm(hit.box, W, H), snapped: true, via: hit.via } : { box: nb, snapped: false, via: 'none', reason: 'no evidence' };
  }
  return out;
}
