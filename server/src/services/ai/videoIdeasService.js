import fs from 'node:fs';
import path from 'node:path';
import * as router from './router.js';
import { getFormat } from '../../constants/postFormats.js';
import { estimateTextCostUsdByProvider } from '../costEstimateService.js';
import { logUsageSafely } from '../aiUsageLogService.js';
import { aiLog } from '../../utils/aiLog.js';
import { MONOCHROME_REQUEST_RE } from '../../constants/colourIntegrity.js';
import { ruleText } from '../blanketRulesService.js';

// Before a video is generated, this looks at the finished creative image
// (plus the copy direction it was built from) and lists everything that
// could sensibly be animated - camera moves, subject motion, atmosphere,
// light, depth and so on. The person ticks the ones they want and each
// tick's `videoPrompt` is what ends up in the prompt sent to the video
// model (see buildVideoPrompt in designService.js). Nothing here generates
// video itself.

// Image-to-video models cannot reliably animate text: word-by-word reveals and
// text motion come out as garbled letters ("Ne tien eelien"). So on-screen text
// can come out garbled, so the person is warned to check the result. Headline / text
// animation ideas are offered (Basic tab) and, when ticked, the text-lock step is skipped
// so the motion is not painted over. Set to false to keep all on-screen text still.
export const ALLOW_TEXT_ANIMATION = false; // off by default: on-screen text stays still unless the person explicitly asks for it (see designService / posts.controller)

const ALL_IDEA_CATEGORIES = [
  { key: 'camera', label: 'Camera moves', single: true },
  { key: 'subject', label: 'Subject motion' },
  { key: 'text', label: 'Text & supers', text: true },
  { key: 'environment', label: 'Environment & atmosphere' },
  { key: 'light', label: 'Light & colour' },
  { key: 'depth', label: 'Depth & parallax' },
  { key: 'focus', label: 'Focus & lens' },
  { key: 'reveal', label: 'Reveals & transitions' },
  { key: 'finish', label: 'Loops & finishing' }
];
export const IDEA_CATEGORIES = ALLOW_TEXT_ANIMATION ? ALL_IDEA_CATEGORIES : ALL_IDEA_CATEGORIES.filter((c) => c.key !== 'text');
const CATEGORY_KEYS = IDEA_CATEGORIES.map((c) => c.key);
const INTENSITIES = ['subtle', 'moderate', 'bold'];

// Fewer ideas = a much shorter reply = a much faster call (output length is what dominates the wait).
const IDEAS_TARGET = process.env.VIDEO_IDEAS_TARGET || '18 to 24';

function tokenEstimate(str) {
  return Math.ceil((str || '').length / 4);
}

function buildInstruction({ caption, imagePrompt, briefNote, purpose, format, hasImage }) {
  const shape = {
    ideas: [
      {
        category: `one of: ${CATEGORY_KEYS.join(' | ')}`,
        title: 'max 6 words, e.g. "Slow push-in on the car"',
        description: 'ONE short plain-English sentence (max 14 words) on what the viewer will SEE happen',
        videoPrompt:
          'ONE imperative sentence (max 25 words) written for a video model describing ONLY the motion (what moves, how, how fast), and what must stay still',
        intensity: 'subtle | moderate | bold'
      }
    ],
    bestCombination: {
      ideaTitles: ['the exact "title" strings of the 4-6 ideas above that work best together'],
      rationale: 'two sentences on why this mix is the strongest for this creative and copy direction'
    }
  };

  return [
    'You are a senior motion director planning how to animate a finished advertising creative into a short video (roughly 5-10 seconds, image-to-video).',
    hasImage
      ? 'The attached image is the final, approved creative. Base every idea on what is ACTUALLY visible in it.'
      : 'No image is attached, so base every idea on the copy direction below.',
    `Placement: ${format.platform} ${format.label} (${format.videoAspectRatio || format.ratio}).`,
    purpose ? `Campaign purpose: ${purpose}` : '',
    briefNote ? `Brief: ${briefNote}` : '',
    caption ? `Copy direction / caption: ${caption}` : '',
    imagePrompt ? `Creative direction used for the image: ${imagePrompt.slice(0, 600)}` : '',
    '',
    'List an EXHAUSTIVE set of distinct, feasible animation possibilities - aim for ${IDEAS_TARGET} ideas - spread across ALL of these categories:',
    IDEA_CATEGORIES.map((c) => `- ${c.key}: ${c.label}`).join('\n'),
    'Mix subtle, moderate and bold options. Every idea must be different from the others, specific to THIS image (name the actual subject, objects and setting you can see), and achievable by an image-to-video model.',
    'Camera ideas are alternatives to each other (only one camera move is used per video); every other category can be combined freely.',
    ALLOW_TEXT_ANIMATION
      ?     'TEXT & SUPERS category: if the image shows a headline, supers, taglines, call-to-action bars or other marketing text, give at least 6 ideas for animating them, each naming the actual wording in quotes (e.g. the headline "..." fades up word by word; the CTA "..." slides in from the bottom with a soft glow; a subtle highlight sweeps across the tagline; the supers cross-fade in sequence; the headline holds then softly scales; text eases out at the end). Cover entrance, emphasis and exit. The wording must keep its exact spelling and stay sharp and legible at every moment. If the image has no marketing text, give no ideas in this category. Do NOT put text ideas in any other category, and keep the reveals category for non-text reveals.'
      : 'TEXT RULE: video models garble animated text. Do NOT propose any idea that animates, reveals, fades in word-by-word, slides, scales, highlights, morphs or otherwise moves any headline, super, tagline, call-to-action or other on-screen text - all text must stay exactly as it is in the image. Motion ideas should act on the subject, product, environment, light and camera only.',
    'HARD RULES: every logo, brand mark, QR code, registration/licence number, price and legal/compliance or disclaimer text must stay perfectly sharp and completely static - never propose animating, moving, revealing or morphing any of these. Never change the identity, design, colour or proportions of the main subject. Do not invent new objects that are not in the scene, except natural ambient elements that clearly belong (e.g. drifting clouds, light rays, dust).',
    ruleText('plannerColour') || null,
    '',
    'BEST COMBINATION: after listing the ideas, choose the single best set of 4 to 6 of them to use TOGETHER in one video. It must contain exactly one camera move, must be physically compatible (nothing that contradicts or fights another idea), should balance subtle and bolder motion, should suit the copy direction and placement, and should include a text/supers idea only if it genuinely strengthens the message. Copy each chosen idea title EXACTLY as written in your ideas list.',
    'Respond with ONLY a JSON object (no markdown fences, no commentary) shaped exactly like this, with the ideas array containing all of your ideas:',
    JSON.stringify(shape, null, 2)
  ]
    .filter((l) => l !== null && l !== undefined)
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

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function sanitizeBest(parsed, ideas) {
  const titles = Array.isArray(parsed?.bestCombination?.ideaTitles) ? parsed.bestCombination.ideaTitles : [];
  const byTitle = new Map(ideas.map((i) => [i.title.toLowerCase(), i]));
  const ids = [];
  let cameraTaken = false;
  for (const t of titles) {
    const idea = typeof t === 'string' ? byTitle.get(t.trim().toLowerCase()) : null;
    if (!idea || ids.includes(idea.id)) continue;
    if (idea.category === 'camera') {
      if (cameraTaken) continue;
      cameraTaken = true;
    }
    ids.push(idea.id);
    if (ids.length >= 6) break;
  }
  return { ids, rationale: clip(parsed?.bestCombination?.rationale, 400) };
}

function sanitize(parsed) {
  const raw = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
  const seen = new Set();
  const ideas = [];
  for (const r of raw) {
    const title = clip(r?.title, 80);
    const videoPrompt = clip(r?.videoPrompt, 500);
    if (!title || !videoPrompt) continue;
    if (!ALLOW_TEXT_ANIMATION && r?.category === 'text') continue;
    // Never offer a black-and-white / desaturated / colour-drain idea, whatever the model suggested.
    if (MONOCHROME_REQUEST_RE.test(`${title} ${r?.description || ''} ${videoPrompt}`)) continue;
    const dedupeKey = title.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const category = CATEGORY_KEYS.includes(r?.category) ? r.category : 'subject';
    ideas.push({
      id: `${category}-${ideas.length + 1}`,
      category,
      title,
      description: clip(r?.description, 240),
      videoPrompt,
      intensity: INTENSITIES.includes(r?.intensity) ? r.intensity : 'moderate',
      touchesText: category === 'text'
    });
    if (ideas.length >= 50) break;
  }
  return ideas;
}

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * @param {object} args
 * @param {string} [args.imagePath] - local path of the variant's final image, when it has one.
 * @returns {{ skipped?: boolean, reason?: string, ideas?: Array, categories?: Array, modelUsed?: string }}
 */
export async function suggestVideoIdeas({ imagePath, caption = '', imagePrompt = '', briefNote = '', purpose = '', formatId, usageContext }) {
  const format = getFormat(formatId);
  let mimeType = imagePath ? MIME_BY_EXT[path.extname(imagePath).toLowerCase()] : undefined;
  const hasImage = Boolean(imagePath && mimeType && fs.existsSync(imagePath));
  const instruction = buildInstruction({ caption, imagePrompt, briefNote, purpose, format, hasImage });

  let text;
  let modelUsed;
  let note;

  if (hasImage) {
    // Full-resolution creatives are several MB; the model only needs to see the composition, so
    // send a ~1024px JPEG - far less to upload and process, same quality of ideas.
    let base64;
    try {
      const { default: sharp } = await import('sharp');
      const buf = await sharp(imagePath).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      base64 = buf.toString('base64');
      mimeType = 'image/jpeg';
    } catch {
      base64 = fs.readFileSync(imagePath).toString('base64');
    }
    ({ text, modelUsed, note } = await router.analyzeImage({ purpose: 'suggesting animation ideas', base64, mimeType, instruction, maxTokens: 5000 }));
  } else {
    ({ text, modelUsed, note } = await router.generateText({
      purpose: 'suggesting animation ideas',
      system: 'You respond with strict, valid JSON only - no markdown fences, no commentary.',
      prompt: instruction,
      maxTokens: 5000
    }));
    if (modelUsed === 'placeholder') text = null;
  }

  if (!text) {
    return { skipped: true, reason: note || 'No AI provider is configured to suggest animation ideas.' };
  }

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(instruction) + (hasImage ? 1500 : 0), outputTokens: tokenEstimate(text) })
  });

  try {
    const cleaned = text.replace(/^```json|```$/gim, '').trim();
    const parsed = JSON.parse(extractJsonObject(cleaned));
    const ideas = sanitize(parsed);
    if (ideas.length === 0) return { skipped: true, reason: 'The AI did not return any usable ideas. Try again.' };
    return { skipped: false, ideas, bestCombination: sanitizeBest(parsed, ideas), categories: IDEA_CATEGORIES, modelUsed };
  } catch (err) {
    console.warn('[video-ideas] failed to parse response:', err.message);
    return { skipped: true, reason: `AI response could not be parsed: ${err.message}` };
  }
}


/**
 * "Describe the motion" box: writes one short motion direction for this creative (Suggest), or rewrites what the person
 * typed so it is clearer and more filmable (Improve). The text goes to the prompt director as the art director's own
 * direction, so it stays short and plain. On-screen text and product labelling are never asked to move.
 * @returns {{ skipped?: boolean, reason?: string, text?: string, modelUsed?: string }}
 */
export async function suggestMotionPrompt({ imagePath, current = '', pickedTitles = [], caption = '', imagePrompt = '', briefNote = '', purpose = '', formatId, usageContext }) {
  const format = getFormat(formatId);
  let mimeType = imagePath ? MIME_BY_EXT[path.extname(imagePath).toLowerCase()] : undefined;
  const hasImage = Boolean(imagePath && mimeType && fs.existsSync(imagePath));
  const typed = String(current || '').trim().slice(0, 400);
  const instruction = [
    hasImage ? 'Look at this advertising creative. It will be turned into a short video of about 5-10 seconds.' : 'An advertising creative will be turned into a short video of about 5-10 seconds.',
    purpose ? `Purpose: ${purpose}.` : '',
    `Placement: ${format.platform} ${format.label}.`,
    caption ? `Copy direction (context only): ${String(caption).slice(0, 300)}` : '',
    imagePrompt ? `Creative direction: ${String(imagePrompt).slice(0, 300)}` : '',
    briefNote ? `Brief: ${String(briefNote).slice(0, 300)}` : '',
    pickedTitles.length ? `Motion ideas already ticked (keep it consistent with them): ${pickedTitles.join(', ')}.` : '',
    typed
      ? `The art director wrote this motion direction: "${typed}"\nImprove it: keep their intent, make it specific and filmable (what moves, how fast, what the camera does) and fix anything vague. Do not add ideas that change what they asked for.`
      : 'Write one tasteful, specific motion direction for this creative: what moves, how fast, and what the camera does.',
    'Rules: one or two plain sentences, at most 260 characters, written as a direction (for example "Slow push-in on the product while soft light sweeps across the surface and the background drifts gently"). Describe only motion of what is actually in the image. Never ask for on-screen text, logos, labels or packaging to move, change or appear, never mention audio, and do not mention any AI model. Respond with ONLY the direction text, no quotes.'
  ].filter(Boolean).join('\n');

  let text;
  let modelUsed;
  let note;
  if (hasImage) {
    let base64;
    try {
      const { default: sharp } = await import('sharp');
      const buf = await sharp(imagePath).resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      base64 = buf.toString('base64');
      mimeType = 'image/jpeg';
    } catch {
      base64 = fs.readFileSync(imagePath).toString('base64');
    }
    ({ text, modelUsed, note } = await router.analyzeImage({ purpose: 'suggesting a motion direction', base64, mimeType, instruction, maxTokens: 200, detail: 'low' }));
  } else {
    ({ text, modelUsed, note } = await router.generateText({ purpose: 'suggesting a motion direction', prompt: instruction, maxTokens: 200 }));
    if (modelUsed === 'placeholder') text = null;
  }
  if (!text) return { skipped: true, reason: note || 'No AI provider is configured to suggest a motion direction.' };

  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(instruction) + (hasImage ? 800 : 0), outputTokens: tokenEstimate(text) })
  });
  const clean = String(text).replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 280);
  if (!clean) return { skipped: true, reason: 'The AI did not return a usable direction. Try again.' };
  return { skipped: false, text: clean, modelUsed };
}

// ---------------------------------------------------------------------------
// Prompt director - turns the ticked ideas + notes + feedback into ONE detailed,
// shot-by-shot prompt for the video model. Runs on every generate/regenerate;
// if it fails the caller falls back to the plain concatenated prompt.
// ---------------------------------------------------------------------------

const MAX_COMPOSED_CHARS = 3200; // keeps well inside the smallest video model's ~1,000-token prompt limit

function buildComposeInstruction({ mode, format, durationSeconds, ideas, customDirection, feedback, earlierFeedback, caption, imagePrompt, hasImage }) {
  const seconds = durationSeconds || format.recommendedDurationSeconds || 6;
  const ideaLines = (ideas || []).map((i, n) => `${n + 1}. [${i.category}] ${i.title}: ${i.videoPrompt}`).join('\n');
  return [
    'You are a senior commercial video director and an expert prompt writer for image-to-video and text-to-video AI models (Google Veo class). Write the single best prompt that makes the model produce a polished, broadcast-quality ad clip that follows the brief exactly.',
    hasImage && mode === 'animate_kv'
      ? 'The attached image is the FINAL, APPROVED advertising creative. The video must be that exact image coming to life - same composition, subject, product, colours, framing and on-screen text. Describe what you actually SEE in it (name the real subject, product, objects, setting, light) so the model locks onto it.'
      : 'There is no approved image: describe a complete, specific scene from the creative direction below.',
    `Placement: ${format.platform} ${format.label}, aspect ratio ${format.videoAspectRatio || format.ratio}, about ${seconds} seconds, one continuous shot with no cuts.`,
    caption ? `Copy direction (context only - never render this as text): ${caption}` : '',
    imagePrompt ? `Creative direction: ${String(imagePrompt).slice(0, 600)}` : '',
    ideaLines ? `Motion the art director chose - use ALL of it, and nothing that contradicts it:\n${ideaLines}` : 'No specific motion was chosen: pick one tasteful, subtle motion plan that suits the creative (gentle camera move plus natural ambient motion).',
    customDirection ? `Extra direction from the art director (must be followed): ${customDirection}` : '',
    earlierFeedback?.length ? `Earlier feedback that still applies: ${earlierFeedback.join(' | ')}` : '',
    feedback ? `LATEST FEEDBACK on the previous video (highest priority - change the plan to satisfy it): ${feedback}` : '',
    '',
    'Write the prompt as flowing, concrete prose in this order, with no headings, bullets or markdown:',
    '1. One opening sentence: what the clip is (e.g. "Animate the attached approved ad image as a single continuous shot...") and its overall feel.',
    '2. Subject and scene: what is visible and where, in specific terms.',
    '3. Camera: exactly one move (or locked-off), its direction, speed, easing and start/end framing.',
    `4. Motion timeline in time-coded beats across the ${seconds} seconds (e.g. "0-2s: ...; 2-5s: ..."), covering every chosen motion, each saying what moves, how fast and how far.`,
    '5. Light and atmosphere: how light, colour, particles, reflections or weather change, kept natural.',
    (ideas || []).some((i) => i.category === 'text')
      ? '6. Locked elements: every logo, brand mark, product label and packaging, QR code, price and legal/compliance copy stays pixel-identical, perfectly sharp, readable and completely still for the whole clip. The ONLY text allowed to move is the headline / super / tagline / call-to-action motion chosen above: keep its exact wording and spelling, perfectly sharp and legible whenever it is on screen, with no warping, morphing, garbled or extra letters. All other text stays still. The product keeps its exact shape and colours.'
      : '6. Locked elements: every logo, brand mark, product label and packaging, headline and all other text, QR code, price and legal/compliance copy stays pixel-identical, perfectly sharp, readable and completely still for the whole clip - no warping, re-drawing, morphing, new or changing letters. The product keeps its exact shape and colours.',
    '7. Finish: realistic physics and natural motion blur, smooth easing, steady exposure, no cuts, no flicker, no new objects or people appearing, no extra text or watermarks.',
    '8. Audio: subtle natural ambient sound that fits the scene; no speech, no lyrics, no music vocals.',
    '',
    `Rules: be specific and visual, avoid vague words ("nice", "dynamic"); do not add motion that was not chosen; resolve any conflicts in favour of the latest feedback, then the art director's choices; keep it between 170 and 330 words (under ${MAX_COMPOSED_CHARS} characters). Respond with ONLY the prompt text.`
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @returns {Promise<string|null>} the composed prompt, or null when no AI provider could write it.
 */
export async function composeVideoPrompt({ mode, imagePath, formatId, durationSeconds, ideas = [], customDirection = '', feedback = '', earlierFeedback = [], caption = '', imagePrompt = '', usageContext }) {
  try {
    const format = getFormat(formatId);
    const mimeType = imagePath ? MIME_BY_EXT[path.extname(imagePath).toLowerCase()] : undefined;
    const hasImage = Boolean(imagePath && mimeType && fs.existsSync(imagePath));
    const instruction = buildComposeInstruction({ mode, format, durationSeconds, ideas, customDirection, feedback, earlierFeedback, caption, imagePrompt, hasImage });
    const model = process.env.VIDEO_PROMPT_MODEL || 'auto'; // gpt | claude | gemini | auto

    let text;
    let modelUsed;
    if (hasImage && mode === 'animate_kv') {
      const base64 = fs.readFileSync(imagePath).toString('base64');
      ({ text, modelUsed } = await router.analyzeImage({ purpose: 'writing the detailed video prompt', model, base64, mimeType, instruction, maxTokens: 1400 }));
    } else {
      ({ text, modelUsed } = await router.generateText({ purpose: 'writing the detailed video prompt', model, system: 'You write production-ready video generation prompts. Respond with only the prompt text.', prompt: instruction, maxTokens: 1400 }));
      if (modelUsed === 'placeholder') text = null;
    }
    if (!text) return null;

    logUsageSafely(usageContext, {
      type: 'text',
      provider: modelUsed,
      estimatedCostUsd: estimateTextCostUsdByProvider(modelUsed, { inputTokens: tokenEstimate(instruction) + (hasImage ? 1500 : 0), outputTokens: tokenEstimate(text) })
    });

    aiLog('prompt', 'done', { msg: `video prompt written (${text.length} chars) - sent to the video model`, extra: ideas.length ? `${ideas.length} idea(s) combined${feedback ? ' + feedback' : ''}` : 'no ideas picked' });
    let out = text.replace(/^```[a-z]*\n?|```$/gim, '').replace(/^\s*(prompt|video prompt)\s*:\s*/i, '').trim();
    if (out.length < 120) return null;
    if (out.length > MAX_COMPOSED_CHARS) out = `${out.slice(0, MAX_COMPOSED_CHARS).replace(/\s+\S*$/, '')}.`;
    return out;
  } catch (err) {
    console.warn('[video-prompt] composer failed, using the standard prompt:', err.message);
    return null;
  }
}
