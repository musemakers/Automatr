import * as router from './router.js';
import { normBox, BOX_EXAMPLE, BOX_RULE } from '../../utils/normBox.js';
import { locateBoxes } from './boxLocator.js';

// Lightweight, text-only counterpart to templateAnalysisService.js: used by
// the "Edit Headline Only" mode of Generate Media to find the headline and
// sub-headline(s) printed on an uploaded creative, so the person can change
// just those lines. Each line also carries an approximate bounding box so the
// UI can outline it on the image; the box is only a visual aid (it may be null)
// and the edit step keeps everything else untouched anyway.
const ANALYSIS_MODEL = process.env.TEMPLATE_ANALYSIS_MODEL || 'gpt';

function buildInstruction() {
  return [
    'You are reading an existing advertising creative. Find the main headline and any sub-headline text that is printed on the image so an editor can reword just those lines.',
    'Respond with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:',
    JSON.stringify(
      {
        lines: [
          {
            role: '"headline" for the single largest / most prominent message, or "subheadline" for a smaller supporting line (tagline, secondary callout) that is NOT small print',
            text: 'the literal text exactly as written on the image, keeping its line breaks as spaces. Keep the original spelling, punctuation and capitalisation',
            position: 'short phrase on where it sits and how it looks (e.g. "top-left, large white bold serif")',
            box: BOX_EXAMPLE
          }
        ]
      },
      null,
      2
    ),
    BOX_RULE,
    'Rules: at most ONE "headline" and at most TWO "subheadline" entries, ordered headline first then top-to-bottom. Do NOT include logos or brand names that are part of a logo, phone numbers, URLs, addresses, legal/disclaimer small print, prices inside badges, or button/CTA labels. If a line is illegible, leave it out. If no headline-style text exists, respond {"lines": []}.'
  ].join('\n');
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response.');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('JSON object in response was not properly closed (possibly truncated).');
}

function sanitize(parsed) {
  const raw = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines = [];
  let headlines = 0;
  let subs = 0;
  for (const l of raw) {
    const text = typeof l?.text === 'string' ? l.text.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    if (!text) continue;
    const isHead = String(l?.role || '').toLowerCase().startsWith('head') && headlines === 0;
    if (isHead) {
      headlines += 1;
      lines.push({ id: 'headline', role: 'headline', label: 'Headline', text, position: String(l?.position || '').slice(0, 120), box: normBox(l?.box) });
    } else if (subs < 2) {
      subs += 1;
      lines.push({ id: `subheadline${subs}`, role: 'subheadline', label: subs === 1 ? 'Sub-headline' : 'Sub-headline 2', text, position: String(l?.position || '').slice(0, 120), box: normBox(l?.box) });
    }
  }
  // headline first
  lines.sort((a, b) => (a.role === b.role ? 0 : a.role === 'headline' ? -1 : 1));
  return lines;
}

/**
 * Returns { skipped: true, reason } when detection is unavailable/fails
 * (the client then lets the person type the lines manually), otherwise
 * { skipped: false, modelUsed, lines: [{ id, role, label, text, position }] }.
 */
export async function detectHeadlineLines({ buffer, mimeType }) {
  const { text, modelUsed, note } = await router.analyzeImage({
    purpose: 'finding the headline and sub-headline',
    model: ANALYSIS_MODEL,
    detail: 'high',
    base64: buffer.toString('base64'),
    mimeType,
    instruction: buildInstruction(),
    maxTokens: 700
  });
  if (!text) return { skipped: true, reason: note || 'No AI provider is configured for image analysis.' };

  try {
    const parsed = JSON.parse(extractJsonObject(text.replace(/^```json|```$/gim, '').trim()));
    const lines = sanitize(parsed);
    const found = await locateBoxes({ buffer, firstPass: lines.map((l) => l.box), items: lines.map((l) => ({ label: `the text "${l.text}"${l.position ? ` (${l.position})` : ''}`, text: l.text, snapKey: l.role === 'headline' ? 'primaryHeadline' : 'secondaryText' })) });
    lines.forEach((l, i) => { l.box = found[i] || l.box; });
    if (lines.length && !lines.some((l) => l.box)) console.warn('[headline-detect] model returned no usable boxes:', JSON.stringify((parsed.lines || []).map((l) => l?.box)));
    return { skipped: false, modelUsed, lines };
  } catch (err) {
    console.warn('[headline-detect] failed to parse response:', err.message);
    return { skipped: true, reason: `The result could not be read: ${err.message}` };
  }
}
