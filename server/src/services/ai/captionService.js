import * as router from './router.js';
import { getSettings } from '../appSettingsService.js';
import { FORMAT_COPY_NOTES, getFormat } from '../../constants/postFormats.js';
import { estimateTextCostUsdByProvider } from '../costEstimateService.js';
import { logUsageSafely } from '../aiUsageLogService.js';
import { languageRule } from '../../utils/language.js';
import { brandGuideLines } from '../../utils/brandGuide.js';

/** Rough token count from character length (~4 chars/token in English) - good enough for a ballpark cost log. */
function tokenEstimate(str) {
  return Math.ceil((str || '').length / 4);
}

/**
 * Resolves "auto" (or no model specified) to the workspace's admin-configured
 * default copy model, so that setting actually means something rather than
 * being purely informational. Regular users no longer see a per-post model
 * picker at all (see GenerateMedia.jsx) - this is the one place it applies.
 * An explicit non-auto model (rare, e.g. from an internal/admin call) is
 * always respected as-is.
 */
async function resolveEffectiveModel(requestedModel) {
  if (requestedModel && requestedModel !== 'auto') return requestedModel;
  try {
    const settings = await getSettings();
    return settings.copyModel || 'auto';
  } catch {
    return 'auto';
  }
}

export function brandSystemPrompt({ user, industry, followBrand = true, withLanguage = true }) {
  // followBrand=false: no brand name, voice or mood may reach the prompt (clean slate).
  const dl = followBrand === false ? null : user?.brandKit?.designLanguage;
  return [
    followBrand === false ? 'You are AUTOMATr, an in-house social media copywriter.' : 'You are AUTOMATr, an in-house social media copywriter for a specific brand.',
    followBrand === false ? '' : `Brand: ${user?.company?.name || 'the brand'} (${industry || 'general'} industry).`,
    dl?.voiceTone ? `This brand's established voice/tone (derived from an analyzed brand asset): ${dl.voiceTone}` : '',
    dl?.moodTags?.length ? `Brand mood: ${dl.moodTags.join(', ')}.` : '',
    // The agency's brand guide for this customer (instructions, do/don't, words, taglines...). Brand off = none of it.
    ...(followBrand === false ? [] : brandGuideLines(user?.brandKit, 'copy')),
    'Write copy that a real marketing team could post as-is: concrete, concise, no generic filler like "Discover the difference" or "Elevate your lifestyle".',
    'Never use hashtags unless the platform notes ask for them. Do not wrap the caption in quotation marks.',
    withLanguage ? languageRule() : ''
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * @param {{purpose:string, mediums:string[], briefNote:string, user:object, model?:string, creativeBrief?:object}} args
 */
export async function generateCaption({ purpose, mediums, briefNote, user, model = 'auto', creativeBrief = {}, usageContext, followBrand = true }) {
  const format = getFormat(mediums?.[0]);
  const industry = user?.company?.industry;
  const { primaryMessage = '', mustInclude = '', mustAvoid = '', moodTags = [] } = creativeBrief;

  const prompt = [
    `Purpose: ${purpose}.`,
    `Platform/placement: ${format.label} (${format.platform}). Style notes: ${FORMAT_COPY_NOTES[format.id] || ''}`,
    briefNote ? `Extra context from the marketer: ${briefNote}` : '',
    moodTags.length ? `Mood/tone to write in: ${moodTags.join(', ')}.` : '',
    // primaryMessage is the core point this post should make - a genuine
    // requirement for the caption itself, since it's about meaning, not
    // visuals.
    primaryMessage ? `STRICT REQUIREMENT: the caption MUST communicate this core message: ${primaryMessage}` : '',
    // mustInclude/mustAvoid, by contrast, describe concrete visual elements
    // the IMAGE must show or avoid (see messageSuggestionService.js) - they
    // are background context for the caption writer, not literal text the
    // caption itself must contain. Without this framing, a model can end up
    // writing a caption that describes the image's composition ("Featured:
    // the logo, a bold tagline...") instead of normal marketing copy -
    // technically "correct" but reads like an image brief, not something a
    // person would post.
    mustInclude || mustAvoid
      ? [
          'Context on what the accompanying image will show (do NOT describe or list these visual elements in the caption itself - write natural caption copy that complements the image, the way a real social post caption reads):',
          mustInclude ? `- The image includes/depicts: ${mustInclude}` : '',
          mustAvoid ? `- The image avoids: ${mustAvoid}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    'Write exactly one caption. No preamble, no explanation, just the caption text.'
  ]
    .filter(Boolean)
    .join('\n');

  const { text, modelUsed, note } = await router.generateText({
    purpose: 'writing the caption',
    model: await resolveEffectiveModel(model),
    system: brandSystemPrompt({ user, industry, followBrand }),
    prompt,
    maxTokens: 200
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  return { caption: text, modelUsed, note };
}

/**
 * "Sharpen": rewrite the same caption tighter/punchier without changing its
 * core message. Distinct from a free-form prompt-driven rewrite.
 */
export async function sharpenCaption({ caption, user, model = 'auto', usageContext }) {
  const prompt = [
    'Rewrite the following caption to be punchier and tighter, keeping the same core message and length in the same ballpark:',
    `"${caption}"`,
    'Return only the rewritten caption.'
  ].join('\n');

  const { text, modelUsed, note } = await router.generateText({
    purpose: 'sharpening the caption',
    model: await resolveEffectiveModel(model),
    system: brandSystemPrompt({ user, industry: user?.company?.industry }),
    prompt,
    maxTokens: 150
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  return { caption: text, modelUsed, note };
}

/**
 * Distills an already-written caption into a short, punchy headline/CTA
 * suitable for rendering directly onto a creative (not the caption itself -
 * a caption is 1-3 sentences, this is 2-6 words). Used in Step 02 once real
 * copy exists, so the suggested headline is actually grounded in it rather
 * than guessed upfront before any copy was written.
 */
export async function generateHeadline({ caption, user, model = 'auto', withSubheadline = false, usageContext }) {
  const prompt = [
    `Here is a social media caption already written for this post: "${caption}"`,
    'Distill it into a short, punchy headline or CTA (2-6 words) suitable for rendering directly onto the creative image itself - think sale-banner or ad-headline energy, not a shortened version of the caption sentence.',
    ...(withSubheadline
      ? [
          'Also write a sub-headline: one short supporting line (4-9 words) that adds a benefit, detail or reason to act, and does not repeat the headline.',
          'No quotation marks, no hashtags, no trailing punctuation on the headline. Return exactly two lines and nothing else:',
          'HEADLINE: <the headline>',
          'SUBHEADLINE: <the sub-headline>'
        ]
      : ['No quotation marks, no trailing punctuation, no hashtags. Return only the headline text, nothing else.'])
  ].join('\n');

  const { text, modelUsed, note } = await router.generateText({
    purpose: 'writing a headline',
    model: await resolveEffectiveModel(model),
    system: brandSystemPrompt({ user, industry: user?.company?.industry }),
    prompt,
    maxTokens: withSubheadline ? 100 : 40
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').replace(/[.]+$/, '').trim();
  if (withSubheadline) {
    const h = /HEADLINE:\s*(.+)/i.exec(text.replace(/SUBHEADLINE:/gi, '\nSUBHEADLINE:'));
    const sub = /SUBHEADLINE:\s*(.+)/i.exec(text);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return { headline: clean(h ? h[1] : lines[0]), subheadline: clean(sub ? sub[1] : lines[1]), modelUsed, note };
  }
  const headline = text.trim().replace(/^["']|["']$/g, '');
  return { headline, modelUsed, note };
}


// Improve must never hand the marketer's own text back: compares by words so a re-punctuated / re-capitalised copy still counts as unchanged.
const improveWords = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
export function nearlySameText(a, b) {
  const x = improveWords(a), y = improveWords(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const sx = new Set(x), sy = new Set(y);
  let inter = 0;
  for (const w of sx) if (sy.has(w)) inter += 1;
  return inter / (sx.size + sy.size - inter) >= 0.85;
}

/**
 * Improve for the post copy box: three rewrites of the copy the marketer typed (never the same text back).
 */
export async function improveCaptionOptions({ caption, purpose, formatLabel, user, model = 'auto', usageContext, count = 3 }) {
  const original = String(caption || '').trim();
  const ask = (extra = '') => [
    `Post copy written by the marketer: "${original}"`,
    purpose ? `Post purpose: ${purpose}.` : '',
    formatLabel ? `Placement: ${formatLabel}.` : '',
    `Write ${count} IMPROVED versions of this post copy. Keep its meaning, tone and every fact, and invent no new claims, offers, prices or dates. Make each one clearly better: a stronger hook, sharper wording and tighter rhythm. Keep roughly the same length and format (line breaks, emojis and hashtags used in the same spirit). Each version must differ visibly from the original and from the other versions: change the opening and the wording, not just a word or two.`,
    extra,
    languageRule(),
    'Respond with ONLY a JSON array of strings, one per version, nothing else - no markdown fences, no numbering, no commentary.'
  ].filter(Boolean).join('\n');

  const run = async (prompt) => {
    const { text, modelUsed, note } = await router.generateText({
      purpose: 'improving the post copy',
      model: await resolveEffectiveModel(model),
      system: brandSystemPrompt({ user, industry: user?.company?.industry }),
      prompt,
      maxTokens: 1400
    });
    logUsageSafely(usageContext, {
      type: 'text',
      provider: modelUsed,
      estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
    });
    let list = [];
    try {
      const cleaned = text.replace(/^```json|```$/gim, '').trim();
      const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
      list = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];
    } catch { /* fall through with an empty list */ }
    return { list, modelUsed, note };
  };

  const keep = (list) => list.filter((v, i) => !nearlySameText(v, original) && list.findIndex((w) => nearlySameText(w, v)) === i).slice(0, count);
  let { list, modelUsed, note } = await run(ask());
  let options = keep(list);
  if (!options.length && modelUsed !== 'placeholder') {
    ({ list, modelUsed, note } = await run(ask('Your previous answer repeated the original. Every version MUST be a visibly different rewrite.')));
    options = keep(list);
  }
  return { options, modelUsed, note };
}

/**
 * Generic Improve for short instruction / description boxes (hero, creative edit, extra requirements, motion note):
 * `count` rewrites of what the marketer typed, never the same text back.
 */
export async function improveTextOptions({ text, kind = 'instruction', context = '', user, model = 'auto', usageContext, count = 3 }) {
  const original = String(text || '').trim();
  const ask = (extra = '') => [
    `The marketer wrote this ${kind}: "${original}"`,
    context ? `Context: ${context}` : '',
    `Write ${count} IMPROVED versions of it. Keep the same intent and every fact; invent no new products, claims, offers, prices or dates. Make each one clearer, more specific and more vivid, in the same language and roughly the same length. Each version must differ visibly from the original and from the others: change the wording and structure, not just a word or two.`,
    extra,
    languageRule(),
    'Respond with ONLY a JSON array of strings, one per version, nothing else - no markdown fences, no numbering, no commentary.'
  ].filter(Boolean).join('\n');

  const run = async (prompt) => {
    const { text: out, modelUsed, note } = await router.generateText({
      purpose: `improving the ${kind}`,
      model: await resolveEffectiveModel(model),
      system: brandSystemPrompt({ user, industry: user?.company?.industry }),
      prompt,
      maxTokens: 1000
    });
    logUsageSafely(usageContext, {
      type: 'text',
      provider: modelUsed,
      estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(out) })
    });
    let list = [];
    try {
      const cleaned = out.replace(/^```json|```$/gim, '').trim();
      const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
      list = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];
    } catch { /* empty list */ }
    return { list, modelUsed, note };
  };
  const keep = (list) => list.filter((v, i) => !nearlySameText(v, original) && list.findIndex((w) => nearlySameText(w, v)) === i).slice(0, count);
  let { list, modelUsed, note } = await run(ask());
  let options = keep(list);
  if (!options.length && modelUsed !== 'placeholder') {
    ({ list, modelUsed, note } = await run(ask('Your previous answer repeated the original. Every version MUST be a visibly different rewrite.')));
    options = keep(list);
  }
  return { options, modelUsed, note };
}

/**
 * Step 02 headline picker: a spread of short headline options written for the
 * creative that is actually selected - its caption, its image brief, the post's
 * purpose and platform, and (when available) the rendered image itself - so each
 * option fits what the picture shows. `exclude` lists options already shown, so
 * "More options" never repeats them.
 */
export async function generateHeadlineOptions({ caption, imagePrompt, purpose, briefNote, formatLabel, currentHeadline, exclude = [], image, user, model = 'auto', count = 8, usageContext, kind = 'headline', headline = '', improve = false }) {
  const isSub = kind === 'sub';
  // IMPROVE: the marketer typed their own line, so write 3 better versions of THAT line (not unrelated new ideas).
  const improving = Boolean(improve && currentHeadline && String(currentHeadline).trim());
  if (improving) count = 3;
  const prompt = [
    isSub
      ? (image ? 'Look at this advertising creative. A sub-headline will be rendered under its headline.' : 'A sub-headline will be rendered under the headline of an advertising creative.')
      : image ? 'Look at this advertising creative. A headline will be rendered directly onto it.' : 'A headline will be rendered directly onto an advertising creative.',
    isSub && headline ? `The headline it supports: "${headline}" - the sub-headline must not repeat or reword it.` : '',
    purpose ? `Post purpose: ${purpose}.` : '',
    formatLabel ? `Placement: ${formatLabel}.` : '',
    caption ? `Caption written for it: "${caption}"` : '',
    imagePrompt ? `Image brief: ${imagePrompt}` : '',
    briefNote ? `Extra context from the marketer: ${briefNote}` : '',
    currentHeadline
      ? (improving
        ? `The marketer typed this ${isSub ? 'sub-headline' : 'headline'}: "${currentHeadline}".`
        : `Current ${isSub ? 'sub-headline' : 'headline'}: "${currentHeadline}" - offer different ones, not rewordings of it.`)
      : '',
    exclude.length ? `Already suggested, do NOT repeat or closely echo any of these:\n${exclude.map((e) => `- ${e}`).join('\n')}` : '',
    improving
      ? `Write ${count} IMPROVED versions of the ${isSub ? 'sub-headline' : 'headline'} the marketer typed. Keep its meaning and every fact and invent no new claims, but make each one clearly better: sharper, more vivid, more specific, better rhythm. Each must differ visibly from the typed text and from each other (never just a punctuation or one-word change), and stay about as short as the original (${isSub ? '4-9 words' : '2-6 words'}). No quotation marks, no hashtags, no trailing punctuation. Do not write unrelated new ideas.`
      : isSub
      ? `Write ${count} sub-headline options: each one short supporting line (4-9 words) that adds a concrete benefit, detail, proof point or reason to act, and fits what this creative shows. Spread them across different angles (benefit, feature, reassurance, urgency, curiosity, a light call to action). No quotation marks, no hashtags, no trailing punctuation, and none may repeat the headline.`
      : `Write ${count} headline options that fit what this creative shows and says (the subject, mood, colours and setting), spread across clearly different styles: punchy benefit, playful, emotional, offer or call to action, a short question, and minimal two-word. Each is 2-6 words, sale-banner or ad-headline energy, no quotation marks, no trailing punctuation, no hashtags, and none may be a shortened caption sentence.`,
    languageRule(),
    'Respond with ONLY a JSON array of strings, nothing else - no markdown fences, no numbering, no commentary.'
  ]
    .filter(Boolean)
    .join('\n');

  let text = '';
  let modelUsed = 'placeholder';
  let note;
  if (image) {
    try {
      ({ text, modelUsed, note } = await router.analyzeImage({ purpose: isSub ? 'suggesting sub-headline options' : 'suggesting headline options', model: 'auto', detail: 'low', base64: image.base64, mimeType: image.mimeType, instruction: prompt, maxTokens: 500 }));
    } catch (err) {
      console.warn('[headline-options] image-based options failed, falling back to text:', err.message);
    }
  }
  if (!text) {
    ({ text, modelUsed, note } = await router.generateText({
      purpose: isSub ? 'suggesting sub-headline options' : 'suggesting headline options',
      model: await resolveEffectiveModel(model),
      system: brandSystemPrompt({ user, industry: user?.company?.industry }),
      prompt,
      maxTokens: 500
    }));
  }

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  let options = [];
  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
    options = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    options = String(text || '').split('\n').map((l) => l.replace(/^[-*\d.)\s"']+/, '').replace(/["']$/, '').trim()).filter(Boolean);
  }
  const norm = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seen = new Set([...exclude, currentHeadline || ''].map(norm));
  options = options
    .map((v) => v.replace(/^["']|["']$/g, '').replace(/[.!]+$/, '').replace(/\s+/g, ' ').trim().slice(0, isSub ? 100 : 60))
    .filter((v) => v && !seen.has(norm(v)) && !(improving && nearlySameText(v, currentHeadline)))
    .slice(0, count);
  return { options, modelUsed, note };
}

/**
 * Creative Adaptation only: takes the literal headline text detected in an
 * uploaded template (see templateAnalysisService.js's primaryHeadlineText)
 * and writes several alternative headlines that keep a similar length/tone/
 * energy but reflect the new brief - so the person picks from real options
 * grounded in the original's actual style, rather than the AI silently
 * inventing one headline per copy direction with no visibility into the
 * choice. Falls back to splitting on newlines if the model doesn't return
 * clean JSON (models occasionally add numbering/bullets despite instructions).
 */
export async function generateHeadlineVariations({ originalHeadline, purpose, briefNote, user, model = 'auto', count = 5, usageContext }) {
  const prompt = [
    `This creative's existing headline is: "${originalHeadline}"`,
    `New brief - purpose: ${purpose}.`,
    briefNote ? `Extra context from the marketer: ${briefNote}` : '',
    `Write ${count} alternative headlines that keep a similar length, tone, and energy to the original, but update the wording to fit the new brief above - think of these as the same headline reimagined for a new message, not unrelated new copy.`,
    'Respond with ONLY a JSON array of strings, nothing else - no markdown fences, no numbering, no commentary. Example shape: ["Headline one", "Headline two"]'
  ]
    .filter(Boolean)
    .join('\n');

  const { text, modelUsed, note } = await router.generateText({
    purpose: 'writing headline variations',
    model: await resolveEffectiveModel(model),
    system: brandSystemPrompt({ user, industry: user?.company?.industry }),
    prompt,
    maxTokens: 350
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  let variations = [];
  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    variations = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  } catch {
    // Fallback: treat each non-empty line as one variation, stripping any
    // numbering/bullet/quote characters the model added anyway.
    variations = text
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s"']+/, '').replace(/["']$/, '').trim())
      .filter(Boolean)
      .slice(0, count);
  }

  return { variations, modelUsed, note };
}

/**
 * Prompt-driven rewrite: apply a specific instruction to the existing caption.
 */
export async function refineCaption({ caption, instruction, user, model = 'auto', usageContext }) {
  const prompt = [
    `Current caption: "${caption}"`,
    `Change requested by the marketer: ${instruction}`,
    'Apply the change and return only the revised caption.'
  ].join('\n');

  const { text, modelUsed, note } = await router.generateText({
    purpose: 'refining the caption',
    model: await resolveEffectiveModel(model),
    system: brandSystemPrompt({ user, industry: user?.company?.industry }),
    prompt,
    maxTokens: 200
  });

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(prompt), outputTokens: tokenEstimate(text) })
  });

  return { caption: text, modelUsed, note };
}
