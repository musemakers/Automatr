import AppSetting from '../models/AppSetting.js';
import { BLANKET_RULES, RULE_BY_KEY, MAX_RULE_CHARS } from '../constants/blanketRules.js';

// Blanket instructions (see constants/blanketRules.js). Stored on the agency-wide settings document as
//   blanketRules: { [key]: { enabled?: boolean, text?: string } }
// Missing entry = enabled with the default wording.
//
// ruleText() is SYNCHRONOUS on purpose: the prompt builders that need it are plain functions. It reads an
// in-memory copy that is loaded at start-up (loadBlanketRules), refreshed in the background every 20 seconds
// and replaced right after every save.

const REFRESH_MS = 20_000;
let cache = {};
let loadedAt = 0;
let refreshing = null;

export function loadBlanketRules() {
  if (refreshing) return refreshing;
  refreshing = AppSetting.findOne({ key: 'global' }).select('blanketRules').lean()
    .then((doc) => { cache = doc?.blanketRules && typeof doc.blanketRules === 'object' ? doc.blanketRules : {}; loadedAt = Date.now(); })
    .catch((err) => { console.warn('[blanket-rules] could not load, using what we have:', err.message); })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** The text to add to a prompt for this rule: the admin's wording, the default, or '' when it is switched off. */
export function ruleText(key) {
  const def = RULE_BY_KEY[key];
  if (!def) return '';
  if (Date.now() - loadedAt > REFRESH_MS) loadBlanketRules(); // background refresh; this call uses the current copy
  const o = cache[key];
  if (o && o.enabled === false) return '';
  const custom = typeof o?.text === 'string' ? o.text.trim() : '';
  return custom || def.default;
}

/** Several rules joined with spaces, switched-off ones left out. */
export function ruleTexts(keys) {
  return keys.map(ruleText).filter(Boolean).join(' ');
}

export async function listBlanketRules() {
  await loadBlanketRules();
  return BLANKET_RULES.map((r) => {
    const o = cache[r.key] || {};
    const custom = typeof o.text === 'string' && o.text.trim() ? o.text.trim() : '';
    return {
      key: r.key, group: r.group, label: r.label, description: r.description, appliesTo: r.appliesTo, caution: Boolean(r.caution),
      default: r.default, text: custom || r.default, enabled: o.enabled !== false, customised: Boolean(custom) && custom !== r.default
    };
  });
}

/** body: { enabled?: boolean, text?: string }. An empty or default-equal text goes back to "use the default". */
export async function saveBlanketRule(key, body = {}) {
  const def = RULE_BY_KEY[key];
  if (!def) throw Object.assign(new Error('Unknown instruction.'), { status: 404 });
  const set = {};
  const unset = {};
  if (typeof body.enabled === 'boolean') {
    if (body.enabled) unset[`blanketRules.${key}.enabled`] = ''; else set[`blanketRules.${key}.enabled`] = false;
  }
  if (typeof body.text === 'string') {
    const t = body.text.replace(/\s+/g, ' ').trim();
    if (t.length > MAX_RULE_CHARS) throw Object.assign(new Error(`Keep it under ${MAX_RULE_CHARS} characters.`), { status: 400 });
    if (!t || t === def.default) unset[`blanketRules.${key}.text`] = ''; else set[`blanketRules.${key}.text`] = t;
  }
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  if (!Object.keys(update).length) throw Object.assign(new Error('Nothing to change.'), { status: 400 });
  await AppSetting.findOneAndUpdate({ key: 'global' }, update, { upsert: true });
  loadedAt = 0;
  return listBlanketRules();
}

export async function resetBlanketRule(key) {
  if (!RULE_BY_KEY[key]) throw Object.assign(new Error('Unknown instruction.'), { status: 404 });
  await AppSetting.findOneAndUpdate({ key: 'global' }, { $unset: { [`blanketRules.${key}`]: '' } }, { upsert: true });
  loadedAt = 0;
  return listBlanketRules();
}
