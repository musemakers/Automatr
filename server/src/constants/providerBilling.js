// Where to send someone when a provider call fails because of an
// out-of-credits/quota/billing problem - not something retrying can fix,
// so the right move is a direct link to go add funds, not a vague error.
export const PROVIDER_BILLING_URLS = {
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  anthropic: 'https://console.anthropic.com/settings/billing',
  gemini: 'https://console.cloud.google.com/billing',
  seedream: 'https://console.byteplus.com/finance/overview',
  veo: 'https://console.cloud.google.com/billing',
  kling: 'https://klingai.com/billing',
  runway: 'https://runwayml.com/billing'
};

export const PROVIDER_BILLING_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Cloud (Gemini)',
  seedream: 'BytePlus (Seedream)',
  veo: 'Google Cloud (Veo)',
  kling: 'Kling',
  runway: 'Runway'
};
