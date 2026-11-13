import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { describeHexColors } from '../../utils/colorNames.js';
import * as router from './router.js';
import { ruleText, ruleTexts } from '../blanketRulesService.js';
import { isMonochromeOutput } from '../../utils/colourGuard.js';
import * as openaiProvider from './providers/openai.js';
import { saveGeneratedImage } from '../../utils/saveGeneratedImage.js';
import { compositeExactAssets } from '../../utils/compositeExactAssets.js';
import { uploadDir, uploadUrl, resolveUploadPath } from '../../utils/storage.js';
import { generateCaption, brandSystemPrompt } from './captionService.js';
import { workspaceLanguage, hasNonLatinScript } from '../../utils/language.js';
import { getSettings } from '../appSettingsService.js';
import { getFormat, isCarouselFormat, isVideoFormat, FORMAT_COPY_NOTES } from '../../constants/postFormats.js';
import { estimateTextCostUsdByProvider, estimateImageCostUsdByProvider } from '../costEstimateService.js';
import { openaiImageCostFromUsage } from '../../constants/aiPricing.js';
import { logUsageSafely } from '../aiUsageLogService.js';
import { brandGuideLines } from '../../utils/brandGuide.js';
import { photographyLines } from '../../utils/photographyGuide.js';
import { fontSpecimenFile, fontProofFile } from '../../utils/fontSpecimen.js';
import { canSetText, planTextLayout, overlayText } from '../../utils/textOverlay.js';
import { strictTextRules } from '../../utils/textVerify.js';
import { getTenant } from '../../tenant/context.js';

/**
 * Rotating across text models gives genuine variety across the 6 copy
 * directions when multiple providers are actually configured. But two
 * things take priority over that variety:
 *   1. If an admin has pinned a specific default model (Admin -> AI
 *      Settings), that's a deliberate choice - honor it for every
 *      direction rather than rotating away from it.
 *   2. Pinning a specific provider that ISN'T configured (e.g. always
 *      trying "gemini" for variant 3) doesn't fall back - it silently
 *      produces a placeholder instead of real copy. So: only rotate among
 *      providers actually configured; fall back to 'auto' alone when fewer
 *      than 2 are configured, rather than ever pinning to something
 *      unavailable.
 */
async function resolveTextRotation(requestedModel) {
  if (requestedModel !== 'auto') return [requestedModel];

  // AI Block Architecture: a saved copy pipeline decides the order (and whether to rotate).
  const info = await router.planInfo('copy');
  if (info) {
    if (info.rotate && info.configuredOrder.length > 1) return info.configuredOrder;
    return [info.order[0]];
  }

  const settings = await getSettings().catch(() => null);
  if (settings?.copyModel && settings.copyModel !== 'auto') {
    return [settings.copyModel];
  }

  const status = router.providerStatus();
  const configured = ['openai', 'anthropic', 'gemini'].filter((p) => status[p]);
  return configured.length > 1 ? configured : ['auto'];
}

/**
 * Same idea as resolveTextRotation but for image generation, which never
 * rotates (each generation call is expensive, so there's no "variety
 * across directions" benefit to picking a different provider per call).
 * If an admin has pinned a default image model, honor it; otherwise leave
 * 'auto' alone and let router.js's AI_IMAGE_PRIORITY env chain decide.
 */
async function resolveImageModel(requestedModel) {
  if (requestedModel !== 'auto') return requestedModel;

  // AI Block Architecture: a saved image pipeline's primary model (router.js adds its fallbacks).
  const info = await router.planInfo('image');
  if (info) return info.order[0];

  const settings = await getSettings().catch(() => null);
  if (settings?.imageModel && settings.imageModel !== 'auto') {
    return settings.imageModel;
  }
  return 'auto';
}

const DEFAULT_DIRECTION_COUNT = 4;
const VARIANT_LABELS = ['Variant A', 'Variant B', 'Variant C', 'Variant D', 'Variant E', 'Variant F'];

// Used only when no image provider is configured / image gen fails - keeps
// the workflow fully demoable and visually on-brand with the reference UI.
const FALLBACK_GRADIENTS = [
  'linear-gradient(160deg,#0F2A5C,#2E5EFF 60%,#8FA9FF)',
  'linear-gradient(200deg,#0A0E17,#2E5EFF 70%)',
  'linear-gradient(120deg,#2E5EFF,#EEF3FF)',
  'linear-gradient(160deg,#1D3FE0,#0F2A5C)',
  'linear-gradient(200deg,#0F2A5C,#8FA9FF)',
  'linear-gradient(120deg,#0A0E17,#2E5EFF)'
];

/**
 * Builds the reference-image instruction(s) fresh, given the CURRENT set of
 * grounding/style images - kept as its own function (rather than baked
 * permanently into a stored prompt) so it stays accurate even if the user
 * adds/removes reference creatives after copy was already drafted.
 */
export function referenceInstructionText({ hasGroundingImages, hasStyleImages, hasExactAssets = false, hasProductLock = false, hasTemplateImages = false, templatePreservation = null, hasBrandReferenceImages = false, hasLayoutImages = false }) {
  const parts = [];
  if (hasTemplateImages) {
    // Template mode replaces (rather than adds to) the normal grounding
    // instruction below - the two give the model conflicting jobs ("keep
    // everything the same" vs "place the subject into a new scene"), so
    // only one should ever be active for a given reference image.
    parts.push(buildTemplateInstruction(templatePreservation));
  } else if (hasGroundingImages) {
    parts.push(
      'One or more reference images are attached showing the actual product/logo/subject. Use it as the real subject of this creative - do not invent a different product, substitute a generic stand-in, or change its shape/label/design. Keep it recognizably the same item, placed into the new scene/background described below. Keep the product in its exact original colours - never recolour, tint, fade or desaturate it, and do not let the scene lighting or palette change how it looks.'
    );
  }
  if (hasStyleImages) {
    parts.push(
      'One or more additional reference images are attached purely for visual style inspiration (mood, palette, lighting, composition, overall treatment) - match their general look and feel, but do NOT copy their specific subject matter or literal content.'
    );
  }
  // Super-admin material, only sent while the brand is followed. A template adaptation has its own fixed layout, so these step aside.
  if (hasBrandReferenceImages && !hasTemplateImages) {
    parts.push(
      'Some attached reference images are the brand\'s own approved visuals. Study them ONLY to understand the brand\'s design language: palette, lighting, photographic or illustrative treatment, typography feel, spacing and overall tone. Create something new in the same family - do NOT copy their subject, scene, people, wording or layout, and never reproduce any of them.'
    );
  }
  if (hasLayoutImages && !hasTemplateImages) {
    parts.push(
      'Some attached images are the brand\'s preferred layouts. Take the closest one as the STARTING POINT for the composition: keep its arrangement (where the headline, hero subject, logo and open space sit, the proportions and the balance), then adapt it to this brief and format. Do NOT copy its specific wording, product or people.'
    );
  }
  if (hasExactAssets) {
    parts.push(
      'Leave clean, uncluttered negative space in one corner of the composition (bottom-right by default) - a separate logo/asset graphic will be placed there afterward. Do not draw your own logo, watermark, or competing graphic in that area.'
    );
  }
  if (hasProductLock) {
    parts.push(
      'PRODUCT LOCK: the real product photo (with its exact packaging, label and artwork) is placed into the centre of the finished design afterward, so do NOT draw, depict or imagine any product, bottle, tube, box, pack, jar or label of your own anywhere in the image. Leave the central area of the composition clear - roughly half the frame width, from the upper-middle down to the lower third - as an empty podium, surface or open space, and build the scene (background, props, splashes, leaves, light) around it, keeping props toward the edges and nothing overlapping the centre. Light the scene as if a product stands there. The product keeps its exact original colours, so keep the scene\'s palette, lighting and grading from tinting, darkening or washing it out - and the scene itself must be in full colour, never black-and-white.'
    );
  }
  return parts.join(' ');
}

/**
 * Builds the template-preservation instruction from the person's actual
 * per-element choices (see templatePreservation on creativeBriefSchema in
 * Post.js) rather than one fixed "preserve absolutely everything"
 * statement - so someone who explicitly said "the logo doesn't need to
 * carry over" or "redesign the layout, just keep the key visual" gets an
 * instruction that actually reflects that, instead of every adaptation
 * being told the same maximally-strict thing regardless of intent.
 * Falls back to the original strict "preserve everything" wording when no
 * choices were recorded (e.g. detection wasn't available and defaults
 * were never explicitly confirmed) - preserving everything is the safer
 * default to fail toward.
 */
function buildTemplateInstruction(prefs) {
  const p = prefs || {};
  const mustPreserve = [];
  const mayRedesign = [];
  // Elements the person explicitly UNticked that are visually dominant in the
  // reference (the hero subject, the background). "May be replaced at your
  // discretion" was too weak for these - an image model handed the full
  // reference tends to keep whatever is most prominent in it, so an unticked
  // hero kept coming back unchanged. These get a directive instead.
  const mustChange = [];

  const custom = typeof p.customInstruction === 'string' ? p.customInstruction.trim().slice(0, 1000) : '';

  const rule = (flag, must, optional) => (flag === false ? mayRedesign.push(optional) : mustPreserve.push(must));

  rule(p.preserveLogo, 'every logo lockup wherever it appears (corner marks, badges, watermarks)', 'the logo may be resized, repositioned, or omitted if it genuinely does not fit the new composition');
  if (typeof p.preservePrimaryHeadline === 'boolean') {
    rule(p.preservePrimaryHeadline, 'the primary headline exactly as shown - the same wording, position, size, and typographic style', 'the primary headline wording may change to suit the new brief, while keeping its position, size, and typographic style');
  }
  // Rectangles drawn on the reference image around untouchable elements. Turned
  // into plain-language position + size so the image model can locate them.
  const regions = (Array.isArray(p.protectedRegions) ? p.protectedRegions : [])
    .filter((r) => [r?.x, r?.y, r?.w, r?.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.w > 0 && r.h > 0)
    .slice(0, 8);
  // Position/size are described in WORDS, never digits or percent signs: image
  // models paint numbers they are given as visible on-image text (it showed up
  // as a stray "16% 98% 12% 12%" in the corner of a generated ad).
  const words = (n) => {
    const v = Math.min(1, Math.max(0, n));
    if (v < 0.1) return 'a sliver';
    if (v < 0.2) return 'about a seventh';
    if (v < 0.3) return 'about a fifth';
    if (v < 0.4) return 'about a third';
    if (v < 0.6) return 'about half';
    if (v < 0.8) return 'about two thirds';
    return 'nearly all';
  };
  const where = (r) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const v = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
    const h = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'center';
    return v === 'middle' && h === 'center' ? 'center' : `${v}-${h}`;
  };
  const regionsLine = regions.length
    ? `PROTECTED AREAS - the art director drew ${regions.length === 1 ? 'a rectangle' : `${regions.length} rectangles`} on the reference image around content that must NOT be modified. Reproduce the contents of each rectangle exactly as in the reference: identical content, size, colors, sharpness and position, never redrawn, restyled, re-rendered, blurred or reinterpreted, and keep every other element clear of them (positions are described relative to the reference image frame): ${regions
        .map(
          (r, i) =>
            `(${i + 1}) ${r.label ? `"${String(r.label).slice(0, 60)}" - ` : ''}${where(r)} of the frame, covering ${words(r.w)} of the width and ${words(r.h)} of the height`
        )
        .join('; ')}. These areas keep their exact position even if the rest of the layout changes. This description is guidance only - never write any of it, or any numbers or percentages, on the image.`
    : '';
  const customExcept = custom ? ', except for whatever the CUSTOM CHANGES instruction below explicitly asks to change' : '';
  if (p.preserveKeyVisual === false) {
    mustChange.push('the key visual/hero subject - do NOT copy or redraw the main subject(s) shown in the reference image (the people, product, or vehicle that is the focus of it). Create a clearly different hero subject that suits the new brief and creative direction below: different people/product, a different pose or action and a different framing, so that nobody could mistake it for the reference\'s subject. Reuse only the screen area it occupies');
  } else {
    mustPreserve.push(`the key visual/hero subject exactly as shown - the same subject(s) (for a vehicle: the identical make, model, design, color, and details), pose/action, camera angle, and framing as the reference image${customExcept}`);
  }
  if (p.preserveBackground === false) {
    mustChange.push('the background/setting/location - do NOT reproduce the scene shown in the reference image. Create a different background/location that suits the new brief and creative direction below (different surroundings, props and scenery); if any preserved subject remains, re-light it so its shadows, reflections, and color temperature match the new scene');
  } else {
    mustPreserve.push(`the background/setting/location exactly as shown - keep the reference's own background itself: the same scene, surroundings, landmarks, scenery, colours, gradients, lighting and time of day, as the same image rather than a new one painted to match. Do not regenerate, recolour, restyle, simplify or swap it for a different place or backdrop that merely fits the same theme; the only changes allowed there are what is needed to place new text${customExcept}`);
  }
  rule(p.preserveSecondaryText, 'any secondary headline/tagline block elsewhere in the frame, beyond the primary headline', 'secondary headline/tagline blocks may be dropped or reworded freely, or removed entirely');
  rule(p.preserveComplianceText, 'any small print such as registration numbers, legal disclaimers, or QR codes', 'small print/compliance text may be omitted (a separate exact overlay may be used for this instead - see below)');
  rule(p.preserveDecorative, 'decorative line-art/graphic elements', 'decorative graphic elements may be changed or omitted');

  const layoutFlexible = p.layoutFlexible === true;

  const customLine = custom
    ? `CUSTOM CHANGES requested by the art director (these take priority over the preservation rules above wherever they conflict - apply exactly these changes and keep everything else as specified above): "${custom}". If a change affects the environment (background, location, time of day, weather), re-light and re-grade any preserved subject so its shadows, reflections, and color temperature match naturally, and make the result look authentic and specific rather than a generic or stereotyped backdrop.`
    : '';

  const header =
    'One or more reference images are attached showing an existing finished creative. This is the design template for this adaptation.';

  const preserveLine = mustPreserve.length
    ? `The following elements MUST be preserved, in the same relative position and scale as the reference: ${mustPreserve.join('; ')}.`
    : '';
  // Style/angle/brand-colour/mood lines elsewhere in the prompt (and the per-option
  // "visual approach") otherwise pull the model into repainting preserved areas.
  const overrideLine = mustPreserve.length
    ? 'PRIORITY: these preservation rules override every creative direction, visual approach, mood, colour-palette, brand-style or lighting note elsewhere in this prompt. Those notes may only influence elements that are NOT marked as preserved above.'
    : '';
  const changeLine = mustChange.length
    ? `The following MUST be changed - they must NOT be carried over from the reference image, even though the reference shows them prominently: ${mustChange.join('; ')}.`
    : '';
  const redesignLine = mayRedesign.length
    ? `The following do NOT need to be carried over exactly and may be changed, repositioned, or omitted at your discretion: ${mayRedesign.join('; ')}.`
    : '';

  const layoutLine = layoutFlexible
    ? 'The overall layout/composition itself may be redesigned - it does not need to match the reference structurally, as long as every element marked "must be preserved" above still appears somewhere in the new image.'
    : `Keep the overall composition, layout, color treatment, and typography style as close to the original as possible${custom ? ' (except where the custom changes below say otherwise)' : ''}${mustChange.length ? ', except for the elements marked "must be changed" above, whose contents are newly created' : ''} - do not restructure or redesign the layout.`;

  const copyScope = p.preservePrimaryHeadline === true ? 'secondary messaging/copy (taglines, body text)' : 'messaging/copy (headlines, taglines, body text)';
  const copyLine = `Regardless of the above, the wording of the ${copyScope} should always be updated to match the new brief and creative direction described below - preserving an element means preserving its presence/position/style, not its old wording.${p.preservePrimaryHeadline === true ? ' The one exception is the primary headline, which keeps its exact wording as marked above.' : ''}`;

  // No explicit choices recorded at all - fall back to the original
  // maximally-strict instruction rather than guessing.
  if (!prefs) {
    return [
      header,
      'Reproduce EVERY graphic and text element visible in it, including but not limited to the primary headline and any secondary headline/tagline blocks, all logo lockups wherever they appear, any small print such as registration numbers/disclaimers/QR codes, and any decorative line-art/graphic elements.',
      'Do not treat any element as optional just because it is small, secondary, or in fine print.',
      layoutLine,
      copyLine
    ].join(' ');
  }

  return [header, preserveLine, overrideLine, changeLine, regionsLine, redesignLine, layoutLine, customLine, copyLine].filter(Boolean).join(' ');
}

/**
 * Builds the typography instruction - either "render this headline into
 * the image" (when the user wants baked-in text) or the default "leave
 * clean space, no text" behavior. Exported and applied fresh at
 * image-generation time (not baked into the copy-time prompt), since a
 * meaningful headline can only be suggested once real copy exists.
 */
const SCRIPT_NOTE = ' The text is not in plain English letters: draw every character, vowel sign, accent and mark exactly as given, in its own script. Never transliterate, translate, substitute or invent characters.';
export function typographyInstructionText({ includeTypography, headlineText, subHeadlineText = '' }) {
  const note = hasNonLatinScript(headlineText, subHeadlineText) ? SCRIPT_NOTE : '';
  if (includeTypography && headlineText?.trim() && subHeadlineText?.trim()) {
    return `Include exactly two pieces of text rendered directly in the image, clean and legible, in flat solid high-contrast colour with no effects (no shadow, outline, glow, gradient, 3D, texture or distortion). HEADLINE (large, bold, the dominant text): "${headlineText.trim()}". SUB-HEADLINE (clearly smaller and lighter than the headline, placed directly beneath or beside it as its supporting line): "${subHeadlineText.trim()}". Spell both exactly, letter for letter. These two lines are the ONLY text/typography in the image: no tagline, caption, call-to-action, small print, brand name, watermark or any other lettering anywhere, and no gibberish or placeholder text. Compose the rest of the image around them so they do not clash with the layout.${note}`;
  }
  if (includeTypography && headlineText?.trim()) {
    return `Include the following short headline/CTA text prominently and legibly rendered directly in the image: "${headlineText.trim()}". Spell it exactly, letter for letter. Keep it bold, short, and highly legible, in flat solid high-contrast colour with no effects (no shadow, outline, glow, gradient, 3D, texture or distortion) - this is the ONLY text/typography element to render in the image: no second line, tagline, subtitle, caption, call-to-action, small print, brand name, watermark or any other lettering anywhere, and no gibberish or placeholder text. Compose the rest of the image around it so it doesn't clash with the layout.${note}`;
  }
  return 'Do not render any text, words, letters, logos, or watermarks yourself - the caption is added separately. Composition must leave clean, uncluttered negative space (roughly the bottom third, or wherever the composition naturally allows) for a text/caption overlay to be added afterward.';
}

// 'include' -> people are a hard requirement (it also overrides any "no people"
// hint elsewhere); 'none' -> none at all; 'auto' -> no instruction.
function peopleDirection(cb = {}) {
  if (cb.peopleMode === 'none') return '- People: do NOT show any people, faces, hands or body parts - the image is about the product/subject/environment only.';
  if (cb.peopleMode !== 'include') return '';
  const bits = [
    cb.peopleCount ? cb.peopleCount.toLowerCase() : 'at least one clearly visible person',
    cb.peopleAge?.length ? `age group: ${cb.peopleAge.join(' / ').toLowerCase()}` : '',
    cb.peopleGender === 'Only female' ? 'gender: every person shown must be female - no men or boys anywhere in the image' : '',
    cb.peopleGender === 'Only male' ? 'gender: every person shown must be male - no women or girls anywhere in the image' : '',
    cb.peopleStyle ? `shown as: ${cb.peopleStyle.toLowerCase()}` : '',
    // Older posts have no stored value - treat as the Indian default; '' means no preference.
    (cb.peopleEthnicity ?? 'Indian') ? `ethnicity: ${cb.peopleEthnicity ?? 'Indian'} (unless the specific note below says otherwise)` : '',
    cb.peopleNote ? `specifically: ${String(cb.peopleNote).slice(0, 200)}` : ''
  ].filter(Boolean);
  return `- People: the final design MUST feature real-looking human people as a prominent part of the composition (${bits.join('; ')}). They are fictional, natural-looking people with realistic faces, hands and proportions - not any real or recognisable person, celebrity or public figure. This overrides any generic "no people" style note elsewhere in this brief.`;
}

function buildImagePrompt({ purpose, medium, briefNote, user, angle, creativeBrief = {}, hasTemplateImages = false, followBrand = true }) {
  // followBrand=false: no brand name, palette, imagery style or brand mood tags at all.
  const brandOn = followBrand !== false;
  const brand = user?.company?.name || 'the brand';
  const industry = user?.company?.industry || '';
  const colors = brandOn ? describeHexColors(user?.brandKit?.colors?.slice(0, 3).join(', ') || '') : '';
  // The brand's analyzed design language (mood tags + imagery style from
  // past brand assets) is OPT-IN per brief. Without it, a brief's styling
  // comes only from what's chosen in this brief - nothing carried over from
  // earlier inputs.
  const dl = brandOn && creativeBrief?.useBrandStyle ? user?.brandKit?.designLanguage : null;
  const format = getFormat(medium);

  const {
    moodTags = [],
    styleReferences = [],
    lightingStyle = '',
    compositionStyle = '',
    primaryMessage = '',
    mustInclude = '',
    mustAvoid = ''
  } = creativeBrief;

  const allMoodTags = [...new Set(moodTags)];
  const brandMoodTags = (dl?.moodTags || []).filter((t) => !allMoodTags.includes(t));
  // People (Step 3 > Look & feel). Not used for template adaptation, where the
  // uploaded creative decides what is shown.
  const peopleLine = hasTemplateImages ? '' : peopleDirection(creativeBrief);
  const hasHardRequirements = Boolean(primaryMessage || mustInclude || mustAvoid || briefNote || peopleLine);

  const hardRequirementsBlock = hasHardRequirements
    ? [
        'HARD REQUIREMENTS - these are non-negotiable and take priority over every style preference below if the two ever conflict:',
        briefNote ? `- Brief: this post is specifically about "${briefNote}" - the image must reflect this, not a generic version of the purpose/industry.` : '',
        primaryMessage ? `- Must communicate at a glance: ${primaryMessage}` : '',
        mustInclude ? `- Must include/depict: ${mustInclude}` : '',
        mustAvoid ? `- Must NOT include/depict: ${mustAvoid}` : '',
        peopleLine
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return [
    // NOTE: the reference/template-preservation instruction is deliberately
    // NOT built here. This imagePrompt gets stored on the variant and can
    // be reused for image (re)generation long after copy was drafted - if
    // we baked referenceInstructionText in at this point, it would freeze
    // whatever templatePreservation/layoutFlexible choices were active at
    // copy time. generateImageForVariant computes it fresh, from the
    // CURRENT saved choices, at actual generation time instead - see
    // referenceInstructionText below. Baking it in both places caused old
    // and new preservation instructions to contradict each other in the
    // same prompt whenever the person changed a checkbox or the
    // Strict/Flexible toggle after copy had already been generated.
    // Framing the task at a professional tier consistently nudges image
    // models toward higher production value (better lighting, composition,
    // less generic "stock AI" look) than a bare literal description does.
    `Create a professional, award-caliber advertising creative (the kind of visual you'd see shortlisted at Cannes Lions or D&AD) for ${format.label} (${format.ratio} ${format.orientation}), purpose: ${purpose}.`,
    brandOn ? `Brand: ${brand} (${industry} industry).` : '',
    hardRequirementsBlock,
    'STYLE DIRECTION - apply these, but only where they don\'t conflict with the hard requirements above:',
    colors ? `- Primary brand colors to lean on (as the overall visual color palette; they are colors only, not text): ${colors}` : '',
    dl?.imageryStyle ? `- This brand's established imagery style (from an analyzed brand asset): ${dl.imageryStyle}` : '',
    allMoodTags.length ? `- Mood/tone: ${allMoodTags.join(', ')}` : '',
    brandMoodTags.length ? `- Brand mood/tone (from analyzed brand assets): ${brandMoodTags.join(', ')}` : '',
    // The agency's brand guide for this customer. Always applied while the brand is followed (not tied to useBrandStyle).
    ...(brandOn ? brandGuideLines(user?.brandKit, 'design').map((l) => `- Brand guideline: ${l}`) : []),
    // Photography guide (agency-uploaded .md, condensed): how photographed people / products are shot and lit. Photo direction only,
    // never type or layout. Applies even when the brand is not followed (it carries no brand name, colours or identity); only template
    // adaptations skip it, because the template fixes the visuals.
    ...(!hasTemplateImages ? photographyLines(user?.brandKit, { people: creativeBrief?.peopleMode === 'none' ? 'none' : creativeBrief?.peopleMode === 'include' ? 'include' : 'auto' }).map((l) => `- Photography direction: ${l}`) : []),
    // The brand's fonts from Brand Assets -> Look & feel. They apply to any text shown, even when the rest of the brand look is off (they are not
    // a colour or a brand name), and not to template adaptations, where the uploaded creative's own lettering stays as it is.
    ...(!hasTemplateImages ? fontLines(user?.brandKit?.fonts) : []),
    styleReferences.length ? `- Visual style/reference direction: ${styleReferences.join('; ')}` : '',
    lightingStyle ? `- Lighting: ${lightingStyle}` : '',
    compositionStyle ? `- Composition: ${compositionStyle}` : '',
    `- Creative direction for this specific variant: ${angle}${hasTemplateImages ? ' (apply this only through the copy/message and any minor accent details - the template\'s own layout, key visual/hero subject, logo, and branding elements from the reference image still take priority over this direction; do not use this creative direction as a reason to depict a different scene, subject, or setting than the one preservation is asking for)' : ''}`,
    'Avoid generic stock-photo or generic-AI-image tropes (no random floating geometric shapes for their own sake, no meaningless bokeh-only backgrounds, no stiff stock-photo smiling poses). Aim for something with a genuine point of view.',
    // Repeating the hard requirements at the very end too - instructions
    // near the end of a prompt tend to get weighted more heavily by image
    // models, so this is a deliberate second pass, not redundant filler.
    hasHardRequirements
      ? `Before finalizing: confirm the image reflects "${briefNote || purpose}"${mustInclude ? `, includes ${mustInclude}` : ''}${mustAvoid ? `, and avoids ${mustAvoid}` : ''}. These requirements matter more than the style notes above.`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * "Follow Brand Assets & Guidelines" unticked on Step 02: strips the brand
 * colour palette / analysed imagery style lines out of the image prompt and
 * tells the model it is free to choose colours and styling. (Brand asset
 * images are dropped separately - see resolveReferenceImages' followBrand.)
 */
/** Prompt line naming the brand's headline and body fonts (Look & feel). Empty when the brand has none saved. */
export function fontLines(fonts) {
  const display = String(fonts?.display || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const body = String(fonts?.body || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!display && !body) return [];
  const use = display && body
    ? `the headline in ${display} and any smaller supporting line in ${body}`
    : display ? `all text in ${display}` : `all text in ${body}`;
  return [`- Typography: set any text shown in this image in the brand's own fonts: ${use}. Do not substitute another typeface. This names the typeface only; it does not change the wording, layout or photography.`];
}

export function applyBrandPreference(prompt, followBrand = true) {
  if (followBrand !== false || !prompt) return prompt;
  const kept = String(prompt)
    .split('\n')
    .filter((l) => !/^\s*(Brand: |- Primary brand colors|- This brand's established imagery style|- Brand mood\/tone|- Brand guideline)/.test(l))
    .join('\n');
  // The photography direction is not brand identity, so it stays; say so, or the freedom line would contradict it.
  const keepsPhoto = /^\s*- Photography direction:/m.test(kept);
  const keepsFont = /^\s*- Typography: set any text/m.test(kept);
  return `${kept}\nBRAND FREEDOM: do not follow any brand colour palette, brand style guide or established brand look for this image, and do not depict or name any brand. Choose colours, mood and styling freely to best suit the brief and the creative direction.${keepsPhoto ? ' The photography direction above still applies to any people, products or ingredients shown.' : ''}${keepsFont ? ' The typography line above (the brand fonts) still applies to any text shown.' : ''}`;
}

const ANGLES = [
  'bold gradient background with a single hero product moment',
  'moody, editorial, high-contrast lighting',
  'bright, minimal, lots of white space',
  'dark premium tone with a subtle accent glow',
  'soft lifestyle scene, warm and human',
  'geometric, graphic-design led, no photography'
];

/**
 * Generates N copy/creative directions FAST - caption + computed image
 * brief per direction, no image generation call. This is the default
 * Step 02 entry point: pick and edit your copy direction first (cheap,
 * near-instant, freely iterable), then deliberately commission an image
 * for the one(s) you actually want - mirroring how a copywriter's
 * directions get signed off before an art director spends production time.
 *
 * @param {object} args
 * @param {Array<{filePath,mimeType,filename}>} [args.groundingImages] - brand
 *   assets / "include in design" references - the real product/logo/subject.
 * @param {Array<{filePath,mimeType,filename}>} [args.styleImages] - "style
 *   reference" creatives - match mood/treatment only, not literal subject.
 */
// Each direction is looked at through a different strategic lens, so the four cards are four different ideas,
// not four rewordings of the same line. The lenses are a starting point: they are adapted to the purpose and brief.
const DIRECTION_LENSES = [
  'PRODUCT / BENEFIT HERO - the clearest, most direct way to show the subject and the one benefit that matters most',
  'HUMAN & EMOTIONAL - the feeling, moment or situation the audience recognises themselves in; people or lifestyle led where the brief allows',
  'BOLD STATEMENT - a graphic, high-impact idea driven by one striking line and a simple, confident composition that stops the scroll',
  'UNEXPECTED ANGLE - a surprising visual metaphor, curiosity or contrast that makes people look twice, while still landing the message'
];

/**
 * Plans all the creative directions TOGETHER in one text call so they are genuinely different concepts
 * (separate calls each given the same key message all came back as the same sentence). Returns
 * [{ title, idea, visual, caption }] or null when the model's answer can't be used (the caller falls back to
 * the one-call-per-direction route).
 */
async function planDirectionConcepts({ count, purpose, medium, briefNote, user, textModel, creativeBrief = {}, followBrand = true, avoid = [], usageContext }) {
  const format = getFormat(medium);
  const b = creativeBrief || {};
  const brandOn = followBrand !== false;
  // Everything chosen about people on the Visual & style screen (how many, age, gender, ethnicity, how they appear, the note) reaches the directions.
  const people = b.peopleMode === 'none' ? 'No people in the creative.' : b.peopleMode === 'include' ? peopleDirection(b).replace(/^- /, '') : '';
  const lenses = Array.from({ length: count }, (_, i) => `${i + 1}. ${DIRECTION_LENSES[i % DIRECTION_LENSES.length]}`).join('\n');
  const prompt = [
    `Plan ${count} clearly DIFFERENT creative directions for one advertising creative.`,
    `Purpose: ${purpose}.`,
    `Placement: ${format.label} (${format.platform}, ${format.ratio} ${format.orientation}). Copy style notes: ${FORMAT_COPY_NOTES[format.id] || 'concise, concrete'}`,
    brandOn && user?.company?.name ? `Brand: ${user.company.name}${user?.company?.industry ? ` (${user.company.industry})` : ''}.` : '',
    briefNote ? `What the post is about (from the marketer): ${briefNote}` : '',
    ...(brandOn ? brandGuideLines(user?.brandKit, 'design').map((l) => `Brand guideline: ${l}`) : []),
    ...(photographyLines(user?.brandKit, { people: b.peopleMode === 'none' ? 'none' : 'auto', compact: true }).map((l) => `Photography direction: ${l}`)),
    b.primaryMessage ? `Core message every direction must land (in its own words and its own way, never the same sentence twice): ${b.primaryMessage}` : '',
    b.mustInclude ? `The image must include: ${b.mustInclude}` : '',
    b.mustAvoid ? `The image must avoid: ${b.mustAvoid}` : '',
    (b.moodTags || []).length ? `Chosen mood: ${b.moodTags.join(', ')}.` : '',
    (b.styleReferences || []).length ? `Chosen visual style references: ${b.styleReferences.join('; ')}.` : '',
    b.lightingStyle ? `Chosen lighting: ${b.lightingStyle}.` : '',
    b.compositionStyle ? `Chosen composition: ${b.compositionStyle}.` : '',
    people ? `${people} Every direction must show exactly these people (same number, age, gender and look), in a different scene each time.` : '',
    avoid.length ? `Directions already shown, do NOT repeat or echo any of them:\n${avoid.map((a) => `- ${a}`).join('\n')}` : '',
    '',
    `Give each direction a different lens:\n${lenses}`,
    'The directions must differ in the IDEA, the scene or setting, the composition and the tone of the copy. They must all respect the chosen mood, style, lighting and people settings above, so vary the concept and composition, not the look the marketer chose.',
    'For each direction write:',
    '- "title": a short concept name, 3-8 words, specific to this brief (not generic, not the key message repeated).',
    '- "idea": 1-2 sentences describing what the creative shows and says, so a marketer can picture it.',
    '- "visual": one sentence of art direction for an image model: subject, setting, composition, light, colour. Concrete and photographable. No text, hex codes or brand names to be drawn.',
    workspaceLanguage() ? `Language: write ONLY the "caption" in ${workspaceLanguage()} (native script, the way a fluent native copywriter would write it; no English version). The "title", "idea" and "visual" MUST be written in English, always, so the marketer can read them - never in ${workspaceLanguage()}.` : '',
    '- "caption": the post copy for this placement, in a different voice and opening line from the other directions. Concrete, no filler like "Discover the difference" or "Elevate your lifestyle", no hashtags unless the placement notes ask for them, no emoji unless the brand voice clearly calls for them, no quotation marks.',
    `Respond with ONLY a JSON array of exactly ${count} objects with the keys title, idea, visual, caption. No markdown fences, no commentary.`
  ].filter((l) => l !== '').join('\n');

  const { text, modelUsed } = await router.generateText({
    purpose: 'planning creative directions',
    model: textModel,
    // withLanguage:false - the workspace language rule would push the marketer-facing notes (title / idea / visual) into that language; only the caption follows it (see the Language line in the prompt).
    system: brandSystemPrompt({ user, industry: user?.company?.industry, followBrand, withLanguage: false }),
    prompt,
    maxTokens: 1800
  });
  logUsageSafely(usageContext, {
    type: 'text',
    provider: modelUsed,
    estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(String(text || '').length / 4) })
  });
  if (modelUsed === 'placeholder') return null;

  try {
    const cleaned = String(text || '').replace(/^```json|```$/gim, '').trim();
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('['), cleaned.lastIndexOf(']') + 1));
    const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const items = (Array.isArray(parsed) ? parsed : [])
      .map((o) => ({ title: clean(o?.title, 90), idea: clean(o?.idea, 300), visual: clean(o?.visual, 400), caption: String(o?.caption || '').trim().slice(0, 1500), modelUsed }))
      .filter((o) => o.title && o.visual && o.caption);
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (items.length < count || new Set(items.slice(0, count).map((o) => norm(o.title))).size < count) return null;
    return items.slice(0, count);
  } catch {
    return null;
  }
}

export async function generateCopyDirections({ purpose, mediums, briefNote, user, textModel = 'auto', creativeBrief = {}, groundingImages = [], styleImages = [], usageContext, variantCount, followBrand = true, onlyIndex, avoidConcepts = [] }) {
  const medium = mediums?.[0] || 'instagram_feed';
  // Creative Adaptation only ever needs one direction - you're reworking
  // one already-approved creative, not brainstorming a new campaign angle
  // from scratch, so the normal exploration would just be waste. New Creative always shows exactly four creative
  // directions (fixed; no longer driven by DESIGN_VARIANT_COUNT).
  const count = Math.min(variantCount || DEFAULT_DIRECTION_COUNT, VARIANT_LABELS.length);
  const textRotation = await resolveTextRotation(textModel);

  // Preferred route: one call plans every direction together so they differ in idea, scene and copy.
  let concepts = null;
  try {
    concepts = await planDirectionConcepts({ count, purpose, medium, briefNote, user, textModel: textRotation[0], creativeBrief, followBrand, avoid: avoidConcepts, usageContext });
  } catch (err) {
    console.warn('[directions] joint planning failed, using one call per direction:', err.message);
  }
  const hasTemplate = groundingImages.some((g) => g.role === 'template');

  const variants = concepts
    ? concepts.map((c, i) => {
        // internal concept notes feed the image prompt; they are never meant to be written on the image
        const angle = `${c.visual} Concept: ${c.title}${c.idea ? ` - ${c.idea}` : ''} (internal creative notes - never write this wording on the image)`;
        return {
          label: VARIANT_LABELS[i],
          angle,
          directionTitle: c.title,
          directionIdea: c.idea,
          caption: c.caption,
          imagePrompt: buildImagePrompt({ purpose, medium, briefNote, user, angle, creativeBrief, hasTemplateImages: hasTemplate, followBrand }),
          imageUrl: '',
          background: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length],
          textModel: c.modelUsed,
          imageModel: '',
          imageNote: ''
        };
      })
    : await Promise.all(
        Array.from({ length: count }, (_, i) => {
          const label = VARIANT_LABELS[i];
          const angle = ANGLES[i % ANGLES.length];
          const chosenTextModel = textRotation[i % textRotation.length];
          return generateCopyOnly({ label, angle, index: i, purpose, mediums, medium, briefNote, user, chosenTextModel, creativeBrief, groundingImages, styleImages, usageContext, followBrand });
        })
      );

  // regenerating ONE direction: hand back the one for that slot
  return Number.isInteger(onlyIndex) && onlyIndex >= 0 && onlyIndex < variants.length ? [variants[onlyIndex]] : variants;
}

async function generateCopyOnly({ label, angle, index, purpose, mediums, briefNote, medium, user, chosenTextModel, creativeBrief, groundingImages, styleImages, usageContext, followBrand }) {
  const { caption, modelUsed: captionModelUsed } = await generateCaption({
    purpose,
    mediums,
    briefNote: briefNote ? `${briefNote} (creative direction: ${angle})` : `Creative direction: ${angle}`,
    user,
    model: chosenTextModel,
    creativeBrief,
    usageContext,
    followBrand
  });

  const imagePrompt = buildImagePrompt({
    purpose,
    medium,
    briefNote,
    user,
    angle,
    creativeBrief,
    hasTemplateImages: groundingImages.some((g) => g.role === 'template'),
    followBrand
  });

  return {
    label,
    angle,
    caption,
    imagePrompt,
    imageUrl: '',
    background: FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length],
    textModel: captionModelUsed,
    imageModel: '',
    imageNote: ''
  };
}

/**
 * Ports an already-generated "master" creative to a different format
 * (different aspect ratio/platform) using AI. Unlike a fresh generation,
 * this sends the actual master image as a reference for the edit
 * endpoint and instructs the model to adapt/recompose it - same subject,
 * palette, lighting, and creative concept - rather than generating
 * something unrelated from scratch. This is what makes a set of
 * multi-platform posts look like one consistent campaign instead of
 * several independently generated images that happen to share a caption.
 */
export async function portImageToFormat({ masterImage, targetFormatId, imageModel = 'auto', qualityTier = 'high', usageContext, preserveText = false }) {
  const targetFormat = getFormat(targetFormatId);
  const exactPx = /^(\d+)x(\d+)$/i.exec(targetFormat.px || '');
  const targetW = exactPx ? Number(exactPx[1]) : 0;
  const targetH = exactPx ? Number(exactPx[2]) : 0;
  const cropRatio = exactPx ? `${targetW}:${targetH}` : targetFormat.ratio;
  const formatNote =
    targetFormat.adaptNote === 'safe'
      ? 'This is a very wide, thin banner: compose the main subject and every piece of text inside the central horizontal band, as the top and bottom edges may be trimmed. Use a clean horizontal layout with the subject and headline side by side, never stacked.'
      : targetFormat.adaptNote === 'billboard'
        ? 'This is a roadside billboard read at a glance from far away and at speed: one dominant subject, the headline in huge, bold, high-contrast type with 7 words or fewer, almost no other text, a clean uncluttered layout, and the key content kept well inside the central safe area because the outer edges are trimmed and bled.'
      : targetFormat.adaptNote === 'print'
        ? 'This is a print piece: keep generous safe margins from every edge, a clear visual hierarchy and large, highly legible type.'
        : '';

  const prompt = [
    `Adapt this exact creative for ${targetFormat.platform} ${targetFormat.label} (${targetFormat.ratio}${exactPx ? `, ${targetW} x ${targetH} px` : ''}, ${targetFormat.orientation}).`,
    formatNote,
    'This is the same campaign, not a new image - preserve the same subject, composition style, color palette, lighting, and overall creative concept exactly.',
    'Recompose or extend the framing to fill the new aspect ratio naturally (extend the background/scene as needed rather than stretching or cropping awkwardly).',
    'Make sure nothing important is cropped or cut off at any edge: every face, the product and its packaging, all text (every word and letter of the headline, bullet points and small print) and all logos must sit fully inside the frame with a comfortable margin from the edges. Re-position or re-scale these elements if needed to fit the new shape, and keep them inside the central safe area because the outermost edges may be trimmed slightly.',
    preserveText
      ? 'Keep every piece of text, logo and graphic that is already in the image exactly as it is - identical wording and spelling, fonts and colours - re-laid out within the new frame so nothing is cut off or overlapping. Do not invent, add or change any text, and do not add watermarks.'
      : 'Do not add any text, words, logos, or watermarks.'
  ].join(' ');

  const size = targetFormat.size;
  const quality = qualityTier === 'standard' ? 'medium' : 'high';
  const resolvedModel = await resolveImageModel(imageModel);
  const imageResult = await router.generateImage({ purpose: 'porting the design to another format', model: resolvedModel, prompt, size, quality, referenceImages: [masterImage] });

  if (!imageResult.placeholder) {
    let savedUrl = await saveGeneratedImage(imageResult, cropRatio);
    // Placements with an exact pixel size (banners, print, email...) are delivered at exactly that size.
    if (exactPx) {
      try {
        const filePath = resolveUploadPath(savedUrl);
        const resized = await sharp(filePath).resize(targetW, targetH, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
        const outName = `gen-${uuidv4()}.png`;
        fs.writeFileSync(path.join(uploadDir(), outName), resized);
        savedUrl = uploadUrl(outName);
      } catch (err) {
        console.warn('[portImageToFormat] exact-size resize failed, keeping generated size:', err.message);
      }
    }
    logUsageSafely(usageContext, {
      type: 'image',
      provider: imageResult.modelUsed,
      estimatedCostUsd: estimateImageCostUsdByProvider(imageResult.modelUsed, quality === 'high' ? 'high' : 'standard'),
      imageUrl: savedUrl
    });
    return { formatId: targetFormatId, imageUrl: savedUrl, imageModel: imageResult.modelUsed, imageNote: '' };
  }
  logUsageSafely(usageContext, { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
  return {
    formatId: targetFormatId,
    imageUrl: '',
    imageModel: 'placeholder',
    imageNote: imageResult.note || '',
    imageBillingUrl: imageResult.billingUrl || '',
    imageBillingProviderLabel: imageResult.billingProviderLabel || ''
  };
}

const COMPOSER_SYSTEM = [
  'You are the art director who writes the FINAL prompt for an advertising image model.',
  'You receive a working brief made of labelled parts: HARD REQUIREMENTS, STYLE DIRECTION (brand guidelines, photography direction, typography, mood, lighting, composition), the creative direction for this design and a visual approach for this option.',
  'Process all of it against the chosen direction and write ONE clean prompt the image model can follow without contradictions.',
  'Rules:',
  '1. Priority when parts conflict: hard requirements, then the creative direction and option approach, then photography direction, then brand style. Resolve each conflict in the prompt itself; never mention the conflict.',
  '2. Keep every hard fact exactly: the number, age, gender and look of people, products and labels, must-include and must-avoid items, colours (names or hex), the format and aspect ratio.',
  '2b. The wording of any headline or supporting line is supplied separately after your prompt. NEVER write, quote, paraphrase or invent headline, tagline or supporting-line wording, and drop any such wording found in the working brief. If fonts are named, say only which font the headline and which font the supporting line use. Never say a supporting line is optional.',
  '3. Use photography, lighting, mood and brand-style rules only where they fit what this design actually shows. Drop rules about things that are not in the scene (for example people rules when there are no people), and drop duplicates.',
  '4. Write it as a concrete photographable scene: subject, setting, composition, camera and lens feel, light, colour, mood, then any text and typography. Plain prose in a few short paragraphs. No bullet lists, no headings, no markdown.',
  '5. Do not mention reference images, attachments, templates or these instructions, and do not invent slogans, brand names or extra text.',
  '6. Maximum 320 words. Reply with the final prompt only.'
].join('\n');

/**
 * Reads the working brief (direction + photography md + brand lines) and writes the single final prompt that goes to the
 * image model. Any failure returns the original brief, so image generation never depends on this step.
 */
export async function composeFinalPrompt({ workingPrompt, usageContext, noText = false }) {
  try {
    const { text, modelUsed } = await router.generateText({ purpose: 'composing the final image prompt', system: noText ? `${COMPOSER_SYSTEM}\n7. NO TEXT IN THE IMAGE: the headline and supporting line are added afterwards by software. Do not mention fonts, typefaces, headlines, supporting lines, text, lettering or typography anywhere. Instead describe one generous, clean, calm area of the frame (about a third of it, ideally on the left or at the top, wherever the composition allows) left free of people, products and busy detail so text can sit there.` : `${COMPOSER_SYSTEM}\n7. TEXT PLACEMENT IS NOT YOURS TO SET: do not reserve, describe or mention any space, side, corner or position for the headline or supporting line (no "negative space for text", no "text on the left"). Compose the scene on its own merits; the image model decides where the text sits.`, prompt: `WORKING BRIEF:\n${workingPrompt}`, maxTokens: 700 });
    logUsageSafely(usageContext, {
      type: 'text',
      provider: modelUsed,
      estimatedCostUsd: modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(modelUsed, { inputTokens: Math.ceil(workingPrompt.length / 4), outputTokens: Math.ceil(String(text || '').length / 4) })
    });
    const out = String(text || '').replace(/^```[a-z]*|```$/gim, '').trim();
    if (modelUsed === 'placeholder' || out.length < 120 || out.length > 4000) return workingPrompt;
    return out;
  } catch {
    return workingPrompt;
  }
}

/**
 * Generates (or regenerates) the image for ONE variant, given an explicit
 * base prompt - typically the one computed during the copy phase, possibly
 * hand-edited by the user first ("art director" review before committing
 * to a paid generation call). Doesn't touch caption/copy at all.
 *
 * The reference-image instruction is appended fresh here (not baked into
 * the stored prompt) so it always reflects whatever reference creatives
 * exist right now, even if they were added/removed after copy was drafted.
 */
export async function generateImageForVariant({ imagePrompt, medium, imageModel = 'auto', qualityTier = 'high', groundingImages = [], styleImages = [], exactAssets = [], includeTypography = false, headlineText = '', subHeadlineText = '', templatePreservation = null, variantIndex = 0, usageContext, fonts = null }) {
  // Video-only formats (Reels, Shorts, TikTok, etc - see isVideo in
  // constants/postFormats.js) have no still-image size to generate against;
  // the actual creative for these is produced by the separate "Generate
  // video" action, which reads its aspect ratio/duration straight off this
  // same format. Skip the (would-be broken) image call entirely rather
  // than passing an undefined size to the image provider.
  if (isVideoFormat(medium)) {
    logUsageSafely(usageContext, { type: 'image', provider: 'skipped_video_format', estimatedCostUsd: 0 });
    return {
      imageUrl: '',
      background: FALLBACK_GRADIENTS[variantIndex % FALLBACK_GRADIENTS.length],
      imageModel: '',
      imageNote: `${getFormat(medium).label} is a video format - use "Generate video" below to produce the actual creative.`
    };
  }

  const layoutCount = styleImages.filter((s) => s.role === 'layout').length;
  const brandRefCount = styleImages.filter((s) => s.role === 'brand-reference').length;
  const referenceNote = referenceInstructionText({
    hasGroundingImages: groundingImages.length > 0,
    hasStyleImages: styleImages.length - layoutCount - brandRefCount > 0,
    hasLayoutImages: layoutCount > 0,
    hasBrandReferenceImages: brandRefCount > 0,
    hasExactAssets: exactAssets.some((a) => a.anchor !== 'center'),
    hasProductLock: exactAssets.some((a) => a.anchor === 'center'),
    hasTemplateImages: groundingImages.some((g) => g.role === 'template'),
    templatePreservation
  });
  // Primary headline unticked in "preserve" and no specific headline picked:
  // have the model write a fresh one from the brief/copy direction already in
  // imagePrompt, rather than baking in the original wording.
  const rewriteHeadline = templatePreservation?.preservePrimaryHeadline === false && !headlineText?.trim();
 // PRECISE FONT TEXT (per-customer switch): the image is made with no text and the headline / sub-headline are set afterwards in code,
  // with the exact brand font files. Only when we know the wording, the fonts can be found, and the text is Latin script.
  const drawsTextEarly = !groundingImages.some((g) => g.role === 'template') && !rewriteHeadline && includeTypography && Boolean(headlineText?.trim() || subHeadlineText?.trim());
  const precise = Boolean(getTenant()?.customer?.features?.preciseFontText) && drawsTextEarly && Boolean(fonts)
    && !hasNonLatinScript(headlineText, subHeadlineText)
    && (await canSetText(fonts, { headline: headlineText || '', subHeadline: subHeadlineText || '' }));
  const typographyNote = precise
    ? 'Do not render any text, words, letters, numbers, logos or watermarks anywhere in the image: the headline and supporting line are added afterwards by software. Leave one generous, clean, calm area free of people, products and busy detail for them (about a third of the frame, ideally on the left or at the top, wherever the composition allows) and compose the rest of the image around it.'
    : rewriteHeadline
    ? 'Render a NEW short headline (roughly 3-8 words) directly in the image, in the same position, size, and typographic style as the original headline in the reference image. Write it fresh from this brief and the creative direction above - do NOT reuse the original headline wording. Keep it bold and highly legible. Do not render any other new text or annotations beyond the elements marked as preserved above.'
    : typographyInstructionText({ includeTypography, headlineText, subHeadlineText });
  // The typography note above says things like "do not render any text" or "these two
  // lines are the ONLY text". For an adaptation that contradicts the preserve choices
  // (secondary text, small print, logo), and the model resolves it by deleting them.
  // Spell out that preserved elements are exempt.
  const hasTemplate = groundingImages.some((g) => g.role === 'template');
  const keepsSub = !(includeTypography && subHeadlineText?.trim());
  const keptText = hasTemplate && templatePreservation
    ? [
        keepsSub && templatePreservation.preserveSecondaryText !== false && 'the secondary text / tagline block',
        templatePreservation.preserveComplianceText !== false && 'the small print / legal text / QR code',
        templatePreservation.preserveLogo !== false && 'the logo lockup'
      ].filter(Boolean)
    : [];
  const keepNote = keptText.length
    ? `EXCEPTION to every "no text" / "only text" rule in this paragraph: ${keptText.join(', ')} from the reference are marked as preserved and MUST still appear in the new image, in the same position, size and typographic style as the reference (the secondary text may be reworded for the new brief, but it must not be removed). Preserved elements are never "extra" text.`
    : '';
  // Letters are being drawn into the image (and it is not an adaptation of a template, which already
  // carries its own lettering): give the model a specimen of the brand fonts to copy the letterforms from.
  const drawsText = !hasTemplate && (rewriteHeadline || (includeTypography && (headlineText?.trim() || subHeadlineText?.trim())));
  // Preferred: a proof of the real headline / sub-headline already set in the brand fonts. Fallback: the A-Z specimen sheet.
  const proofHeadline = includeTypography && !rewriteHeadline ? headlineText : '';
  const proofSub = includeTypography ? subHeadlineText : '';
  const proof = !precise && drawsText && fonts && (proofHeadline?.trim() || proofSub?.trim()) ? await fontProofFile(fonts, { headline: proofHeadline, subHeadline: proofSub }) : null;
  const specimen = proof || (!precise && drawsText && fonts ? await fontSpecimenFile(fonts) : null);
  const specimenNote = proof
    ? `The LAST reference image is a font proof: the exact headline (top, in the headline font) and supporting line (below, in the body font) of this design, already set in the brand fonts on a plain white sheet. Copy it as a typesetting master: the same letterforms (stroke weight, proportions, serifs, tails and terminals, spacing) and the same wording. The line breaks and text size may differ from the proof when the layout needs it, so choose whatever suits the composition, but never change a letterform or a character. Use it ONLY as a guide to the lettering: never copy its white background or layout, never place the sheet or a copy of it in the design, and never draw any text twice.`
    : specimen
    ? 'The LAST reference image is a type specimen of the brand fonts on a plain white sheet: the headline font on top and the body font below, each showing the full alphabet in capitals and lower case, the numbers and the punctuation marks. Draw the HEADLINE in the top font and the SUPPORTING LINE in the lower font, taking every letter, number and punctuation mark from these exact letterforms: same stroke weight, proportions, widths, serifs, tails, terminals, counters and spacing. Look each character up in the specimen before drawing it. Use it ONLY as a font guide: never copy its layout, never render the specimen characters themselves, never place the sheet or a copy of it in the design, and never let its white background appear in the design.'
    : '';
  // Lettering fidelity: whenever letters are drawn, forbid bleeding / softness and make the model match every glyph exactly,
  const fidelityNote = drawsText && !precise
    ? `LETTERING FIDELITY: draw each letter as its own clean, crisp, solid shape with sharp edges and no font bleeding: no smearing, glow, halo, ghosting, double edges, melting into the background, warping, stretching or uneven stroke thickness, and no letter merging into the next one. Match the brand font exactly, glyph by glyph, as in the supplied font reference: same stroke weight, contrast, curve shapes, terminals and spacing in every letter, with no substitution by a similar-looking font and no invented letterforms. Hold EVERY character to the same standard, not just a few: each capital and lower-case letter, every number, and every piece of punctuation (full stops, commas, hyphens, apostrophes, ampersands) must match the font reference in shape, stroke weight, width, height, slant, serifs or terminals, curve and counter (the enclosed space in letters like a, b, d, e, g, o, p, q, R, B), tail and join (letters like Q, y, g, j, J, R, G, a, t, f), and in the spacing and alignment on the baseline. Same letter, same shape, every time it appears: a repeated letter must look identical to the other copies, with no variation, no swapped alternative forms and no look-alike substitute. Spell every word exactly as written, with every letter present and in order.`
    : '';
  // Template adaptations keep their stitched prompt (the template fixes what is shown); every other design gets one composed prompt.
  const mainPrompt = hasTemplate ? imagePrompt : await composeFinalPrompt({ workingPrompt: imagePrompt, usageContext, noText: precise });
  // STRICT TEXT RULES: whenever the model draws the exact headline / sub-headline itself (not a template adaptation, not a freshly written headline).
  const strictText = drawsText && !precise && !hasTemplate && !rewriteHeadline && Boolean(proofHeadline?.trim() || proofSub?.trim());
  const strictNote = strictText
    ? strictTextRules({ headline: proofHeadline || '', subHeadline: proofSub || '' })
    : '';
  const finalPrompt = [mainPrompt, referenceNote, typographyNote, specimenNote, fidelityNote, strictNote, keepNote].filter(Boolean).join(' ');

  const size = getFormat(medium).size;
  const quality = qualityTier === 'standard' ? 'medium' : 'high';
  // "Exact" assets are deliberately excluded here - they're never sent to
  // the AI model to be reinterpreted, only composited pixel-for-pixel onto
  // the finished image afterward. See compositeExactAssets.js.
  const referenceImages = [...groundingImages, ...styleImages, ...(specimen ? [specimen] : [])];
  const resolvedModel = await resolveImageModel(imageModel);
  const imageResult = await router.generateImage({ purpose: 'generating the design image', model: resolvedModel, prompt: finalPrompt, size, quality, referenceImages });

  if (!imageResult.placeholder) {
    let savedUrl = await saveGeneratedImage(imageResult, getFormat(medium).ratio);
    if (exactAssets.length) {
      savedUrl = await compositeExactAssets(savedUrl, exactAssets);
    }
    let imageNote = '';
    if (precise) {
      // The AI looks at the finished image and decides where the text goes and how big it is; the server then sets the real fonts there.
      try {
        const file = resolveUploadPath(savedUrl);
        const { layout, usage } = await planTextLayout({ buffer: fs.readFileSync(file), headline: headlineText || '', subHeadline: subHeadlineText || '' });
        if (usage) {
          logUsageSafely(usageContext, {
            type: 'text',
            provider: usage.modelUsed,
            estimatedCostUsd: usage.modelUsed === 'placeholder' ? 0 : estimateTextCostUsdByProvider(usage.modelUsed, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
          });
        }
        await overlayText({ filePath: file, headline: headlineText || '', subHeadline: subHeadlineText || '', fonts, layout });
      } catch (err) {
        console.warn('[precise-text] could not add the text:', err.message);
        imageNote = 'The image was made, but the headline text could not be added to it. Please try again.';
      }
    }
    logUsageSafely(usageContext, {
      type: 'image',
      provider: imageResult.modelUsed,
      estimatedCostUsd: estimateImageCostUsdByProvider(imageResult.modelUsed, quality === 'high' ? 'high' : 'standard'),
      imageUrl: savedUrl
    });
    return {
      imageUrl: savedUrl,
      background: '',
      imageModel: imageResult.modelUsed,
      imageNote
    };
  }
  logUsageSafely(usageContext, { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
  return {
    imageUrl: '',
    background: FALLBACK_GRADIENTS[variantIndex % FALLBACK_GRADIENTS.length],
    imageModel: 'placeholder',
    imageNote: imageResult.note || '',
    imageBillingUrl: imageResult.billingUrl || '',
    imageBillingProviderLabel: imageResult.billingProviderLabel || ''
  };
}

// Distinct visual approaches for the "3 options" step - deliberately
// different from each other (not just re-rolls) so picking one is a real
// creative decision, mirroring an art director presenting a few genuinely
// different directions rather than minor variations of the same idea.
const IMAGE_OPTION_STYLES = [
  'a product/subject-forward hero shot, clean and direct',
  'an editorial lifestyle scene with human context and atmosphere',
  'a bold graphic/typographic-led treatment, less literal and more conceptual'
];

// How many of the approaches above a creative generates is a per-customer setting (Customer.features.designOptions: 1, 2 or 3; the agency
// sets it when creating or editing a customer). One = the first approach only (a clean product/subject-forward hero shot).
export const IMAGE_OPTION_MAX = IMAGE_OPTION_STYLES.length;
export const clampOptionCount = (n) => Math.min(Math.max(Math.trunc(Number(n)) || 1, 1), IMAGE_OPTION_MAX);

// "Regenerate designs": round 0 is the first set (the styles above). Every later round swaps each slot to a different
// approach of the same kind and adds a different framing, so a regenerated set does not repeat the visuals before it.
const IMAGE_OPTION_ALTERNATES = [
  [
    'a close-up, detail-led product shot with shallow depth of field and a tight crop',
    'a product placed in a styled set with props, shot from a different angle than a plain front view',
    'a dynamic, off-centre hero composition with the product large and a lot of negative space'
  ],
  [
    'a candid, in-the-moment lifestyle scene in natural light with a different setting',
    'a quiet, aspirational scene with a warm, golden-hour mood and generous depth',
    'a bright, airy lifestyle moment with a clean, uncluttered environment'
  ],
  [
    'a bold, colour-blocked graphic layout with strong shapes and a simplified background',
    'a conceptual, metaphor-led visual that suggests the idea rather than showing it literally',
    'a layered collage-style composition with graphic elements and clear visual hierarchy'
  ]
];
const FRAMING_TWISTS = [
  'Use a clearly different camera angle and framing from a typical front-on shot (for example low angle, three-quarter, top-down or tight crop).',
  'Choose a different setting, surface and background from the obvious one, with a different colour mood in the surroundings.',
  'Use different lighting (direction, softness, time of day) and a different overall colour treatment of the scene.',
  'Place the main subject differently in the frame (off-centre, larger or smaller) with a different amount of empty space.'
];
function optionStyleFor(styleIndex, round) {
  const base = IMAGE_OPTION_STYLES[styleIndex % IMAGE_OPTION_STYLES.length];
  if (!round) return { style: base, twist: '' };
  const pool = IMAGE_OPTION_ALTERNATES[styleIndex % IMAGE_OPTION_ALTERNATES.length] || [];
  return {
    style: pool.length ? pool[(round - 1) % pool.length] : base,
    twist: FRAMING_TWISTS[(round + styleIndex) % FRAMING_TWISTS.length]
  };
}

// Placeholder rows written immediately (before any generation call) so the
// grid can render 3 "generating…" slots right away - see
// initVariantImageOptions in posts.controller.js. Each is then overwritten
// in place, independently, as its own generation finishes - see
// generateSingleImageOption below - rather than the whole grid staying
// blank until all 3 happen to finish together.
export function pendingImageOptionsPlaceholder(count = 1) {
  return IMAGE_OPTION_STYLES.slice(0, clampOptionCount(count)).map((_, i) => ({
    imageUrl: '',
    background: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length],
    imageModel: 'pending',
    imageNote: 'Generating…',
    imagePrompt: ''
  }));
}

/**
 * Generates 3 distinct image options for one already-chosen copy direction.
 * Takes the (possibly hand-edited) base image prompt and produces 3
 * variations on it, run concurrently.
 *
 * Kept for reference/potential batch use, but the controller now calls
 * generateSingleImageOption three times independently instead of this, so
 * each option can be written to the post - and shown in the UI - the
 * moment it finishes, rather than all 3 being gated on the slowest one.
 */
export async function generateImageOptionsForVariant({ count = 1, imagePrompt, medium, imageModel = 'auto', qualityTier = 'high', groundingImages = [], styleImages = [], exactAssets = [], includeTypography = false, headlineText = '', subHeadlineText = '', templatePreservation = null, usageContext, fonts = null }) {
  return Promise.all(
    IMAGE_OPTION_STYLES.slice(0, clampOptionCount(count)).map((_, i) =>
      generateSingleImageOption({ imagePrompt, medium, styleIndex: i, imageModel, qualityTier, groundingImages, styleImages, exactAssets, includeTypography, headlineText, subHeadlineText, templatePreservation, usageContext, fonts })
    )
  );
}

/**
 * Generates exactly one of the 3 image options, by index - the building
 * block generateImageOptionsForVariant now delegates to, and what the
 * single-option controller endpoint calls directly so each option can be
 * persisted and surfaced to the client independently of the other two.
 */
export async function generateSingleImageOption({ imagePrompt, medium, styleIndex = 0, imageModel = 'auto', qualityTier = 'high', groundingImages = [], styleImages = [], exactAssets = [], includeTypography = false, headlineText = '', subHeadlineText = '', templatePreservation = null, usageContext, round = 0, fonts = null }) {
  const { style: pickedStyle, twist } = optionStyleFor(styleIndex, round);
  const style = twist ? `${pickedStyle}. This is a regenerated set, so it must look clearly different from the earlier sets of this design: ${twist} Do not change the product, its packaging, labels or colours, or any text that is specified.` : pickedStyle;
  // With a template attached, the per-option "visual approach" must not repaint what the
  // person ticked to preserve (e.g. the background) - it only shapes what is allowed to change.
  const hasTemplate = groundingImages.some((g) => g.role === 'template');
  const variantPrompt = hasTemplate
    ? `${imagePrompt} Visual approach for this option, applied ONLY to elements that are not marked as preserved (never to the preserved background, subject, logo or layout): ${style}.`
    : `${imagePrompt} Specific visual approach for this option: ${style}.`;
  const result = await generateImageForVariant({
    imagePrompt: variantPrompt,
    medium,
    imageModel,
    qualityTier,
    groundingImages,
    styleImages,
    exactAssets,
    includeTypography,
    headlineText,
    subHeadlineText,
    templatePreservation,
    variantIndex: styleIndex,
    usageContext,
    fonts
  });
  return { ...result, imagePrompt: variantPrompt };
}

/**
 * Generates N full design directions (copy + image together) in one pass.
 * Kept for the optional "generate everything at once" bulk path - the
 * default flow now is generateCopyDirections() followed by deliberate
 * per-variant generateImageForVariant() calls, but some users will just
 * want the old all-at-once behavior back.
 */
/**
 * Generates N full design directions (copy + image together) in one pass.
 * Kept for the optional "generate everything at once" bulk path - the
 * default flow now is generateCopyDirections() followed by deliberate
 * per-variant generateImageForVariant() calls, but some users will just
 * want the old all-at-once behavior back.
 */
export async function generateDesignVariants({ purpose, mediums, briefNote, user, textModel = 'auto', imageModel = 'auto', creativeBrief = {}, groundingImages = [], styleImages = [], exactAssets = [], usageContext, variantCount, followBrand = true, onlyIndex, avoidConcepts }) {
  const medium = mediums?.[0] || 'instagram_feed';
  const copyOnly = await generateCopyDirections({ purpose, mediums, briefNote, user, textModel, creativeBrief, groundingImages, styleImages, usageContext, variantCount, followBrand, onlyIndex, avoidConcepts });

  return Promise.all(
    copyOnly.map(async (variant, i) => {
      const imageResult = await generateImageForVariant({
        imagePrompt: variant.imagePrompt,
        medium,
        imageModel,
        qualityTier: creativeBrief?.qualityTier,
        groundingImages,
        styleImages,
        exactAssets,
        includeTypography: creativeBrief?.includeTypography,
        headlineText: creativeBrief?.headlineText,
        subHeadlineText: creativeBrief?.subHeadlineText,
        templatePreservation: creativeBrief?.templatePreservation,
        variantIndex: i,
        usageContext
      });
      return { ...variant, ...imageResult };
    })
  );
}

// Each slide gets a distinct narrative role so a carousel reads as a
// coherent swipe-through sequence rather than N disconnected images - the
// same instinct a human designer would apply to a carousel ad. Cycles if
// slideCount exceeds the list (e.g. a 10-slide carousel repeats the cycle
// with a different literal slide number each time, which still reads fine
// since the underlying subject/prompt varies per slide anyway).
const CAROUSEL_SLIDE_ROLES = [
  'Hook - the attention-grabbing opening frame that states the core idea boldly, designed to make someone stop scrolling',
  'Context - sets up the problem, question, or situation the audience relates to',
  'Detail - a supporting feature, benefit, or close-up detail shot',
  'Proof - a result, social-proof-style moment, or before/after feel',
  'Call to action - the closing frame with a clear next step (e.g. "Shop now", "Learn more", "Swipe back to save this")'
];

/**
 * Generates the ordered set of slide images for a carousel-type format
 * (Instagram/Facebook/LinkedIn carousel, or an X multi-image post) - each
 * slide shares the same underlying creative prompt/brand style but gets a
 * distinct narrative role, generated concurrently like generateImageOptionsForVariant.
 * @returns {Promise<Array>} slides in order, each with an `index` field
 */
export async function generateCarouselForVariant({
  imagePrompt,
  medium,
  imageModel = 'auto',
  qualityTier = 'high',
  groundingImages = [],
  styleImages = [],
  exactAssets = [],
  slideCount = 5,
  templatePreservation = null,
  usageContext
}) {
  const format = getFormat(medium);
  const count = Math.min(Math.max(Number(slideCount) || 5, format.minSlides || 2), format.maxSlides || 10);

  const slides = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const role = CAROUSEL_SLIDE_ROLES[i % CAROUSEL_SLIDE_ROLES.length];
      const slidePrompt = `${imagePrompt} This is slide ${i + 1} of ${count} in a ${format.notSwipeable ? 'multi-image' : 'swipeable carousel'} post - keep the same subject, visual style, color palette, and lighting consistent with the rest of the set, but vary the composition per this slide's specific role. This slide's role: ${role}.`;

      const result = await generateImageForVariant({
        imagePrompt: slidePrompt,
        medium,
        imageModel,
        qualityTier,
        groundingImages,
        styleImages,
        exactAssets,
        includeTypography: false,
        headlineText: '',
        templatePreservation,
        variantIndex: i,
        usageContext
      });

      return {
        index: i,
        slideRole: role.split(' - ')[0],
        imageUrl: result.imageUrl,
        imagePrompt: slidePrompt,
        imageModel: result.imageModel,
        imageNote: result.imageNote || '',
        imageBillingUrl: result.imageBillingUrl || '',
        imageBillingProviderLabel: result.imageBillingProviderLabel || ''
      };
    })
  );

  return slides;
}

// ---------------------------------------------------------------------------
// Fine adjustment / "Fix an area" - masked touch-ups to an existing image
// ---------------------------------------------------------------------------

// Frontend annotation convention (see RegionAnnotator.jsx): the mask PNG the
// browser sends has the brushed/marked area fully OPAQUE (any color) and
// everywhere else fully TRANSPARENT (alpha 0) - i.e. "painted = this is the
// area to change". That's the intuitive way to draw a mask, but it's the
// exact inverse of OpenAI's images.edit contract, where a mask's
// TRANSPARENT pixels are what gets regenerated and opaque pixels are
// preserved untouched. This resizes the incoming mask to the real image's
// pixel dimensions (the browser canvas is very unlikely to be a 1:1 match)
// and inverts the alpha channel to convert one convention to the other.
async function buildOpenAiMask(maskBuffer, width, height) {
  const { data, info } = await sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255 - data[i];
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

// Fallback for providers with no real masked-edit endpoint (anything but
// OpenAI, currently): burns a translucent red highlight over the marked
// region directly onto a copy of the base image, then that composited
// image is sent as the sole reference for a normal generateImage call with
// a prompt telling the model the highlight marks the only area to touch.
// This is a best-effort textual instruction, not a pixel-level guarantee
// the way a real mask is - the model can still drift outside the
// highlighted area - so OpenAI's real mask path above is always preferred
// when OpenAI is configured.
async function buildHighlightOverlayFile(imagePath, maskBuffer) {
  const base = sharp(imagePath);
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error('Could not read the base image to highlight.');

  const { data, info } = await sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const redLayer = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    redLayer[i] = 255;
    redLayer[i + 1] = 0;
    redLayer[i + 2] = 40;
    // Small alpha threshold so faint brush-edge anti-aliasing from the
    // canvas doesn't tint pixels just outside where the person actually drew.
    redLayer[i + 3] = data[i + 3] > 25 ? 150 : 0;
  }

  const redPng = await sharp(redLayer, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();

  const outPath = path.join(uploadDir(), `tmp-highlight-${uuidv4()}.png`);
  await sharp(imagePath).composite([{ input: redPng, blend: 'over' }]).toFile(outPath);
  return outPath;
}

/**
 * Applies a targeted, marked-area-only touch-up to an already-generated
 * image - the "Fix an area" tool. Unlike modifyImage's "prompt" method
 * (which regenerates the WHOLE image from the original brief prompt plus
 * extra direction, and can drift anywhere), this takes the actual current
 * image as its base and a mask marking exactly what to change, so the rest
 * of the image is meant to come back pixel-for-pixel (or as close as the
 * provider allows) identical - fixing one blemish, typo, or awkward detail
 * without re-rolling the whole creative.
 *
 * @param {{imagePath: string, maskBuffer: Buffer, instruction: string, imageModel?: string, size?: string, usageContext?: object}} args
 */
export async function refineImageRegion({ imagePath, maskBuffer, instruction, imageModel = 'auto', size = '1024x1536', usageContext }) {
  const prompt =
    `Make the following targeted change ONLY within the marked/masked region of the attached image - everything outside that region must come back exactly as it already is (same subject, framing, lighting, colors, composition, and any text/logo elements untouched): ${instruction.trim()} ${ruleTexts(['imageProductColour', 'imageNoMonochrome'])}`;

  // OpenAI is the only provider wired up here with a real masked-edit
  // endpoint (images.edit with image+mask), so it's preferred for this
  // specific tool whenever configured, regardless of the admin's general
  // image-model priority for whole-image generation - a surgical fix
  // benefits far more from true inpainting than from whichever provider
  // happens to be first in line for fresh creative generation.
  if (openaiProvider.isConfigured()) {
    try {
      const { width, height } = await sharp(imagePath).metadata();
      const openAiMask = await buildOpenAiMask(maskBuffer, width, height);
      const { b64, mimeType, usage } = await openaiProvider.editImageWithMask({ imagePath, maskBuffer: openAiMask, prompt, size });
      // No black-and-white result when the source is in colour (falls through to the other path below).
      if (await isMonochromeOutput(b64, [{ filePath: imagePath }])) throw new Error('the edit came back black-and-white');
      const savedUrl = await saveGeneratedImage({ b64, mimeType });
      logUsageSafely(usageContext, {
        type: 'image',
        provider: 'openai',
        estimatedCostUsd: usage ? openaiImageCostFromUsage(usage) : estimateImageCostUsdByProvider('openai', 'high'),
        ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, tokensEstimated: false } : {}),
        imageUrl: savedUrl
      });
      return { placeholder: false, imageUrl: savedUrl, imageModel: 'openai' };
    } catch (err) {
      console.warn('[refineImageRegion] OpenAI masked edit failed, falling back to highlight-overlay:', err.message);
    }
  }

  // Fallback path - any other configured provider, via a highlighted
  // reference image and a plain generateImage call rather than a real mask.
  let overlayPath;
  try {
    overlayPath = await buildHighlightOverlayFile(imagePath, maskBuffer);
    const fallbackPrompt = `${prompt} The semi-transparent red highlight overlaid on the attached reference image marks exactly which area to change - it is not part of the actual creative and must not appear in your output; treat it purely as a pointer to the edit region.`;
    const result = await router.generateImage({
      purpose: 'editing the selected area of the image',
      model: imageModel,
      prompt: fallbackPrompt,
      size,
      quality: 'high',
      referenceImages: [{ filePath: overlayPath, mimeType: 'image/png', filename: 'highlight.png' }]
    });

    if (result.placeholder) {
      logUsageSafely(usageContext, { type: 'image', provider: 'placeholder', estimatedCostUsd: 0 });
      return {
        placeholder: true,
        note: result.note || '',
        isBillingError: Boolean(result.isBillingError),
        billingUrl: result.billingUrl || null,
        billingProviderLabel: result.billingProviderLabel || null
      };
    }

    const savedUrl = await saveGeneratedImage(result);
    logUsageSafely(usageContext, {
      type: 'image',
      provider: result.modelUsed,
      estimatedCostUsd: estimateImageCostUsdByProvider(result.modelUsed, 'high'),
      imageUrl: savedUrl
    });
    return { placeholder: false, imageUrl: savedUrl, imageModel: result.modelUsed };
  } finally {
    if (overlayPath) fs.unlink(overlayPath, () => {});
  }
}

// ---------------------------------------------------------------------------
// Video generation prompts - animating the approved key visual vs a fresh scene
// ---------------------------------------------------------------------------

const MOTION_STYLE_INSTRUCTIONS = {
  ambient:
    'Apply only very subtle, slow ambient motion - gentle parallax between foreground and background, soft environmental movement (light flicker, fabric, hair, water, or leaves drifting slightly, subtle atmospheric particles). The camera itself stays essentially still; nothing should look CGI-animated or artificial.',
  zoom_in: 'A slow, smooth, steady cinematic zoom IN toward the main subject. No camera shake, no jump cuts.',
  zoom_out: 'A slow, smooth, steady cinematic zoom OUT from the main subject, revealing more of the scene. No camera shake, no jump cuts.',
  pan: 'A slow, smooth, steady horizontal camera pan across the scene. No camera shake, no jump cuts.'
};

/**
 * Builds the prompt for a video generation job, in one of two modes:
 *
 * - "animate_kv" (the default whenever a variant already has an approved
 *   image): the video provider is given that exact image as its reference
 *   (see imagePath handling in videoRouter.js/the provider files) and this
 *   prompt describes ONLY the requested camera/motion treatment plus a set
 *   of brand-safety guardrails - it deliberately does NOT re-describe the
 *   scene, since the image already IS the scene. This is the mode an
 *   agency actually wants for a finished, client-approved creative: the
 *   video should look like "the ad, but moving," not a fresh AI
 *   reinterpretation that might drift from what was signed off. It
 *   explicitly protects logos, compliance/legal text, prices and other
 *   on-screen graphics from being warped or animated, since that's exactly
 *   the kind of regulated content agencies in real estate, finance,
 *   pharma etc. cannot risk - see the MahaRERA-style compliance blocks
 *   template creatives often carry.
 * - "new_scene": the previous/default behavior - a video generated purely
 *   from the copy's text prompt, free to depict a different scene than the
 *   still image. Useful when the person genuinely wants a distinct video
 *   idea rather than a moving version of the approved stills.
 */
// See ALLOW_TEXT_ANIMATION in videoIdeasService.js - keep the two in step.
const ALLOW_TEXT_ANIMATION = false; // text animation only when explicitly requested - see textMotionRequested below

// Video guardrails (keep text, labels and product still) are edited under Admin -> AI Settings -> Blanket instructions.

/** A hand-edited video prompt always keeps the "keep text/labels/product still" rule (narrowed when text motion was chosen). */
export function ensureVideoGuardrails(prompt, { allowTextMotion = false } = {}) {
  const p = String(prompt || '').trim();
  const guard = ruleText(allowTextMotion ? 'videoGuardrailTextMotion' : 'videoGuardrail');
  if (!guard) return p;
  return /\bCRITICAL:/.test(p) || p.includes(guard.slice(0, 40)) ? p : `${p} ${guard}`.trim();
}

/**
 * Follow-up feedback on a previous video ("slower", "no zoom", "keep the bottle still").
 * `feedback` = the new note, `earlier` = notes from previous regenerations that must still hold.
 * Appended after the base prompt so the model treats it as the latest, highest-priority change request.
 */
export function applyVideoFeedback(prompt, feedback = '', earlier = []) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const now = clean(feedback);
  const before = (earlier || []).map(clean).filter((t) => t && t !== now);
  if (!now && !before.length) return prompt;
  const parts = [];
  if (before.length) parts.push(`Earlier feedback that still applies: ${before.map((t, i) => `(${i + 1}) ${t}`).join(' ')}`);
  if (now) parts.push(`Latest feedback on the previous version of this video - follow it closely and keep every point in mind: ${now}`);
  return `${prompt} ${parts.join(' ')}`.trim();
}

export function buildVideoPrompt({ mode = 'animate_kv', basePrompt, motionStyle = 'ambient', platformNote = '', ideas = [], customDirection = '', textMotionRequested = false }) {
  // Ideas the person ticked in the "animation ideas" picker (see
  // videoIdeasService.js) replace the single preset motion style: each idea's
  // own videoPrompt is combined into one continuous-shot direction.
  const chosenIdeas = (ideas || []).filter((i) => i?.videoPrompt && (ALLOW_TEXT_ANIMATION || (i.category !== 'text' && !i.touchesText)));
  const ideaDirection = chosenIdeas.length
    ? `Combine ALL of the following motion directions together naturally in one continuous shot: ${chosenIdeas.map((i, n) => `(${n + 1}) ${i.videoPrompt}`).join(' ')}`
    : '';
  const customLine = customDirection ? `Additional direction from the art director: ${customDirection}` : '';
  // When text/super animations were ticked, the blanket "all text stays
  // static" guardrail below is narrowed: only the specific text motions the
  // person chose are allowed, and regulated/brand elements stay locked.
  const hasTextIdeas = textMotionRequested || chosenIdeas.some((i) => i.category === 'text');

  if (mode === 'new_scene') {
    return [basePrompt, ideaDirection, customLine, platformNote].filter(Boolean).join(' ');
  }

  const motion = ideaDirection || MOTION_STYLE_INSTRUCTIONS[motionStyle] || MOTION_STYLE_INSTRUCTIONS.ambient;
  return [
    'Animate the attached image exactly as shown - this is an already-approved final ad creative, not a scene to reinterpret.',
    'Do not alter, redesign, restyle, or reinterpret the composition, subject, product, background, or color grading in any way.',
    motion,
    customLine,
    hasTextIdeas
      ? 'CRITICAL: any logo, brand mark, QR code, registration number, compliance disclaimer, legal text, or price must stay perfectly sharp, fully legible, and completely static the entire time - never warp, blur, distort, animate, or move them, even slightly. The ONLY on-screen text allowed to move is the headline/super/tagline/call-to-action motion explicitly requested above; that text must keep its exact wording and spelling, with no garbled, morphing, or extra letters, and be perfectly sharp and legible whenever it is on screen.'
      : `${ruleText('videoGuardrail')} Apply motion only where it will not compromise the legibility or integrity of the brand, product and text elements.`,
    platformNote
  ]
    .filter(Boolean)
    .join(' ');
}
