import { PROVIDER_BILLING_URLS, PROVIDER_BILLING_LABELS } from '../constants/providerBilling.js';

// Each provider phrases "you're out of money/quota" differently - this is
// a best-effort pattern match across the ones actually wired up
// (OpenAI, Anthropic, Gemini, Seedream/BytePlus, Veo, Kling, Runway).
// False negatives just mean a generic error instead of the CTA (safe);
// false positives are unlikely since these phrases are fairly specific.
const BILLING_PATTERNS = [
  /insufficient_quota/i,
  /exceeded your current quota/i,
  /you (have )?(exceeded|ran out of) (your )?(credits|tokens|balance)/i,
  /credit balance is too low/i,
  /insufficient balance/i,
  /insufficient credit/i,
  /quota exceeded/i,
  /resource_exhausted/i,
  /payment required/i,
  /billing account/i,
  /account.*(overdue|suspended)/i,
  /top ?up your (account|balance)/i,
  /please (add|check) (your )?(billing|payment)/i
];

function isBillingError(err) {
  const message = String(err?.message || '');
  const status = err?.status || err?.statusCode;
  if (status === 402) return true; // HTTP 402 Payment Required - unambiguous
  return BILLING_PATTERNS.some((re) => re.test(message));
}

/**
 * Checks whether a provider call failed for a billing/quota reason and, if
 * so, mutates the error with the info the client needs to render an
 * "Add credits" CTA pointing at that provider's billing page. Called right
 * where each provider error is caught (router.js), so it can annotate the
 * error before it's either retried against the next provider or thrown/
 * returned up to the client.
 * @returns {Error} the same error, possibly annotated
 */
export function annotateIfBillingError(err, providerKey) {
  if (isBillingError(err)) {
    err.isBillingError = true;
    err.billingProvider = providerKey;
    err.billingProviderLabel = PROVIDER_BILLING_LABELS[providerKey] || providerKey;
    err.billingUrl = PROVIDER_BILLING_URLS[providerKey] || null;
  }
  return err;
}
