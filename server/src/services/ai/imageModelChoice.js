import { providerStatus } from './router.js';
import { getSettings } from '../appSettingsService.js';

// Lets the person re-run an image edit with a different image model than the
// workspace default, WITHOUT the UI ever naming a provider: the client only
// sees "Default model" / "Alternative model 1..n". Resolved here to a real
// provider key for router.generateImage (an explicit key means no silent
// fallback to the default - the point is to get that model's take).
const ALIASES = { gpt: 'openai', openai: 'openai', chatgpt: 'openai', gemini: 'gemini', google: 'gemini', seedream: 'seedream', bytedance: 'seedream' };
const IMAGE_PROVIDERS = ['openai', 'gemini', 'seedream'];

function priority() {
  const raw = process.env.AI_IMAGE_PRIORITY;
  const list = (raw ? raw.split(',') : IMAGE_PROVIDERS).map((s) => ALIASES[s.trim().toLowerCase()]).filter(Boolean);
  return [...new Set([...list, ...IMAGE_PROVIDERS])];
}

/** { defaultKey, alts: [providerKey...] } for the image providers that are configured right now. */
export async function imageModelChoices() {
  const status = providerStatus();
  const configured = priority().filter((k) => status[k]);
  let defaultKey = configured[0] || null;
  try {
    const settings = await getSettings();
    const pinned = ALIASES[String(settings?.imageModel || '').toLowerCase()];
    if (pinned && status[pinned]) defaultKey = pinned;
  } catch {
    /* fall back to priority order */
  }
  return { defaultKey, alts: configured.filter((k) => k !== defaultKey) };
}

/** 'default' -> 'auto' (normal behaviour); 'alt1' / 'alt2' -> that alternative provider, or 'auto' if it is not available. */
export async function resolveImageChoice(choice) {
  const m = /^alt(\d)$/.exec(String(choice || ''));
  if (!m) return 'auto';
  const { alts } = await imageModelChoices();
  return alts[Number(m[1]) - 1] || 'auto';
}

/** Options for the client: generic labels only. */
export async function imageModelOptions() {
  const { alts } = await imageModelChoices();
  return [{ id: 'default', label: 'Default model' }, ...alts.map((_, i) => ({ id: `alt${i + 1}`, label: `Alternative model ${i + 1}` }))];
}
