// Multi-scene Video ("showcase reel") - shared rules + the master storyboard prompt.
//
// What this mode makes: ONE short vertical reel built from several separately
// generated scenes (product hero beat -> N "look" scenes -> brand end card),
// like a "Mon-Fri looks" ad. Different tools do different jobs:
//
//   text model   -> writes the storyboard + every per-scene prompt (this file's prompt)
//   image model  -> one still per scene (the first frame of each clip)
//   video model  -> animates each still (Seedance, image-to-video, first-frame)
//   code (sharp + ffmpeg) -> ALL on-screen text, the exact product, logos, the
//                            end card and the final stitch. No generative model
//                            ever draws or animates text, packaging or logos.
//
// Seedance limits: every clip is one Seedance generation, and the FINISHED reel is
// capped at Seedance's own maximum clip length (see maxClipSeconds() in
// providers/seedance.js - 10s on the 1.0 models, 12s on 1.5 Pro). Each scene is
// requested at Seedance's shortest supported length and trimmed to its slot.

export const ASPECT = '9:16';
export const OUT_W = 720;
export const OUT_H = 1280;
export const FPS = 30;

export const MIN_LOOKS = 2;
export const MAX_LOOKS = 5;
export const END_CARD_SECONDS = 2.0;
export const HERO_SECONDS = 2.0;
export const MIN_LOOK_SECONDS = 0.8;

/**
 * Splits the Seedance cap between hero, looks and end card. Deterministic - the
 * text model suggests copy, never timing (it cannot be trusted to add up).
 * @returns {{ total: number, hero: number, looks: number[], endCard: number }}
 */
export function planDurations(lookCount, capSeconds) {
  const n = Math.min(MAX_LOOKS, Math.max(MIN_LOOKS, Number(lookCount) || 4));
  const cap = Math.max(8, Number(capSeconds) || 10);
  const per = Math.max(MIN_LOOK_SECONDS, Math.floor(((cap - HERO_SECONDS - END_CARD_SECONDS) / n) * 10) / 10);
  const looks = Array(n).fill(per);
  const total = Math.round((HERO_SECONDS + END_CARD_SECONDS + per * n) * 10) / 10;
  return { total, hero: HERO_SECONDS, looks, endCard: END_CARD_SECONDS };
}

// Appended to EVERY motion prompt sent to the video model.
export const MOTION_GUARD =
  'Subtle, natural motion only. No text, letters, numbers, captions, subtitles, logos, watermarks or signs anywhere in the frame. ' +
  'The subject keeps the exact same face, hair, makeup, outfit and styling as the first frame; nothing morphs or changes. Full natural colour throughout - never black-and-white, desaturated or colour-faded. No audio.';

// Appended to every image prompt for the scene stills.
export const STILL_GUARD =
  'Vertical 9:16, full-bleed, edge to edge. Absolutely no text, letters, numbers, captions, logos, watermarks or UI overlays in the image. ' +
  'Leave the lower third of the frame calm and uncluttered (a text overlay is added afterwards). Full natural colour - never black-and-white or desaturated.';

// Extra rule for the hero scene's motion (the exact product is composited into the still).
export const PRODUCT_LOCK =
  'The product in the frame is a fixed, rigid object: it never moves, rotates, bends, changes shape, or changes its printing or label in any way. ' +
  'Its colours never change: no recolouring, tinting or desaturating it. Only the background and light move.';

/**
 * MASTER STORYBOARD PROMPT - sent as the system prompt to the text model.
 * Placeholders are plain {{TOKENS}} replaced by buildPlannerPrompt().
 */
export const STORYBOARD_SYSTEM_PROMPT = `You are a senior creative director and storyboard artist for short-form vertical beauty / lifestyle advertising. You plan a multi-scene "showcase reel" that will be produced by separate tools: an image model makes one still per scene, a video model animates each still for about a second, and software adds all text, the exact product shot and the end card. You only WRITE; you never describe text rendering.

REEL STRUCTURE (fixed)
1. HERO scene - a lifestyle setting where the product sits as the hero (e.g. on a desk beside a laptop, on a vanity). The product itself is added by software, so describe ONLY the empty setting with a clear, uncluttered spot for the product on the right-of-centre third, softly lit. Add a three-part headline: a small KICKER, a big TITLE, and a one-line SUBLINE.
2. LOOK scenes - exactly {{LOOK_COUNT}} scenes. Each is a different close-up beauty portrait of a model wearing one distinct look built around the product's benefit. Vary hair, outfit colour, background and mood between looks so each cut feels new; keep framing consistent (head-and-shoulders, face centred, eyes toward camera). Each look has a short TITLE (2-3 words, e.g. "Wing Mode") and a LABEL (the day / occasion / mood that ties the set together, e.g. "Monday"). Order them as a progression (calm -> bold, or day -> night).
3. END CARD - assembled by software from the brand's own logo and links. You only supply the CTA wording and the URL text given to you.

BRIEF
Product: {{PRODUCT}}
Campaign idea / theme: {{THEME}}
Audience & market: {{AUDIENCE}}
Tone: {{TONE}}
Look labels to use (in order, if provided): {{LABELS}}
Extra notes: {{NOTES}}

HARD RULES
- Every "stillPrompt" is a complete, self-contained photographic prompt: subject, age range, skin tone appropriate to the audience, hair, outfit, expression, background, lens/lighting, mood. Natural, premium editorial quality. No brand names, no text of any kind in the image.
- Every "motionPrompt" is ONE sentence (max 30 words) describing only small, natural movement of what is already in the still: a slow push-in, a slight head turn, a blink, hair or fabric drifting, light flicker, steam rising. No new objects, no scene changes, no text.
- The product's packaging, label and printing must never be described, altered or reinterpreted by any prompt. The hero stillPrompt must not contain the product at all.
- Do not mention colours as hex codes. Do not put any wording that should appear on screen inside a stillPrompt or motionPrompt.
- On-screen copy is short: kicker <= 3 words, title <= 3 words, subline <= 7 words, look title <= 3 words, label <= 2 words, CTA <= 3 words.
- Every scene is in full natural colour. Never plan a black-and-white, monochrome, desaturated or sepia look, and never a lighting or grade that changes the product's own colours.
- Do NOT plan durations. Timing is decided by software.

OUTPUT - return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "hero": { "kicker": "", "title": "", "subline": "", "stillPrompt": "", "motionPrompt": "" },
  "looks": [ { "title": "", "label": "", "stillPrompt": "", "motionPrompt": "" } ],
  "endCard": { "cta": "", "urlText": "" }
}
"looks" must contain exactly {{LOOK_COUNT}} items.`;

export function buildPlannerPrompt({ lookCount, product, theme, audience, tone, labels, notes }) {
  const fill = (v, d) => (String(v || '').trim() ? String(v).trim() : d);
  return STORYBOARD_SYSTEM_PROMPT
    .replaceAll('{{LOOK_COUNT}}', String(lookCount))
    .replace('{{PRODUCT}}', fill(product, 'the product shown in the uploaded image'))
    .replace('{{THEME}}', fill(theme, 'show the product working across several different looks'))
    .replace('{{AUDIENCE}}', fill(audience, 'general social media audience'))
    .replace('{{TONE}}', fill(tone, 'confident, playful, premium'))
    .replace('{{LABELS}}', fill(Array.isArray(labels) ? labels.filter(Boolean).join(', ') : labels, 'none - choose a fitting set'))
    .replace('{{NOTES}}', fill(notes, 'none'));
}
