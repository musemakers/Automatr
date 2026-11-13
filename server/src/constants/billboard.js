// Billboard print files: sizes and print specs (India roadside hoardings).
// Artwork is built at a reduced scale and 150 PPI - the usual way large-format printers take billboard files.
// Normal boards use 1:10 (a 20 x 10 ft board is a 24 x 12 in file, 3600 x 1800 px, that the printer enlarges 10x).
// Very large boards drop to 1:20 (or 1:40) so the file stays a workable size; the scale is written into the file name and PDF.
export const BILLBOARD_PPI = 150;
export const SCALES = [10, 20, 40]; // tried in order: the first one whose file fits MAX_TRIM_PIXELS is used
export const BLEED_REAL_IN = 5; // bleed on the real board, per side (0.5 in on a 1:10 file)
export const SAFE_FRACTION = 0.05; // keep key content this far in from every trim edge
export const CUSTOM_FT_MIN = 3;
export const CUSTOM_FT_MAX = 100;
export const MAX_TRIM_PIXELS = 30e6; // keeps the biggest files (and the memory needed to make them) reasonable
export const DOOH_DEFAULT_WIDTH = 1920;

// Sizes seen on Indian rate cards (they vary by city, owner and structure; Custom covers the rest).
export const BILLBOARD_PRESETS = [
  { id: '20x10', label: '20 × 10 ft', widthFt: 20, heightFt: 10, note: 'Common roadside format' },
  { id: '30x10', label: '30 × 10 ft', widthFt: 30, heightFt: 10, note: 'Wide roadside format' },
  { id: '30x15', label: '30 × 15 ft', widthFt: 30, heightFt: 15, note: 'Mid-size hoarding' },
  { id: '30x20', label: '30 × 20 ft', widthFt: 30, heightFt: 20, note: 'Arterial road hoarding' },
  { id: '40x20', label: '40 × 20 ft', widthFt: 40, heightFt: 20, note: 'Highway hoarding / unipole' },
  { id: '40x30', label: '40 × 30 ft', widthFt: 40, heightFt: 30, note: 'Large landmark hoarding' },
  { id: '60x20', label: '60 × 20 ft', widthFt: 60, heightFt: 20, note: 'Wide expressway hoarding' },
  { id: '60x30', label: '60 × 30 ft', widthFt: 60, heightFt: 30, note: 'Landmark / gateway site' },
  { id: '20x20', label: '20 × 20 ft', widthFt: 20, heightFt: 20, note: 'Square hoarding' },
  { id: '10x20', label: '10 × 20 ft', widthFt: 10, heightFt: 20, note: 'Portrait hoarding' },
  { id: '6x4', label: '6 × 4 ft', widthFt: 6, heightFt: 4, note: 'Small format / kiosk' },
  { id: '48x14', label: '48 × 14 ft', widthFt: 48, heightFt: 14, note: 'Bulletin (48-sheet)' }
];

export const OUTPUT_KINDS = ['tiff', 'pdf', 'preview', 'dooh'];

/** Smallest reduction (1:10, then 1:20, 1:40) whose trim file fits MAX_TRIM_PIXELS; null when none does. */
export function scaleFor(widthFt, heightFt) {
  for (const sc of SCALES) {
    const k = (12 / sc) * BILLBOARD_PPI;
    if (Math.round(widthFt * k) * Math.round(heightFt * k) <= MAX_TRIM_PIXELS) return sc;
  }
  return null;
}

/** Working numbers for a board size (ft). Returns null when the size is out of range. */
export function specFor(widthFt, heightFt) {
  const w = Number(widthFt);
  const h = Number(heightFt);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < CUSTOM_FT_MIN || h < CUSTOM_FT_MIN || w > CUSTOM_FT_MAX || h > CUSTOM_FT_MAX) return null;
  const scale = scaleFor(w, h);
  if (!scale) return null;
  const inchesPerFt = 12 / scale;
  const trimW = Math.round(w * inchesPerFt * BILLBOARD_PPI);
  const trimH = Math.round(h * inchesPerFt * BILLBOARD_PPI);
  const bleedPx = Math.round((BLEED_REAL_IN / scale) * BILLBOARD_PPI);
  return {
    widthFt: w, heightFt: h,
    ratio: w / h,
    trimW, trimH, bleedPx,
    fullW: trimW + bleedPx * 2, fullH: trimH + bleedPx * 2,
    fileInches: { w: +(w * inchesPerFt).toFixed(2), h: +(h * inchesPerFt).toFixed(2) },
    ppi: BILLBOARD_PPI, scale
  };
}

export const feetLabel = (w, h) => `${+Number(w).toFixed(1)}x${+Number(h).toFixed(1)}ft`;
