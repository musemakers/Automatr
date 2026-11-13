// CUSTOM FEATURES ("Brief Studio")
//
// A super admin (agency admin) writes a plain-English brief, e.g. "Olivia Cosmetics needs a before &
// after creative from one product shot". The AI turns it into a SPEC:
//
//   fields       the form people fill in (text, dropdowns, toggles, image uploads ...)
//   steps        one entry per image that has to be generated, each with its own prompt template that
//                uses {{fieldKey}} placeholders. A step can use uploaded images and/or the result of an
//                earlier step as reference (e.g. "after" is generated from the "before").
//   composition  how the generated images become the FINAL creative (side by side with Before / After
//                labels, stacked, grid, or just the last image). Labels and the disclaimer are added by
//                code, never drawn by the image model, so they can never come out garbled.
//
// The spec is validated and cleaned here (whitelists + limits) whether it came from the AI or was edited
// by hand, so a bad spec can never reach the image models or the form renderer.

export const FIELD_TYPES = ['text', 'textarea', 'select', 'multiselect', 'number', 'toggle', 'image'];
export const SIZES = {
  square: { size: '1024x1024', ratio: '1:1', label: 'Square' },
  portrait: { size: '1024x1536', ratio: '2:3', label: 'Portrait' },
  landscape: { size: '1536x1024', ratio: '3:2', label: 'Landscape' }
};
export const COMPOSITION_MODES = ['none', 'side_by_side', 'stacked', 'grid'];
export const BACKGROUNDS = ['light', 'dark'];

export const LIMITS = {
  fields: 16,
  steps: 6,
  options: 12,
  variants: 3,
  imageFiles: 4,
  promptChars: 2600,
  labelChars: 60,
  textInput: 600,
  textareaInput: 1500
};

// Appended to every step prompt at GENERATION time only (never stored inside the saved prompt template).
// The router adds the full-canvas and colour-integrity rules on top (see services/ai/router.js).
export const CUSTOM_STEP_GUARD =
  'Absolutely no text, letters, numbers, captions, logos, watermarks, labels or UI overlays anywhere in the image, except what is already printed on a supplied product reference. ' +
  'Any product, pack, bottle or label that comes from a reference image keeps its exact shape, colours, printing and label; never redraw, alter, re-letter or invent packaging text. ' +
  'Realistic, natural-looking people and objects: correct anatomy and hands, no distortions, no extra items.';

export const VARIANT_HINT = (i, n) =>
  `This is option ${i + 1} of ${n}: make it a clearly different take (pose, angle, framing or setting details) while still following every instruction above.`;

// System prompt for the model that designs a spec from the brief.
export const SPEC_SYSTEM_PROMPT = `You design "custom creative features" for an ad-creative platform used by a marketing agency. An admin gives you a brief for ONE client need. You turn it into a JSON spec that the platform renders as a form, then runs through an image-generation model.

Return ONLY one JSON object, no markdown, no commentary, in exactly this shape:
{
  "name": "short feature name (max 40 chars)",
  "description": "one sentence shown to the person using it (max 160 chars)",
  "icon": "one emoji",
  "output": "image|video",
  "productDriven": false,
  "fields": [
    { "key": "camelCaseKey", "label": "Field label", "type": "text|textarea|select|multiselect|number|toggle|image",
      "required": true, "help": "short helper text", "placeholder": "optional",
      "options": [{"value":"x","label":"X"}],
      "default": "optional", "min": 0, "max": 10, "maxFiles": 1 }
  ],
  "steps": [
    { "key": "camelCaseKey", "label": "Name of the output",
      "prompt": "Complete prompt for the ONE output. Insert form values with {{fieldKey}}.",
      "imageInputs": ["keys of image fields to pass as reference"],
      "aspect": "square|portrait|landscape", "seconds": 5 }
  ]
}
"steps" ALWAYS contains exactly ONE entry: the final output is always a single image or a single video. "seconds" (5 or 10) is only for video.

RULES
- Fields: 3 to 9. Only ask for what the brief needs. Prefer select / multiselect with sensible options over free text. If the brief involves a product that the customer supplies, the FIRST field is an image field with key "productImage" (required); when a reference analysis says no product is shown, do not add one. Select options must have 2 to 8 entries with plain-English labels. Give every select a sensible default value.
- The form is shown to the customer exactly as you design it, so think about every input the person must supply. Images first: the product photo ("productImage"), and, when people appear in the creative, an OPTIONAL image field "Model reference photo" (key "modelImage") so they can supply a specific model, plus plain select fields (age group, skin tone, look) used when no model photo is given. Add other image fields (logo is NOT one - logos are added elsewhere) only when the brief truly needs them. Put every image field in the relevant step's "imageInputs"; an optional image that is not supplied is simply skipped, so the prompt must still make sense without it.
- Field labels are plain, customer-friendly English (no jargon, no keys). Prompts are hidden from the customer, so they can be as technical as needed.
- OUTPUT: the result is ALWAYS exactly ONE image or ONE video - never several images, never a collage assembled afterwards. Set "output" to "video" only when the brief asks for a video / reel / clip / animation, otherwise "image". "steps" must have exactly one entry.
- If the brief wants a combined look (before/after, step-by-step, a set of angles, a collage), describe it INSIDE the one prompt as a single composed frame. For before/after: one photograph divided into two equal panels, left = before, right = after, same person, pose, framing and lighting in both, thin clean divider, no text. For a before/after VIDEO: one continuous clip that starts as the "before" and gradually transforms into the "after" with the same person, pose and framing.
- For video the first image field in "imageInputs" is used as the starting frame, so list the product or model photo there. Describe motion subtly (slow camera move, soft light, gentle movement); the product itself never moves or changes. Videos are silent: never describe speech, talking, dialogue, singing, laughing out loud or music (video models reject prompts whose audio they cannot make safely); people may smile, blink and move gently with their mouth closed.
- Each prompt must be complete and self-contained, vivid and specific (subject, setting, lighting, camera, mood), and use {{fieldKey}} placeholders for the values people choose. When a product image is supplied, say the product from the reference image must appear exactly as supplied.
- PRODUCT-DRIVEN SCENES: when the reference analysis says the scene is product-driven (props, background or palette come from the product's own ingredient / fragrance / flavour / variant / pack colour), set "productDriven" to true. Then the form is: the required "productImage" field, an OPTIONAL text field with key "heroIngredient" (label "Hero ingredient or variant", help "Leave blank and the AI reads it from the pack"), and only the plain choices that really vary (for example surface, mood, time of day) - never a field that hard-codes the reference's ingredient. The prompt must tell the image model to READ the packaging of the supplied product (name, variant, ingredient, fragrance, flavour, illustrations, colours), work out the hero ingredient from it, and build the whole scene from it: fresh real sprigs / flowers / fruit / leaves of that ingredient in the foreground, a small scatter of its dried or raw form, a smear or swirl of the product's own texture (cream, gel, oil, powder as appropriate), softly blurred plants of the same ingredient in the background, and light and background tones that harmonise with the pack colours. Use "[[The hero ingredient is {{heroIngredient}}, even if the pack suggests otherwise.]]" so the override only applies when the customer typed one. NEVER copy the reference's own ingredient (for example lavender) unless the supplied pack shows it. If the pack names no clear ingredient, fall back to a clean, neutral set in colours drawn from the pack.
- OPTIONAL SEGMENTS: wrap any sentence that only makes sense when a customer filled in an optional field in double square brackets, e.g. "[[Extra detail: {{notes}}.]]" - the whole segment is dropped when that field is empty.
- A final optional textarea field with key "additionalNotes" ("Additional notes", help "Anything else the AI should know - optional") is added automatically; you do not need to create it.
- NEVER ask for text, words, numbers, logos or labels to be drawn inside any image. Do not ask for "Before" / "After" captions inside the image.
- Never ask for black-and-white, greyscale or desaturated looks, and never describe changing the product's own colours.
- For results-style creatives (before/after of skin, hair, body etc.) keep the improvement realistic and believable, never exaggerated or miraculous, and keep the claim modest.
- Use only the field types listed. Keys: letters and digits only, camelCase, unique.`;

export const FEATURE_SYSTEM_TAIL = 'Return the JSON now.';

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clipMulti = (v, n) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);

export function cleanKey(raw, taken, fallback) {
  let k = String(raw || '').replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : '')).replace(/[^a-zA-Z0-9]/g, '');
  if (!k || !/^[a-zA-Z]/.test(k)) k = fallback;
  k = k.charAt(0).toLowerCase() + k.slice(1);
  k = k.slice(0, 32);
  let out = k;
  for (let i = 2; taken.has(out); i += 1) out = `${k.slice(0, 28)}${i}`;
  taken.add(out);
  return out;
}

function normalizeField(f, i, taken) {
  const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text';
  const key = cleanKey(f?.key || f?.label, taken, `field${i + 1}`);
  const out = {
    key,
    label: clip(f?.label, 60) || key,
    type,
    required: Boolean(f?.required),
    help: clip(f?.help, 160),
    placeholder: clip(f?.placeholder, 100)
  };
  if (type === 'select' || type === 'multiselect') {
    const seen = new Set();
    out.options = (Array.isArray(f?.options) ? f.options : [])
      .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
      .map((o) => ({ value: clip(o?.value ?? o?.label, 60), label: clip(o?.label ?? o?.value, 60) }))
      .filter((o) => o.value && !seen.has(o.value) && seen.add(o.value))
      .slice(0, LIMITS.options);
    if (out.options.length < 2) {
      // A choice with nothing to choose from is just a text box.
      out.type = 'text';
      delete out.options;
    } else if (type === 'select') {
      out.default = out.options.some((o) => o.value === f?.default) ? f.default : out.options[0].value;
    } else {
      out.default = (Array.isArray(f?.default) ? f.default : []).filter((v) => out.options.some((o) => o.value === v));
    }
  }
  if (out.type === 'number') {
    const min = Number.isFinite(Number(f?.min)) ? Number(f.min) : 0;
    const max = Number.isFinite(Number(f?.max)) && Number(f.max) > min ? Number(f.max) : min + 100;
    out.min = min;
    out.max = max;
    const d = Number(f?.default);
    out.default = Number.isFinite(d) ? Math.min(max, Math.max(min, d)) : min;
  }
  if (out.type === 'toggle') out.default = Boolean(f?.default);
  if (out.type === 'text' || out.type === 'textarea') out.default = clip(f?.default, 300);
  if (out.type === 'image') out.maxFiles = Math.min(LIMITS.imageFiles, Math.max(1, Math.round(Number(f?.maxFiles)) || 1));
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const pct = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/**
 * Text drawn onto the finished IMAGE by code (see utils/featureOverlay.js): headline, key points ...
 * Each block points at a text/textarea form field; box is [left, top, right, bottom] in percent of the image.
 */
export function normalizeOverlay(raw, fields) {
  const textKeys = new Set((fields || []).filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => f.key));
  const blocks = (Array.isArray(raw?.blocks) ? raw.blocks : []).slice(0, 8).map((b) => {
    if (!b || !textKeys.has(String(b.fieldKey))) return null;
    const box = Array.isArray(b.box) && b.box.length === 4 ? b.box.map((n) => pct(n, 0, 100, NaN)) : null;
    if (!box || box.some((n) => !Number.isFinite(n)) || box[2] - box[0] < 3 || box[3] - box[1] < 2) return null;
    return {
      kind: b.kind === 'list' ? 'list' : 'text',
      fieldKey: String(b.fieldKey),
      box,
      align: ['left', 'center', 'right'].includes(b.align) ? b.align : 'left',
      font: b.font === 'serif' ? 'serif' : 'sans',
      weight: b.weight === 'bold' ? 'bold' : 'regular',
      size: pct(b.size, 1.5, 14, 4),
      lineHeight: pct(b.lineHeight, 1, 1.8, 1.2),
      color: HEX.test(b.color) ? b.color : '#FFFFFF',
      bulletColor: HEX.test(b.bulletColor) ? b.bulletColor : '',
      divider: Boolean(b.divider),
      dividerColor: HEX.test(b.dividerColor) ? b.dividerColor : '',
      uppercase: Boolean(b.uppercase)
    };
  }).filter(Boolean);
  // 'ai' = the image model writes the text; 'code' = drawn exactly by the server. Older specs (no mode) stay 'code'.
  return { mode: raw?.mode === 'ai' ? 'ai' : 'code', blocks };
}

/**
 * Validates and cleans a spec. Throws an Error with a plain-English message when it cannot be used.
 * Always returns a brand-new object (never the input).
 */
export function normalizeSpec(raw) {
  const spec = raw && typeof raw === 'object' ? raw : {};

  const fieldKeys = new Set();
  // Map the keys the author used (e.g. "product_image") to the cleaned keys ("productImage") so that
  // imageInputs and {{placeholders}} written with the original key still resolve after cleaning.
  const fieldKeyMap = new Map();
  const fields = (Array.isArray(spec.fields) ? spec.fields : []).slice(0, LIMITS.fields).map((f, i) => {
    const out = normalizeField(f, i, fieldKeys);
    if (f?.key !== undefined && !fieldKeyMap.has(String(f.key))) fieldKeyMap.set(String(f.key), out.key);
    return out;
  });
  const imageKeys = new Set(fields.filter((f) => f.type === 'image').map((f) => f.key));

  const stepKeys = new Set();
  // The final output is ALWAYS a single image or a single video: only the first step is ever kept.
  const output = spec.output === 'video' ? 'video' : 'image';
  const rawSteps = (Array.isArray(spec.steps) ? spec.steps : []).slice(0, 1);
  // Map the keys the author used to the cleaned keys so references between steps survive cleaning.
  const keyMap = new Map();
  const steps = rawSteps.map((s, i) => {
    const key = cleanKey(s?.key || s?.label, stepKeys, `image${i + 1}`);
    keyMap.set(String(s?.key ?? ''), key);
    return { raw: s, key, index: i };
  });
  const finalSteps = steps.map(({ raw, key, index }) => {
    const prompt = clipMulti(raw?.prompt, LIMITS.promptChars).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => `{{${fieldKeyMap.get(k) || k}}}`);
    if (!prompt) throw new Error(`Image step ${index + 1} has no prompt.`);
    const earlier = new Set(steps.slice(0, index).map((x) => x.key));
    const useSteps = [...new Set((Array.isArray(raw?.useSteps) ? raw.useSteps : []).map((k) => keyMap.get(String(k)) || String(k)).filter((k) => earlier.has(k)))];
    const imageInputs = [...new Set((Array.isArray(raw?.imageInputs) ? raw.imageInputs : []).map((k) => fieldKeyMap.get(String(k)) || String(k)).filter((k) => imageKeys.has(k)))];
    let aspect = SIZES[raw?.aspect] ? raw.aspect : 'portrait';
    if (output === 'video' && aspect === 'square') aspect = 'portrait'; // video is 9:16 or 16:9
    const out = { key, label: clip(raw?.label, 40) || (output === 'video' ? 'Video' : 'Image'), prompt, imageInputs, useSteps: [], aspect, variants: 1 };
    if (output === 'video') out.seconds = Number(raw?.seconds) > 7 ? 10 : 5;
    return out;
  });
  if (!finalSteps.length) throw new Error('The feature needs a prompt for its output.');
  // A step another step builds on must be a single, fixed image.
  const used = new Set(finalSteps.flatMap((s) => s.useSteps));
  for (const s of finalSteps) if (used.has(s.key)) s.variants = 1;

  // One output, nothing to assemble afterwards.
  const composition = { mode: 'none', stepKeys: [finalSteps[0].key], labels: [''], showLabels: false, disclaimer: '', background: 'light' };

  // Placeholders must point at real fields; drop the ones that do not so "{{typo}}" is never sent to the model.
  const known = new Set(fields.map((f) => f.key));
  for (const s of finalSteps) s.prompt = s.prompt.replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (m, k) => (known.has(k) ? `{{${k}}}` : ''));

  const overlay = output === 'image' ? normalizeOverlay(spec.overlay, fields) : { mode: 'code', blocks: [] };

  // Every feature lets the customer add free-text notes. The sentence is optional ([[ ]]) so an empty box adds nothing.
  if (!fields.some((f) => f.key === 'additionalNotes') && fields.length < LIMITS.fields) {
    fields.push({
      key: 'additionalNotes', label: 'Additional notes', type: 'textarea', required: false,
      help: 'Optional - anything else the AI should know (props, mood, what to avoid).', placeholder: 'e.g. add a few water droplets, keep the background brighter', default: ''
    });
  }
  if (fields.some((f) => f.key === 'additionalNotes')) {
    for (const s of finalSteps) {
      if (!s.prompt.includes('{{additionalNotes}}')) {
        s.prompt = `${s.prompt} [[Additional instructions from the customer, to follow as long as they never change the product, its packaging or its colours: {{additionalNotes}}.]]`;
      }
    }
  }

  return {
    name: clip(spec.name, 40),
    description: clip(spec.description, 160),
    icon: clip(spec.icon, 4),
    output,
    fields,
    steps: finalSteps,
    composition,
    overlay,
    // The reference image is passed to the image model as a layout / style guide (image output only).
    styleReference: output === 'image' && Boolean(spec.styleReference),
    // The scene (props, background, palette) is built from the supplied product's own ingredient / pack, not copied from the reference.
    productDriven: fields.some((f) => f.key === 'productImage' && f.type === 'image') && Boolean(spec.productDriven)
  };
}

/** What a customer's browser may see: the form and the names of the images - never the prompt templates. */
export function publicSpec(spec) {
  return {
    output: spec?.output === 'video' ? 'video' : 'image',
    fields: spec?.fields || [],
    steps: (spec?.steps || []).map((s) => ({ key: s.key, label: s.label, variants: s.variants })),
    composition: { mode: spec?.composition?.mode || 'none', labels: spec?.composition?.labels || [], stepKeys: spec?.composition?.stepKeys || [] }
  };
}

/**
 * Checks the values someone typed/picked against the spec and returns clean inputs, or throws a
 * plain-English error. Image fields are checked separately (they arrive as files).
 */
export function cleanInputs(spec, body = {}, filesByField = {}) {
  const out = {};
  for (const f of spec.fields || []) {
    const raw = body[f.key];
    if (f.type === 'image') {
      const n = (filesByField[f.key] || []).length;
      if (f.required && n === 0) throw new Error(`Please add: ${f.label}.`);
      continue;
    }
    if (f.type === 'toggle') { out[f.key] = raw === true || raw === 'true' || raw === 'on' || raw === '1'; continue; }
    if (f.type === 'number') {
      const n = Number(raw);
      if (raw === undefined || raw === '' || !Number.isFinite(n)) {
        if (f.required) throw new Error(`Please enter: ${f.label}.`);
        out[f.key] = f.default;
      } else out[f.key] = Math.min(f.max, Math.max(f.min, n));
      continue;
    }
    if (f.type === 'select') {
      const v = String(raw ?? '');
      const hit = f.options.find((o) => o.value === v);
      if (!hit) {
        if (f.required && !f.default) throw new Error(`Please choose: ${f.label}.`);
        out[f.key] = f.default ?? '';
      } else out[f.key] = hit.value;
      continue;
    }
    if (f.type === 'multiselect') {
      let arr = raw;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = arr ? arr.split(',') : []; } }
      const vals = (Array.isArray(arr) ? arr : []).map(String).filter((v) => f.options.some((o) => o.value === v));
      if (f.required && vals.length === 0) throw new Error(`Please choose at least one: ${f.label}.`);
      out[f.key] = vals;
      continue;
    }
    const text = (f.type === 'textarea' ? clipMulti : clip)(raw, f.type === 'textarea' ? LIMITS.textareaInput : LIMITS.textInput);
    if (!text && f.required) throw new Error(`Please fill in: ${f.label}.`);
    out[f.key] = text;
  }
  return out;
}

/** Fills {{fieldKey}} in a prompt template with what the person entered. */
export function fillTemplate(template, spec, inputs, fileLabelsByField = {}) {
  const byKey = new Map((spec.fields || []).map((f) => [f.key, f]));
  // Optional segments: [[ ... {{key}} ... ]] are kept only when every placeholder inside has a value.
  const valueOf = (k) => {
    const f = byKey.get(k);
    if (!f) return '';
    if (f.type === 'image') return fileLabelsByField[k] || 'x';
    const v = inputs[k];
    if (f.type === 'toggle') return v ? 'yes' : '';
    if (Array.isArray(v)) return v.length ? 'x' : '';
    return String(v ?? '').trim();
  };
  template = String(template).replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner) => {
    const keys = [...inner.matchAll(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g)].map((m) => m[1]);
    return keys.every((k) => valueOf(k)) ? inner : '';
  });
  const text = String(template).replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (_m, k) => {
    const f = byKey.get(k);
    if (!f) return '';
    if (f.type === 'image') return fileLabelsByField[k] || `the supplied ${f.label.toLowerCase()} image`;
    const v = inputs[k];
    if (f.type === 'toggle') return v ? 'yes' : 'no';
    if (f.type === 'multiselect') return (v || []).map((x) => f.options.find((o) => o.value === x)?.label || x).join(', ');
    if (f.type === 'select') return f.options.find((o) => o.value === v)?.label || String(v ?? '');
    return String(v ?? '');
  });
  return text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}
