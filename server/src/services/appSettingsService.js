import AppSetting, { NEWS_PROVIDERS, COPY_MODELS, IMAGE_MODELS, VIDEO_MODELS, VISION_MODELS } from '../models/AppSetting.js';
import { currentCustomer } from '../tenant/context.js';

const SETTINGS_KEY = 'global';
const FIELDS = ['newsProvider', 'copyModel', 'imageModel', 'visionModel', 'videoModel', 'hideCosts'];

/**
 * The agency-wide default settings document (singleton), created on first
 * access. Per-customer overrides are layered on top by getSettings().
 */
export async function getGlobalSettings() {
  const settings = await AppSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true, new: true }
  ).lean();
  return settings;
}

/**
 * Effective settings for the current request: the agency defaults, with any
 * value the active customer has set (non-null) taking precedence. Every
 * generation path (copy, image, video, news, cost display) calls this, so each
 * customer's model choices apply to that customer only.
 */
export async function getSettings() {
  const base = await getGlobalSettings();
  const overrides = currentCustomer()?.settings;
  if (!overrides) return base;
  const o = typeof overrides.toObject === 'function' ? overrides.toObject() : overrides;
  const merged = { ...base };
  for (const f of FIELDS) if (o[f] !== null && o[f] !== undefined) merged[f] = o[f];
  merged.overriddenFields = FIELDS.filter((f) => o[f] !== null && o[f] !== undefined);
  return merged;
}

/**
 * Persist one setting. With a customer in context the value is saved on that
 * customer (pass null to go back to inheriting the agency default). With
 * { scope: 'global' } - or no customer in context - it changes the agency default.
 */
async function setField(field, value, validate, opts = {}) {
  const customer = opts.scope === 'global' ? null : currentCustomer();
  if (customer) {
    if (value !== null) validate(value);
    customer.set(`settings.${field}`, value);
    await customer.save();
    return getSettings();
  }
  if (value === null) throw new Error(`Cannot reset ${field} on the agency defaults.`);
  validate(value);
  await AppSetting.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { [field]: value } }, { upsert: true, new: true });
  return opts.scope === 'global' ? getGlobalSettings() : getSettings();
}

/**
 * Updates which AI provider powers the news feed. This only picks among
 * providers that already have their API key configured in server/.env -
 * it never stores or accepts a key itself.
 */
export function updateNewsProvider(provider, opts) {
  return setField('newsProvider', provider, (v) => {
    if (!NEWS_PROVIDERS.includes(v)) throw new Error(`Unknown news provider "${v}". Must be one of: ${NEWS_PROVIDERS.join(', ')}.`);
  }, opts);
}

/**
 * Default model for generating post copy. "auto" lets the router pick;
 * otherwise pinned to one provider. Per customer (see setField).
 */
export function updateCopyModel(model, opts) {
  return setField('copyModel', model, (v) => {
    if (!COPY_MODELS.includes(v)) throw new Error(`Unknown copy model "${v}". Must be one of: ${COPY_MODELS.join(', ')}.`);
  }, opts);
}

/**
 * Same idea as updateCopyModel, but for the default image-generation model.
 * "auto" defers to the AI_IMAGE_PRIORITY env-var fallback chain in
 * imageModelChoice.js.
 */
export function updateImageModel(model, opts) {
  return setField('imageModel', model, (v) => {
    if (!IMAGE_MODELS.includes(v)) throw new Error(`Unknown image model "${v}". Must be one of: ${IMAGE_MODELS.join(', ')}.`);
  }, opts);
}

/**
 * Default model for looking at images (animation ideas, brand / reference / template analysis).
 * "auto" defers to AI_VISION_PRIORITY in router.js; a pinned model is tried first.
 */
export function updateVisionModel(model, opts) {
  return setField('visionModel', model, (v) => {
    if (!VISION_MODELS.includes(v)) throw new Error(`Unknown vision model "${v}". Must be one of: ${VISION_MODELS.join(', ')}.`);
  }, opts);
}

/**
 * Same idea again, for the default video-generation model ("auto" defers to
 * AI_VIDEO_PRIORITY in videoRouter.js).
 */
export function updateVideoModel(model, opts) {
  return setField('videoModel', model, (v) => {
    if (!VIDEO_MODELS.includes(v)) throw new Error(`Unknown video model "${v}". Must be one of: ${VIDEO_MODELS.join(', ')}.`);
  }, opts);
}

/**
 * Toggles whether cost-estimate "~$0.0X" tags are shown. Purely a display
 * setting - generation and its real cost are unaffected.
 */
export function updateHideCosts(hideCosts, opts) {
  return setField('hideCosts', hideCosts === null ? null : Boolean(hideCosts), () => {}, opts);
}
