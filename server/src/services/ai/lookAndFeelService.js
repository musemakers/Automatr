import * as router from './router.js';
import { getSettings } from '../appSettingsService.js';
import { getFormat } from '../../constants/postFormats.js';
import { MOOD_TAGS, STYLE_REFERENCES, LIGHTING_STYLES, COMPOSITION_STYLES } from '../../constants/lookAndFeel.js';
import { estimateTextCostUsdByProvider } from '../costEstimateService.js';
import { logUsageSafely } from '../aiUsageLogService.js';

function tokenEstimate(str) {
  return Math.ceil((str || '').length / 4);
}

/** Same "auto defers to admin's pinned default" resolution captionService.js uses. */
async function resolveEffectiveModel(requestedModel) {
  if (requestedModel && requestedModel !== 'auto') return requestedModel;
  try {
    const settings = await getSettings();
    return settings.copyModel || 'auto';
  } catch {
    return 'auto';
  }
}

// The same option lists the New Creative screen shows for people (keep in sync with pages/GenerateMedia.jsx).
const PEOPLE_COUNTS = ['One person', 'A couple / two people', 'A small group or family', 'A crowd'];
const PEOPLE_AGES = ['Children', 'Teens / young adults', 'Adults', 'Seniors'];
const PEOPLE_GENDERS = ['Only female', 'Only male'];
const PEOPLE_STYLES = ['Candid, natural moment', 'Posed portrait', 'At work / in action'];

const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** What the marketer has already filled in, so every suggestion is made for THIS brief and agrees with the other choices. */
function contextLines({ primaryMessage = '', moodTags = [], styleReferences = [], people = null }) {
  const p = people && typeof people === 'object' ? people : null;
  const peopleBits = p && p.peopleMode === 'include'
    ? [p.peopleCount, (p.peopleAge || []).join(' / '), p.peopleGender, p.peopleStyle, p.peopleNote].filter(Boolean).join('; ')
    : '';
  return [
    primaryMessage ? `Key message: ${clip(primaryMessage, 200)}` : '',
    moodTags.length ? `Mood already chosen: ${moodTags.join(', ')}.` : '',
    styleReferences.length ? `Visual style already chosen: ${styleReferences.join(', ')}.` : '',
    p?.peopleMode === 'none' ? 'People: the marketer chose NOT to show people.' : peopleBits ? `People already set: ${peopleBits}.` : ''
  ];
}

function buildPeoplePrompt({ purpose, briefNote, mediums, primaryMessage, moodTags, styleReferences, people }) {
  const format = getFormat(mediums?.[0]);
  return [
    'You are an art director deciding whether, and how, people should appear in one social media creative, before any image is generated.',
    `Purpose: ${purpose}.`,
    `Platform/placement: ${format.label} (${format.platform}).`,
    briefNote ? `The marketer's brief (read it closely, it may describe the people or the visual): ${briefNote}` : '',
    ...contextLines({ primaryMessage, moodTags, styleReferences, people: { ...(people || {}), peopleMode: '' } }),
    '',
    'Base every answer on what the brief and key message say. If they describe people (for example "three young women"), match them exactly: the count, ages and gender. If they are about a product, place or idea with no people, or the chosen visual style is product-led, answer "none". Never invent specifics the brief does not support: leave a field empty instead.',
    `Count options: ${JSON.stringify(PEOPLE_COUNTS)}`,
    `Age group options: ${JSON.stringify(PEOPLE_AGES)}`,
    `Gender options: ${JSON.stringify(PEOPLE_GENDERS)} (use "" for mixed or unspecified)`,
    `Appearance options: ${JSON.stringify(PEOPLE_STYLES)}`,
    'Respond with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this:',
    JSON.stringify({
      peopleMode: '"include" or "none"',
      peopleCount: 'one entry copied verbatim from the count options, or ""',
      peopleAge: ['0 to 2 entries copied verbatim from the age group options'],
      peopleGender: 'one entry copied verbatim from the gender options, or ""',
      peopleStyle: 'one entry copied verbatim from the appearance options, or ""',
      peopleNote: 'a short phrase (max 120 characters) of anything specific the brief says about the people, such as skin tones, clothing or what they are doing, or ""',
      rationale: 'one short sentence explaining the choice, for display to the marketer'
    }, null, 2)
  ].filter(Boolean).join('\n');
}

function buildPrompt({ purpose, briefNote, mediums, user, followBrand, primaryMessage, moodTags, styleReferences, people }) {
  const format = getFormat(mediums?.[0]);
  const dl = followBrand === false ? null : user?.brandKit?.designLanguage;

  return [
    'You are an art director choosing the visual direction for one social media creative, before any image is generated.',
    `Purpose: ${purpose}.`,
    `Platform/placement: ${format.label} (${format.platform}).`,
    briefNote ? `Extra context from the marketer: ${briefNote}` : '',
    ...contextLines({ primaryMessage, moodTags, styleReferences, people }),
    dl?.moodTags?.length ? `This brand's established mood (from an analyzed brand asset, weigh this heavily): ${dl.moodTags.join(', ')}.` : '',
    dl?.imageryStyle ? `This brand's established imagery style: ${dl.imageryStyle}.` : '',
    '',
    'Choose values ONLY from the exact option lists below - do not invent new ones, do not rephrase them, copy them verbatim.',
    `Mood/tone options: ${JSON.stringify(MOOD_TAGS)}`,
    `Visual style reference options: ${JSON.stringify(STYLE_REFERENCES)}`,
    `Lighting options: ${JSON.stringify(LIGHTING_STYLES)}`,
    `Composition options: ${JSON.stringify(COMPOSITION_STYLES)}`,
    '',
    'Respond with ONLY a JSON object (no markdown fences, no commentary, nothing before or after it) shaped exactly like this:',
    JSON.stringify(
      {
        moodTags: ['1 to 3 entries copied verbatim from the mood/tone options - pick what genuinely fits, do not just grab the first ones'],
        styleReferences: ['1 to 2 entries copied verbatim from the visual style reference options'],
        lightingStyle: 'exactly one entry copied verbatim from the lighting options',
        compositionStyle: 'exactly one entry copied verbatim from the composition options',
        rationale: 'one short sentence explaining the overall direction, for display to the marketer'
      },
      null,
      2
    )
  ]
    .filter(Boolean)
    .join('\n');
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

/** Keeps only values that are actually in the allowed list - never lets the model's picks introduce an option the UI doesn't render. */
function sanitizeList(values, allowed, max) {
  if (!Array.isArray(values)) return [];
  const clean = values.filter((v) => typeof v === 'string' && allowed.includes(v));
  return [...new Set(clean)].slice(0, max);
}

function sanitizeSingle(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : '';
}

/**
 * Suggests mood/style/lighting/composition picks for the "Look & feel" step,
 * grounded in the purpose + brief note (and the brand's own design language,
 * if one has been derived from an analyzed asset). Called before a post
 * exists, so this is stateless - it doesn't read or write anything, just
 * returns picks the client applies to its local wizard state.
 */
export async function suggestLookAndFeel({ purpose, briefNote = '', mediums = [], user, model = 'auto', usageContext, followBrand = true, section = '', primaryMessage = '', moodTags = [], styleReferences = [], people = null }) {
  const effectiveModel = await resolveEffectiveModel(model);
  const prompt = section === 'people'
    ? buildPeoplePrompt({ purpose, briefNote, mediums, primaryMessage, moodTags, styleReferences, people })
    : buildPrompt({ purpose, briefNote, mediums, user, followBrand, primaryMessage, moodTags, styleReferences, people });

  const { text, modelUsed, note } = await router.generateText({
    model: effectiveModel,
    system: 'You respond with strict, valid JSON only - no markdown fences, no commentary.',
    prompt,
    maxTokens: section === 'people' ? 500 : 400
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  if (modelUsed === 'placeholder') {
    throw new Error(note || 'No AI provider is configured to generate a suggestion. Add an API key in server/.env.');
  }

  const cleaned = text.replace(/^```json|```$/gim, '').trim();
  const jsonStr = extractJsonObject(cleaned);
  const parsed = JSON.parse(jsonStr);

  if (section === 'people') {
    const pick = (v, list) => (typeof v === 'string' && list.includes(v) ? v : '');
    return {
      peopleMode: parsed.peopleMode === 'include' ? 'include' : 'none',
      peopleCount: pick(parsed.peopleCount, PEOPLE_COUNTS),
      peopleAge: sanitizeList(parsed.peopleAge, PEOPLE_AGES, 2),
      peopleGender: pick(parsed.peopleGender, PEOPLE_GENDERS),
      peopleStyle: pick(parsed.peopleStyle, PEOPLE_STYLES),
      peopleNote: clip(parsed.peopleNote, 120),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 300) : '',
      modelUsed
    };
  }

  return {
    moodTags: sanitizeList(parsed.moodTags, MOOD_TAGS, 3),
    styleReferences: sanitizeList(parsed.styleReferences, STYLE_REFERENCES, 2),
    lightingStyle: sanitizeSingle(parsed.lightingStyle, LIGHTING_STYLES),
    compositionStyle: sanitizeSingle(parsed.compositionStyle, COMPOSITION_STYLES),
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 300) : '',
    modelUsed
  };
}
