// COLOUR INTEGRITY - two non-negotiable rules for every design the app creates:
//
//   1. The PRODUCT's colours are sacrosanct. Whatever the product image shows (body, cap,
//      label, artwork, finish) is reproduced exactly - no recolouring, tinting, grading
//      or desaturating - in images AND videos. (Sits next to the existing rule that
//      packaging/labelling never changes.)
//   2. NO black-and-white / greyscale / monochrome / sepia variation of any design. Every
//      creative is full colour.
//
// These strings are added at GENERATION time inside router.generateImage() and
// videoRouter.submitVideoJob() - the two choke points every image/video request already
// passes through - and are never stored inside a saved imagePrompt (same rule as
// buildTemplateInstruction). utils/colourGuard.js then CHECKS the result, because a prompt
// alone cannot stop a model from returning a greyscale image.

export const PRODUCT_COLOUR_RULE =
  'PRODUCT COLOUR INTEGRITY (non-negotiable): wherever a product, pack, bottle, tube, box, device or label from a reference image appears, its colours must be reproduced exactly as in that reference - the same hue, saturation, brightness and finish on the body, cap, label and artwork. Never recolour, tint, swap, fade, bleach, darken, desaturate or colour-grade the product, and do not let the scene lighting, filters, mood or background colour shift how the product looks: it must read in its true, original colours at all times.';

export const NO_MONOCHROME_RULE =
  'FULL COLOUR ONLY (non-negotiable): the whole image must be in full natural colour. Never produce a black-and-white, greyscale, monochrome, desaturated, sepia, duotone, single-colour-tinted or "noir" version of the design, in whole or in part, and do not create a black-and-white variant. Render strictly in full, vivid, natural colour: skin tones, backgrounds, props and the product must all show their real colours. This overrides any other instruction, style note or mood in this prompt that could be read as asking for it.';

export const COLOUR_RULES = `${PRODUCT_COLOUR_RULE} ${NO_MONOCHROME_RULE}`;

export const STRICT_COLOUR_RETRY =
  'IMPORTANT: the previous attempt came back black-and-white / greyscale, which is not allowed. Render this strictly in full, vivid, natural colour: skin tones, backgrounds, props and the product must all show their real colours.';

// Videos: the motion prompt is what is controlled, and the first frame (when there is one) already carries the colours.
export const VIDEO_COLOUR_RULES =
  'COLOUR RULE (non-negotiable): full natural colour in every frame - never black-and-white, greyscale, desaturated, sepia or colour-faded. The product keeps its exact original colours; never recolour, tint or colour-grade the product or its packaging.';

// Wording that asks for a monochrome treatment - used to filter AI-suggested ideas.
export const MONOCHROME_REQUEST_RE = /\b(black[\s-]*(and|&|n)[\s-]*white|b\s*&\s*w|b\/w|monochrom\w*|gr[ae]y[\s-]?scale|desaturat\w*|sepia|noir|colou?r[\s-]*(drain|fade|bleach)\w*|washed[\s-]*out|bleach[\s-]*bypass)\b/i;

// One-line instruction for the text models that write prompts / suggest ideas.
export const PLANNER_COLOUR_RULE =
  'COLOUR RULE: never propose or write a black-and-white, greyscale, monochrome, sepia, desaturated or colour-drained look, and never a colour grade or lighting change that alters the product\'s own colours. Every idea stays in full natural colour and the product keeps its exact colours.';
