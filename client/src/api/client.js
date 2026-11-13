import axios from 'axios';

// Relative by default so this works out of the box when the server serves
// the built client from the same origin (e.g. a single Railway service).
// For local dev with two separate ports, set VITE_API_BASE_URL in
// client/.env to point at the API server directly (see client/.env.example).
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({ baseURL });

// The customer workspace an agency admin has switched to (see AuthContext.switchCustomer).
// Sent on every request; the server ignores it for everyone except agency admins, whose
// workspace it selects. Customer users are always pinned to their own customer.
export const CUSTOMER_KEY = 'automatr_customer';

// The super admin never "enters" a customer's workspace. Pages that show one customer's brand or gallery name that customer
// here for as long as they are open: requests carry it, and the saved workspace choice is never touched.
let scopedCustomerId = null;
let scopeToken = 0;
export function setCustomerScope(id) {
  scopedCustomerId = id ? String(id) : null;
  scopeToken += 1;
  return scopeToken;
}
// Clears only if nothing newer has set a scope since (a page opening just as another closes keeps its own).
export function clearCustomerScope(token) {
  if (token === scopeToken) scopedCustomerId = null;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('automatr_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const customerId = scopedCustomerId || localStorage.getItem(CUSTOMER_KEY);
  // (a request may set its own - the agency usage pages send 'all' to see every customer)
  if (customerId && !config.headers['X-Customer-Id']) {
    config.headers['X-Customer-Id'] = customerId;
  }
  return config;
});

// Tell the "images / videos left" panel to refresh after any successful action that can
// create an image or a video.
const GENERATING_PATH = /(\/image|\/image-options|\/carousel|\/port-formats|\/video(?!-ideas)|\/hero-edit|\/headline-edit|\/modify\/image|\/multi-scene-video\/[^/]+\/generate|\/custom-features\/[^/]+\/runs|\/custom-features\/runs\/[^/]+\/retry|\/custom-features\/admin\/[^/]+\/test|\/scene-reels)/;
api.interceptors.response.use(
  (res) => {
    try {
      if (res.config?.method !== 'get' && GENERATING_PATH.test(res.config?.url || '')) {
        window.dispatchEvent(new Event('automatr:allowance-refresh'));
      }
    } catch {
      /* ignore */
    }
    return res;
  },
  (err) => {
    if (err?.response?.data?.code === 'MONTHLY_LIMIT_REACHED') window.dispatchEvent(new Event('automatr:allowance-refresh'));
    // Storage full: a generate call was refused. Show the "delete old assets" alert wherever the person is (even mid-flow).
    if (err?.response?.data?.code === 'STORAGE_FULL') window.dispatchEvent(new CustomEvent('automatr:storage-full', { detail: err.response.data }));
    return Promise.reject(err);
  }
);

export function apiErrorMessage(err) {
  return err?.response?.data?.error || err?.message || 'Something went wrong.';
}

/**
 * Richer version of apiErrorMessage for AI-triggering actions specifically -
 * also surfaces the "out of credits/quota" CTA fields the server attaches
 * (see server/src/utils/classifyAiError.js) so the UI can offer a direct
 * "Add credits" link to the right provider's billing page instead of just
 * a dead-end error message.
 */
export function apiErrorInfo(err) {
  const data = err?.response?.data;
  return {
    message: data?.error || err?.message || 'Something went wrong.',
    isBillingError: Boolean(data?.isBillingError),
    billingUrl: data?.billingUrl || null,
    billingProviderLabel: data?.billingProviderLabel || null
  };
}

// The API server's origin, derived from baseURL by stripping the trailing
// "/api" - e.g. "http://localhost:5050/api" -> "http://localhost:5050".
// Empty string when baseURL is already relative (same-origin deployment),
// which is exactly what we want: prefixing with '' is a no-op.
const assetOrigin = baseURL.replace(/\/api\/?$/, '');

/**
 * Resolves a path returned by the API (e.g. brand asset/logo uploads,
 * AI-generated design images - always server-relative like "/uploads/x.png")
 * into a URL the browser can actually load.
 *
 * Why this is needed: an <img src="/uploads/x.png"> is resolved by the
 * browser against the *page's* origin, not the API server's. That's fine
 * when they're the same origin (production/Railway), but in local dev the
 * client runs on :5173 and the API on :5050 - a bare "/uploads/..." path
 * would silently 404 against the Vite dev server and show as a broken
 * image, even though the file exists and the API is working fine.
 *
 * Leaves already-absolute URLs (http://, https://, data:) untouched, since
 * those are already correct wherever they point (e.g. news images from
 * picsum.photos, or an admin-entered external URL).
 */
export function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (/^(https?:)?\/\//.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl;
  return `${assetOrigin}${pathOrUrl}`;
}

/**
 * Actually downloads a file rather than just navigating to it.
 *
 * Why this is needed: the HTML `download` attribute on an <a> tag is
 * silently ignored by browsers for cross-origin URLs - it just opens/
 * navigates to the resource instead of downloading it. That's exactly
 * this app's local-dev setup (client on :5173, API on :5050), so a plain
 * `<a href={url} download>` would appear to do nothing, or open the image
 * in the same tab instead of saving it. Fetching the file as a blob first
 * sidesteps this entirely, since the resulting blob: URL is always
 * same-origin regardless of where the original file came from.
 */
export async function downloadFile(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download file (${response.status}).`);
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

/**
 * Downloads a stored video as an animated GIF. The conversion happens on the server
 * (GET /api/media/video-gif, ffmpeg); the browser just receives the finished .gif and saves it.
 * `url` is the video's path or URL as stored (e.g. "/uploads/customers/acme/video.mp4").
 */
export async function downloadVideoAsGif(url, filename) {
  const res = await api.get('/media/video-gif', { params: { url }, responseType: 'blob', timeout: 180000 });
  const blob = res.data;
  if (!blob || !String(blob.type || '').includes('gif')) throw new Error('Could not make the GIF.');
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = String(filename || 'video').replace(/\.[a-z0-9]+$/i, '') + '.gif';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}
