import * as router from './router.js';
import { normBox, BOX_EXAMPLE, BOX_RULE } from '../../utils/normBox.js';
import { locateBoxes } from './boxLocator.js';

// Light-weight helpers for "Change Hero Image Only" (Generate Media):
//  - detectHero: names the hero subject of an uploaded creative, so the person
//    can see (and correct) what is going to be replaced.
//  - suggestHeroIdeas: a few alternative hero subjects to pick from.
const ANALYSIS_MODEL = process.env.TEMPLATE_ANALYSIS_MODEL || 'gpt';

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

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function buildInstruction() {
  return [
    'You are an art director looking at an existing advertising creative. Identify its HERO image: the single main visual subject that the creative is built around (a product, a person or people, a vehicle, a food dish, a building...).',
    'Respond with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:',
    JSON.stringify(
      {
        hasHero: 'boolean - there is a clear hero subject (not just text or a flat background)',
        heroes: [
          {
            description: 'one short phrase describing ONLY this hero subject itself, e.g. "young woman holding a red tote bag, three-quarter view" or "white SUV on a coastal road". No background, no text.',
            position: 'one short phrase on where it sits and how much of the frame it fills, e.g. "centre, fills about half the frame"',
            background: 'one short phrase describing the setting behind it, or "" if it is a plain/abstract backdrop',
            box: BOX_EXAMPLE
          }
        ]
      },
      null,
      2
    ),
    'List EVERY distinct main visual subject in the heroes array (each separate person, product or vehicle that is a visual focus - not logos, icons, small decorations or text), most prominent first, at most 6. A creative with one clear hero has exactly one entry. Never merge separate people or products into one entry.',
    BOX_RULE,
    'Base every field strictly on what is visible. If there is no clear hero, set hasHero to false and return an empty heroes array.'
  ].join('\n');
}

/**
 * Returns { skipped: true, reason } when detection is unavailable, otherwise
 * { skipped: false, modelUsed, hero: { hasHero, description, position, background } }.
 */
export async function detectHero({ buffer, mimeType }) {
  const { text, modelUsed, note } = await router.analyzeImage({
    purpose: 'identifying the hero image',
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
    const rawList = Array.isArray(parsed.heroes) && parsed.heroes.length ? parsed.heroes : parsed.description ? [parsed] : [];
    const heroes = rawList
      .map((h) => ({ description: str(h?.description, 200), position: str(h?.position, 160), background: str(h?.background, 160), box: normBox(h?.box) }))
      .filter((h) => h.description)
      .slice(0, 6);
    if (heroes.length && !heroes.some((h) => h.box)) console.warn('[hero-detect] model returned no usable boxes:', JSON.stringify(rawList.map((h) => h?.box)));
    // The detection call's own boxes are only rough: measure each one properly (grid + zoom + edge snap).
    const found = await locateBoxes({ buffer, firstPass: heroes.map((h) => h.box), items: heroes.map((h) => ({ label: `${h.description}${h.position ? ` (${h.position})` : ''}`, snapKey: 'keyVisual' })) });
    heroes.forEach((h, i) => { h.box = found[i] || h.box; });
    const first = heroes[0] || { description: '', position: '', background: '', box: null };
    const hero = {
      hasHero: Boolean(parsed.hasHero) && heroes.length > 0,
      description: first.description,
      position: first.position,
      background: first.background,
      box: first.box,
      heroes
    };
    return { skipped: false, modelUsed, hero };
  } catch (err) {
    console.warn('[hero-detect] failed to parse response:', err.message);
    return { skipped: true, reason: `The result could not be read: ${err.message}` };
  }
}

/** Alternative hero subjects, as short descriptions the image model can act on. */
export async function suggestHeroIdeas({ current, position, background, direction, image, exclude = [], count = 5 }) {
  const prompt = [
    image
      ? 'Look at this advertising creative. Its hero image is the one being replaced.'
      : 'An advertising creative has a hero image that is being replaced.',
    `Current hero: "${current}".`,
    position ? `Where it sits in the layout: ${position}.` : '',
    background ? `Setting around it: ${background}.` : '',
    direction ? `The marketer's direction for the replacement: ${direction}` : '',
    exclude.length ? `These ideas were already suggested, so do NOT repeat them or offer close variations of them - come up with fresh, clearly different ones:\n${exclude.map((e) => `- ${e}`).join('\n')}` : '',
    `Suggest ${count} different replacement hero images that fit THIS creative: each must suit the same product, category, audience and mood, and work at the same position, scale, orientation and camera angle as the current hero so it drops straight into the existing layout, lighting and colour palette without moving any text or logos. Each must be one concrete, visual sentence (subject, pose or arrangement, framing, setting cues) of under 25 words, describing a photographable subject. Make them clearly different from each other and from the current hero. Do not mention text, logos or brand names.`,
    'Respond with ONLY a JSON array of strings, nothing else - no markdown fences, no numbering.'
  ]
    .filter(Boolean)
    .join('\n');

  let text = '';
  let modelUsed;
  let note;
  if (image) {
    try {
      ({ text, modelUsed, note } = await router.analyzeImage({
        purpose: 'suggesting hero image ideas',
        model: ANALYSIS_MODEL,
        detail: 'high',
        base64: image.buffer.toString('base64'),
        mimeType: image.mimeType,
        instruction: prompt,
        maxTokens: 500
      }));
    } catch (err) {
      console.warn('[hero-ideas] image-based ideas failed, falling back to text:', err.message);
    }
  }
  if (!text) ({ text, modelUsed, note } = await router.generateText({ purpose: 'suggesting hero image ideas', model: 'auto', prompt, maxTokens: 450 }));

  let ideas = [];
  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
    ideas = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    ideas = String(text || '')
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s"']+/, '').replace(/["']$/, '').trim())
      .filter(Boolean);
  }
  const seen = new Set(exclude.map((e) => e.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  ideas = ideas
    .map((v) => str(v.replace(/^["']|["']$/g, ''), 220))
    .filter((v) => v && !seen.has(v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
    .slice(0, count);
  return { ideas, modelUsed, note };
}
