import fs from 'node:fs';
import { analyzeImage } from './router.js';
import { extractJsonObject } from './brandAnalysisService.js';
import { cleanProfileItems } from '../../utils/brandProfile.js';

// Reads a brand guidelines PDF (a multi-page document, read natively by the model) and sorts what Automatr needs into the
// Brand Assets boxes. Only instructions that change how a creative is made are kept. Returns cleaned items (from: 'pdf')
// plus the list of things it left out, so the super admin can see what was skipped.

const BOX_HELP = {
  essence: 'Who the brand is: vision, mission, values, personality. [{"label":"Vision","value":"one sentence"}]',
  voice: 'Tone of voice and messaging rules. [{"text":"...","tag":"Tone|Narrative|Key Messaging|Headlines|Sub Headlines|Post Copy"}]',
  layout: 'Grid, margins, alignment, where each element sits in a creative. [{"text":"..."}]',
  audiences: 'Who the brand talks to. [{"text":"..."}]',
  alwaysDo: 'Things every creative must do (short rules). [{"text":"..."}]',
  neverDo: 'Things no creative may do (short rules). [{"text":"..."}]',
  preferredWords: 'Words or phrases to use. [{"text":"one word or phrase"}]',
  avoidWords: 'Words or phrases to keep out. [{"text":"one word or phrase"}]',
  taglines: 'Approved taglines. [{"text":"..."}]',
  mandatory: 'Disclaimer / legal line that must appear on creatives. [{"text":"..."}]',
  logo: 'Logo rules: placement, clear space, minimum size, versions and when to use each, misuse. [{"text":"..."}]',
  images: 'Rules for photos and product shots. [{"text":"..."}]',
  graphic: 'Rules for graphics, icons, patterns and brand devices. [{"text":"..."}]',
  colourUse: 'Rules for using colour: proportions, tints, which colour for what, accessibility. [{"text":"..."}]',
  colourSwatches: 'Every brand colour with a name. [{"name":"Smart Red","hex":"#E52726","group":"Primary|Secondary","role":"Background|Text|Button or call to action|Highlight or accent|","note":"Pantone etc, optional"}]',
  refs: 'How PHOTOGRAPHY should look (people, places, products, lighting). [{"text":"..."}]',
  illustration: 'How ILLUSTRATION should look. [{"text":"..."}]',
  translation: 'What stays in English, what gets translated, localisation rules. [{"text":"..."}]'
};

const buildInstruction = (brandName) => [
  `You are a senior brand strategist reading the full brand guidelines${brandName ? ` of "${brandName}"` : ''} to set up an AI creative-automation tool.`,
  'Read every page. Keep ONLY what changes how a social, digital or print advertising creative is made. Leave out stationery, uniforms, vehicles, merchandise, web templates, research and anything else a creative generator does not need.',
  'Each item is one clear, checkable instruction in plain English, written as a rule (not as a description of the document). Never include hex codes, RGB or CMYK numbers inside a text field (colours go only in "colourSwatches"). Never mention page numbers inside text.',
  'For colours, read the values printed in the document. If only RGB or CMYK is printed, convert to hex precisely.',
  'Respond with ONLY a JSON object (no fences, no commentary):',
  JSON.stringify({
    items: Object.fromEntries(Object.keys(BOX_HELP).map((k) => [k, `array. ${BOX_HELP[k]} Add "p": page number to each item when you can tell. Use [] if the document says nothing.`])),
    fonts: '[{"family":"exact typeface name as printed","role":"Headline|Sub headline","weight":700,"note":"when to use it"}] - only typefaces the document names. Use the primary typeface for Headline and the supporting weight/typeface for Sub headline.',
    skipped: '["up to 6 short phrases naming the kinds of content you left out"]',
    pages: 'number of pages in the document if you can tell, else 0'
  }, null, 2),
  'Do not invent anything the document does not say. Prefer fewer, sharper items over many vague ones. Max 10 items per box.'
].join('\n');

/**
 * Returns { items, fonts, skipped, pages, modelUsed }. Items are cleaned and tagged from: 'pdf'.
 * Throws an Error with .status / .noAI when the PDF cannot be read.
 */
export async function readGuidelinesPdf({ filePath, brandName = '' }) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > 30 * 1024 * 1024) { const e = new Error('That PDF is over 30 MB. Export a smaller copy and try again.'); e.status = 413; throw e; }
  const r = await analyzeImage({ base64: bytes.toString('base64'), mimeType: 'application/pdf', instruction: buildInstruction(brandName), maxTokens: 6000, purpose: 'brand guidelines PDF' });
  if (!r.text) { const e = new Error(r.note || 'No AI provider is configured to read PDFs.'); e.noAI = true; e.isBillingError = r.isBillingError; throw e; }
  let parsed;
  try { parsed = JSON.parse(extractJsonObject(r.text.replace(/^```json|```$/gim, '').trim())); }
  catch { const e = new Error('The PDF was read but the answer could not be understood. Try again.'); e.status = 502; throw e; }
  const raw = parsed.items && typeof parsed.items === 'object' ? parsed.items : {};
  for (const k of Object.keys(raw)) if (Array.isArray(raw[k])) raw[k] = raw[k].map((x) => ({ ...x, from: 'pdf' }));
  const fonts = (Array.isArray(parsed.fonts) ? parsed.fonts : []).map((f) => ({ ...f, from: 'pdf' }));
  return {
    items: cleanProfileItems(raw),
    fonts,
    skipped: (Array.isArray(parsed.skipped) ? parsed.skipped : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
    pages: Math.max(0, parseInt(parsed.pages, 10) || 0),
    modelUsed: r.modelUsed || ''
  };
}
