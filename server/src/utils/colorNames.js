// Image models render literal text they find in a prompt. A brand palette
// written as "#707766, #315992" ends up printed on the creative - and
// telling the model "never render these hex codes" doesn't help (it
// reinforces the string). The only reliable fix is for hex codes never to
// reach the model at all, so every hex colour is rewritten into a plain
// colour description ("deep blue") before the prompt is sent.

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

export function hexToColorName(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  h = h.slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 'neutral tone';
  const { h: hue, s, l } = rgbToHsl(r, g, b);

  if (l < 0.1) return 'near-black';
  if (l > 0.94) return 'off-white';
  if (s < 0.1) {
    if (l < 0.3) return 'charcoal grey';
    if (l < 0.55) return 'mid grey';
    if (l < 0.8) return 'light grey';
    return 'soft off-white';
  }

  let family;
  if (hue < 15 || hue >= 345) family = 'red';
  else if (hue < 40) family = l < 0.42 ? 'brown' : 'orange';
  else if (hue < 65) family = l < 0.4 ? 'olive' : 'yellow';
  else if (hue < 90) family = 'olive green';
  else if (hue < 165) family = 'green';
  else if (hue < 190) family = 'teal';
  else if (hue < 205) family = 'cyan';
  else if (hue < 255) family = 'blue';
  else if (hue < 290) family = 'purple';
  else family = l > 0.7 ? 'pink' : 'magenta';

  const light = l < 0.25 ? 'deep ' : l > 0.8 ? 'pale ' : l > 0.65 ? 'light ' : '';
  const sat = s < 0.35 ? 'muted ' : '';
  return `${light || ''}${sat}${family}`.trim();
}

// 6/8-digit hex always; 3-digit only when it can't be a hashtag-like word
// (contains a digit, or is a repeated letter such as #fff / #ccc).
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;

export function describeHexColors(text) {
  if (typeof text !== 'string' || !text.includes('#')) return text;
  return text.replace(HEX_RE, (m) => {
    const digits = m.slice(1);
    if (digits.length === 3 && !/\d/.test(digits) && !/^(.)\1\1$/.test(digits.toLowerCase())) return m;
    return hexToColorName(digits);
  });
}
