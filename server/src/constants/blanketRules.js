// BLANKET INSTRUCTIONS - every piece of standing text the app adds to AI prompts on its own, regardless of what a
// user typed. Each one is listed here with its default wording so a super admin can read it, reword it, switch
// it off, or put it back to the default under Admin -> AI Settings -> Blanket instructions.
//
// The code asks for a rule by key through services/blanketRulesService.js#ruleText(key), which returns the
// admin's wording, the default below, or '' when the rule has been switched off.
//
// Rules are added at GENERATION time only; they are never stored inside a saved prompt.
import { PRODUCT_COLOUR_RULE, NO_MONOCHROME_RULE, STRICT_COLOUR_RETRY, VIDEO_COLOUR_RULES, PLANNER_COLOUR_RULE } from './colourIntegrity.js';
import { CUSTOM_STEP_GUARD } from './customFeature.js';

// Standing wording for Brief Studio videos (moved here when the Multi-scene Video feature was removed).
const MOTION_GUARD =
  'Subtle, natural motion only. No text, letters, numbers, captions, subtitles, logos, watermarks or signs anywhere in the frame. ' +
  'The subject keeps the exact same face, hair, makeup, outfit and styling as the first frame; nothing morphs or changes. Full natural colour throughout - never black-and-white, desaturated or colour-faded. No audio.';
const PRODUCT_LOCK =
  'The product in the frame is a fixed, rigid object: it never moves, rotates, bends, changes shape, or changes its printing or label in any way. ' +
  'Its colours never change: no recolouring, tinting or desaturating it. Only the background and light move.';

export const MAX_RULE_CHARS = 2500;

export const RULE_GROUPS = [
  { key: 'image', label: 'Images', hint: 'Added to every image request (designs, slides, Brief Studio, masked edits).' },
  { key: 'video', label: 'Videos', hint: 'Added to every video request.' },
  { key: 'features', label: 'Brief Studio', hint: 'Added by custom features (Brief Studio).' },
  { key: 'planner', label: 'AI planners', hint: 'Added to the instructions of the text models that suggest ideas.' }
];

// `caution: true` = a brand-safety rule (product colours, product labels, full colour). The page asks for a confirmation before one is switched off.
export const BLANKET_RULES = [
  {
    key: 'imageFullCanvas', group: 'image', label: 'Fill the whole canvas', appliesTo: 'All image models',
    description: 'Stops letterboxing, black bands, borders and empty margins. This wording is the only protection when the automatic Black-bar check is off (the default).',
    default: 'The artwork must fill the ENTIRE canvas edge to edge: no black bars, black bands, letterboxing, pillarboxing, borders, frames or empty margins on any side. Extend the scene/background naturally all the way to every edge of the frame so no area is black or blank, and compose the elements for the full canvas height and width, even if a reference image has a different shape.'
  },
  {
    key: 'imageProductColour', group: 'image', label: 'Product colours stay exact', appliesTo: 'All image models', caution: true,
    description: 'The product keeps its true colours; scene lighting or grading must not shift them.',
    default: PRODUCT_COLOUR_RULE
  },
  {
    key: 'imageNoMonochrome', group: 'image', label: 'Full colour only', appliesTo: 'All image models', caution: true,
    description: 'No black-and-white, greyscale or tinted variants. This wording is the only protection when the automatic Colour check is off (the default).',
    default: NO_MONOCHROME_RULE
  },
  {
    key: 'imageAnatomy', group: 'image', label: 'Hands, arms, legs and feet drawn correctly', appliesTo: 'OpenAI image model (gpt-image)',
    description: 'Asks the OpenAI image model to get fingers, toes, limbs and proportions right whenever a person is visible.',
    default:
      'Anatomy check - if any person, hand, arm, leg or foot is visible: every hand has exactly five fingers with natural proportions, joints and nails, and holds or touches objects realistically (a held product keeps its exact shape and label); every person has exactly two arms and two legs, two feet with five toes each, in a believable pose with correct proportions, limb lengths and joint bends, and no merged, extra, missing, twisted or floating limbs, fingers or toes; legs and feet are not cropped awkwardly, and shoes or socks sit naturally on the feet. Bodies are not distorted or stretched. If a hand or foot cannot be drawn correctly, hide it naturally (out of frame, behind an object or in a pocket) instead of showing it wrong.'
  },
  {
    key: 'imageFullCanvasRetry', group: 'image', label: 'Retry: black band along an edge', appliesTo: 'All image models',
    description: 'Added only when the automatic check finds a black band and the image is regenerated.',
    default: 'IMPORTANT: the previous attempt left a black band along one edge. Extend the scene/background naturally all the way to every edge of the frame so no area is black or blank, and compose the elements for the full canvas height and width, even if a reference image has a different shape.'
  },
  {
    key: 'imageColourRetry', group: 'image', label: 'Retry: result came back greyscale', appliesTo: 'All image models',
    description: 'Added only when the automatic check finds a black-and-white result and the image is regenerated.',
    default: STRICT_COLOUR_RETRY
  },
  {
    key: 'videoColour', group: 'video', label: 'Full colour, product colours exact', appliesTo: 'All video models', caution: true,
    description: 'Added to every video prompt.',
    default: VIDEO_COLOUR_RULES
  },
  {
    key: 'videoGlitch', group: 'video', label: 'No glitches in the video', appliesTo: 'All video models',
    description: 'Keeps the finished video clean and stable. It does not limit what moves or how much; it only rules out technical glitches.',
    default:
      'Glitch-free output: one smooth, continuous, artefact-free clip. No flicker, jitter, stutter, frozen or repeated frames, sudden jumps or scene resets, and no flashes, colour or brightness pops. Nothing pops in, vanishes, duplicates, splits, melts, warps or morphs unintentionally; every object, person and face keeps a stable, consistent shape, size and identity from the first frame to the last. Edges stay clean, with no ghosting, smearing, tearing, warping or stray artefacts, and motion follows believable physics. The clip ends cleanly, without a cut-off or abrupt change in the last frames.'
  },
  {
    key: 'videoHands', group: 'video', label: 'Correct hands and fingers in the video', appliesTo: 'All video models',
    description: 'Cuts down glitchy hands: extra, merged or missing fingers, extra hands or limbs. It does not limit what the hands do.',
    default:
      'Correct human anatomy in every frame: each person has exactly two hands with five fingers each (never extra, missing, fused, melting or shifting fingers) and the right number of arms and legs. Hands keep one stable, natural shape and size and never duplicate, merge into objects or change count while they move. Keep hand actions simple and natural; where a hand action would be complex, show it from an angle or distance where the hands stay clean.'
  },
  {
    key: 'videoGuardrail', group: 'video', label: 'Keep text, labels and product still', appliesTo: 'All video models', caution: true,
    description: 'Logos, labels, packaging and on-screen text must stay sharp and static; no new or garbled lettering.',
    default:
      'CRITICAL: any logo, brand mark, compliance disclaimer, legal text, price, product label or packaging, or other on-screen text/graphic must stay perfectly sharp, fully legible, and completely static the entire time - never warp, blur, distort, animate, fade, reveal, redraw, re-render or move text, labels or graphic overlays, even slightly; do not add, invent or re-render any text, captions, labels or lettering - every letter in the video must be pixel-identical to the approved image, with no garbled, extra, misspelled or morphing characters - and do not change the product or its packaging in any way.'
  },
  {
    key: 'videoGuardrailTextMotion', group: 'video', label: 'Keep logos and labels still (headline motion allowed)', appliesTo: 'All video models', caution: true,
    description: 'Replaces the rule above when a person explicitly asks for headline / tagline animation.',
    default:
      'CRITICAL: any logo, brand mark, QR code, registration number, compliance disclaimer, legal text, price, product label or packaging must stay perfectly sharp, fully legible and completely static the entire time. The ONLY on-screen text allowed to move is the headline/super/tagline/call-to-action motion explicitly requested; that text must keep its exact wording and spelling, with no garbled, morphing or extra letters, and be perfectly sharp and legible whenever it is on screen. Do not add any new text, captions or lettering, and do not change the product or its packaging in any way.'
  },
  {
    key: 'videoSilent', group: 'video', label: 'Silent video (Brief Studio videos)', appliesTo: 'Brief Studio video features',
    description: 'No speech, singing or music: video models refuse prompts whose audio they cannot make safely.',
    default: 'Silent video: no speech, no voices, no dialogue, no singing, no lyrics and no music; at most faint natural ambience.'
  },
  {
    key: 'customStepGuard', group: 'features', label: 'Brief Studio image guard', appliesTo: 'Brief Studio image features',
    description: 'No drawn text or logos; supplied products keep their exact packaging; natural people.',
    default: CUSTOM_STEP_GUARD
  },
  {
    key: 'sceneMotionGuard', group: 'features', label: 'Brief Studio: motion', appliesTo: 'Brief Studio videos',
    description: 'Subtle motion, no text, the subject never changes.',
    default: MOTION_GUARD
  },
  {
    key: 'sceneProductLock', group: 'features', label: 'Brief Studio: product lock', appliesTo: 'Brief Studio videos with a product',
    description: 'The product is a rigid object: it never moves, changes shape, label or colour.',
    default: PRODUCT_LOCK
  },
  {
    key: 'plannerColour', group: 'planner', label: 'Planners keep full colour', appliesTo: 'Video idea suggestions', caution: true,
    description: 'Stops the idea-writing model from proposing black-and-white or colour-drained looks.',
    default: PLANNER_COLOUR_RULE
  }
];

export const RULE_BY_KEY = Object.fromEntries(BLANKET_RULES.map((r) => [r.key, r]));
