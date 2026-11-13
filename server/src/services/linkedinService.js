import fs from 'node:fs';
import path from 'node:path';
import { resolveUploadPath } from '../utils/storage.js';

// LinkedIn's versioned REST API wants a "LinkedIn-Version: YYYYMM" header.
// Any version LinkedIn has published works going forward - this just needs
// bumping occasionally; it's not tied to when the request happens.
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const REST_BASE = 'https://api.linkedin.com/rest';

// "profile"+"email"+"openid" identify who the user is (via /v2/userinfo,
// OpenID Connect - this is LinkedIn's modern replacement for the old
// r_liteprofile/r_emailaddress scopes). "w_member_social" is the actual
// permission to post on their behalf. Both product grants ("Sign In with
// LinkedIn using OpenID Connect" + "Share on LinkedIn") must be requested
// in the LinkedIn Developer Portal before these scopes are available.
const SCOPES = 'openid profile email w_member_social';

export function isConfigured() {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET && process.env.LINKEDIN_REDIRECT_URI);
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('LinkedIn is not configured (missing LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET / LINKEDIN_REDIRECT_URI).');
  }
}

/** @param {string} state - opaque, server-signed value round-tripped through LinkedIn to identify the user on callback (see linkedin.controller.js) */
export function getAuthorizationUrl(state) {
  requireConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    state,
    scope: SCOPES
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postForm(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `LinkedIn token endpoint returned ${res.status}.`);
  }
  return data;
}

/** Exchanges the one-time authorization code from the OAuth redirect for real tokens. */
export async function exchangeCodeForToken(code) {
  requireConfigured();
  const data = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET
  });
  return {
    accessToken: data.access_token,
    // Not every LinkedIn app is granted refresh tokens by default - treat
    // as optional. Without one, the user just has to reconnect after ~60 days.
    refreshToken: data.refresh_token || '',
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

/** Best-effort - only works if LinkedIn issued a refresh token for this app/user. */
export async function refreshAccessToken(refreshToken) {
  requireConfigured();
  const data = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

/** Fetches the connected member's identity - `sub` becomes the "urn:li:person:{sub}" used as the post author. */
export async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not fetch LinkedIn profile (${res.status}).`);
  const data = await res.json();
  return { personURN: `urn:li:person:${data.sub}`, name: data.name || '', email: data.email || '' };
}

/**
 * Uploads one image via LinkedIn's Images API (initialize -> PUT bytes ->
 * get back a media URN) so it can be attached to a post. Reads the file
 * straight off local disk rather than re-fetching it over HTTP, since our
 * own server already has it in the uploads directory.
 * @param {string} imageUrlPath - a server-relative path like "/uploads/gen-xyz.png"
 * @returns {Promise<string>} the LinkedIn image URN
 */
async function uploadImage(accessToken, personURN, imageUrlPath) {
  const initRes = await fetch(`${REST_BASE}/images?action=initializeUpload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: personURN } })
  });
  if (!initRes.ok) {
    const errBody = await initRes.text().catch(() => '');
    throw new Error(`LinkedIn image upload could not be initialized (${initRes.status}): ${errBody.slice(0, 200)}`);
  }
  const initData = await initRes.json();
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error('LinkedIn did not return an upload URL for the image.');

  const filePath = resolveUploadPath(imageUrlPath);
  const bytes = fs.readFileSync(filePath);

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: bytes
  });
  if (!putRes.ok) throw new Error(`LinkedIn rejected the image upload (${putRes.status}).`);

  return imageUrn;
}

/**
 * Publishes one post to the member's personal LinkedIn feed via the current
 * Posts API (`/rest/posts`, the successor to the deprecated `/ugcPosts`).
 * Pass `imageUrlPaths` (2-10 images) instead of `imageUrlPath` for a
 * LinkedIn Carousel post, via the Posts API's `multiImage` content type.
 * @param {{accessToken: string, personURN: string, caption: string, imageUrlPath?: string, imageUrlPaths?: string[]}} args
 * @returns {Promise<{ externalUrl: string, postUrn: string }>}
 */
export async function createPost({ accessToken, personURN, caption, imageUrlPath, imageUrlPaths }) {
  let content;
  if (imageUrlPaths?.length) {
    if (imageUrlPaths.length < 2 || imageUrlPaths.length > 10) {
      throw new Error('LinkedIn carousels need between 2 and 10 images.');
    }
    const urns = await Promise.all(imageUrlPaths.map((p) => uploadImage(accessToken, personURN, p)));
    content = { multiImage: { images: urns.map((id) => ({ id })) } };
  } else if (imageUrlPath) {
    const imageUrn = await uploadImage(accessToken, personURN, imageUrlPath);
    content = { media: { id: imageUrn } };
  }

  const res = await fetch(`${REST_BASE}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author: personURN,
      commentary: caption || '',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(content ? { content } : {})
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`LinkedIn rejected the post (${res.status}): ${errBody.slice(0, 300)}`);
  }

  // LinkedIn's Posts API returns 201 with an empty body - the new post's
  // URN comes back in the x-restli-id / x-linkedin-id response header.
  const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
  const postId = postUrn.split(':').pop();
  const externalUrl = postId ? `https://www.linkedin.com/feed/update/${postUrn}/` : 'https://www.linkedin.com/feed/';

  return { externalUrl, postUrn };
}
