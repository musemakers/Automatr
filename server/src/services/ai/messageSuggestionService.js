import * as router from './router.js';
import { getSettings } from '../appSettingsService.js';
import { getFormat } from '../../constants/postFormats.js';
import { estimateTextCostUsdByProvider } from '../costEstimateService.js';
import { logUsageSafely } from '../aiUsageLogService.js';
import { brandGuideLines } from '../../utils/brandGuide.js';

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

const IMPROVE_LABELS = {
  primaryMessage: 'key message',
  contextBrief: 'context in brief',
  visualDescription: 'visual description'
};

function buildPrompt({ purpose, briefNote, mediums, moodTags, styleReferences, user, followBrand, improve }) {
  const improveText = improve && IMPROVE_LABELS[improve.field] && typeof improve.text === 'string' ? improve.text.trim().slice(0, 700) : '';
  const format = getFormat(mediums?.[0]);
  const dl = followBrand === false ? null : user?.brandKit?.designLanguage;

  return [
    'You are a marketing strategist defining the core message and creative constraints for one social media post, before any copy or image is generated.',
    `Purpose: ${purpose}.`,
    `Platform/placement: ${format.label} (${format.platform}).`,
    briefNote ? `Extra context from the marketer: ${briefNote}` : '',
    moodTags?.length ? `Chosen mood/tone: ${moodTags.join(', ')}.` : '',
    styleReferences?.length ? `Chosen visual style: ${styleReferences.join(', ')}.` : '',
    dl?.summary ? `This brand's design language: ${dl.summary}` : '',
    dl?.voiceTone ? `This brand's tone of voice: ${dl.voiceTone}` : '',
    ...(followBrand === false ? [] : brandGuideLines(user?.brandKit, 'copy')),
    user?.company?.name ? `Brand: ${user.company.name}${user?.company?.industry ? ` (${user.company.industry})` : ''}.` : '',
    improveText
      ? `The marketer has already written the ${IMPROVE_LABELS[improve.field]}: "${improveText}". REWRITE it into a clearly better version. Keep their intent and every fact they gave and invent no new facts, but you MUST change it: use stronger, more specific wording, a sharper structure and better rhythm. Never return the original or a near-copy of it, even when it is already well written: a good draft can still be made more vivid, more concrete or tighter. Return the rewritten version in the "${improve.field}" field (do not start from scratch).`
      : '',
    '',
    'Respond with ONLY a JSON object (no markdown fences, no commentary, nothing before or after it) shaped exactly like this:',
    JSON.stringify(
      {
        primaryMessage: 'one short, concrete sentence - the single thing this creative should communicate at a glance. Specific, not generic filler.',
        contextBrief: 'two or three short sentences of context for the brief: what the marketer wants to communicate or achieve, who it is for, and what they should feel or do next',
        visualDescription: 'one or two sentences describing what the image should show: the subject, setting and details that matter',
        rationale: 'one short sentence explaining the reasoning, for display to the marketer'
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

function sanitizeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Suggests the "Message & constraints" step's fields (primary message, must
 * include, must avoid) from the purpose/brief/mood/style chosen so far.
 * Stateless, same as suggestLookAndFeel - no post exists yet at this point
 * in the wizard, so this just returns text the client applies locally.
 */
// Improve must never hand the marketer's own text back. Compares by words so a re-punctuated or re-capitalised copy still counts as unchanged.
const words = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function nearlySame(a, b) {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const sx = new Set(x), sy = new Set(y);
  let inter = 0;
  for (const w of sx) if (sy.has(w)) inter += 1;
  return inter / (sx.size + sy.size - inter) >= 0.85;
}

export async function suggestMessage({ purpose, briefNote = '', mediums = [], moodTags = [], styleReferences = [], user, model = 'auto', usageContext, followBrand = true, improve = null }) {
  const effectiveModel = await resolveEffectiveModel(model);
  const basePrompt = buildPrompt({ purpose, briefNote, mediums, moodTags, styleReferences, user, followBrand, improve });
  const original = improve && IMPROVE_LABELS[improve.field] && typeof improve.text === 'string' ? improve.text.trim() : '';

  let parsed = null;
  let modelUsed = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    // Second try only when the first answer came back (nearly) identical to what the marketer typed.
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\nYour previous answer was identical or almost identical to the original. Write a clearly different rewrite of the ${IMPROVE_LABELS[improve.field]}: change the wording and the structure (never the facts) so it reads as a visible improvement.`;
    const { text, modelUsed: used, note } = await router.generateText({
      model: effectiveModel,
      system: 'You respond with strict, valid JSON only - no markdown fences, no commentary.',
      prompt,
      maxTokens: 700
    });
    modelUsed = used;

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
    parsed = JSON.parse(jsonStr);
    if (!original || !nearlySame(parsed[improve.field], original)) break;
  }

  return {
    primaryMessage: sanitizeText(parsed.primaryMessage, 200),
    contextBrief: sanitizeText(parsed.contextBrief, 600),
    visualDescription: sanitizeText(parsed.visualDescription, 400),
    // Must include / Must avoid are typed by the marketer only; the AI no longer fills them.
    mustInclude: '',
    mustAvoid: '',
    rationale: sanitizeText(parsed.rationale, 300),
    modelUsed
  };
}
