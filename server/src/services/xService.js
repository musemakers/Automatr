import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveUploadPath } from '../utils/storage.js';

// X requires OAuth 2.0 with PKCE for user-context posting (app-only Bearer
// tokens can't create posts). Unlike LinkedIn/Meta, this means a
// code_verifier has to be generated up front and matched again at the
// callback - it's carried inside the same signed `state` JWT the other
// connectors use to identify the user, so no separate session storage is
// needed for it either.
const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API_BASE = 'https://api.x.com/2';

const SCOPES = 'tweet.read tweet.write users.read offline.access media.write';

export function isConfigured() {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_REDIRECT_URI);
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('X is not configured (missing X_CLIENT_ID / X_REDIRECT_URI).');
  }
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generates one PKCE pair for a single connect attempt. */
export function generatePkce() {
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function getAuthorizationUrl(state, codeChallenge) {
  requireConfigured();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.X_REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// X apps can be "public" (PKCE only, no secret) or "confidential" (secret
// required, sent as HTTP Basic auth on the token endpoint) - support both,
// since which one a given developer's app is depends on how they
// registered it in the X Developer Portal.
function tokenAuthHeaders() {
  if (!process.env.X_CLIENT_SECRET) return {};
  const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...tokenAuthHeaders() },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `X token endpoint returned ${res.status}.`);
  return data;
}

export async function exchangeCodeForToken(code, codeVerifier) {
  requireConfigured();
  const data = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.X_REDIRECT_URI,
    client_id: process.env.X_CLIENT_ID,
    code_verifier: codeVerifier
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

/** Access tokens last only ~2 hours, so refresh is the normal path here, not an edge case. */
export async function refreshAccessToken(refreshToken) {
  requireConfigured();
  const data = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.X_CLIENT_ID
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.title || `Could not fetch X profile (${res.status}).`);
  return { userId: data.data.id, username: data.data.username };
}

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Single-request image upload (base64 JSON body) - fine for the image
 * sizes this app generates. X's chunked INIT/APPEND/FINALIZE flow exists
 * for large files and video, which isn't needed for the still images
 * Automatr posts to X.
 * @param {string} imageUrlPath - server-relative path like "/uploads/gen-xyz.png"
 * @returns {Promise<string>} the media id to attach to a tweet
 */
async function uploadMedia(accessToken, imageUrlPath) {
  const ext = path.extname(imageUrlPath).slice(1).toLowerCase();
  const mediaType = MIME_BY_EXT[ext] || 'image/png';
  const filePath = resolveUploadPath(imageUrlPath);
  const base64 = fs.readFileSync(filePath).toString('base64');

  const res = await fetch(`${API_BASE}/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media: base64, media_category: 'tweet_image', media_type: mediaType })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || data.title || `X rejected the media upload (${res.status}).`);
  return data.data.id;
}

/**
 * Posts to X, attaching image(s) if provided. X caps post text at 280
 * characters - captions longer than that are truncated with an ellipsis
 * rather than rejected outright, since a caption written for Instagram/
 * LinkedIn will often run longer than a tweet allows. Accepts either a
 * single image path or an array (X allows up to 4 images per post,
 * displayed as a grid - not a swipeable carousel, but the closest thing
 * X has to one).
 * @param {{accessToken: string, username: string, text: string, imageUrlPath?: string, imageUrlPaths?: string[]}} args
 */
export async function createPost({ accessToken, username, text, imageUrlPath, imageUrlPaths }) {
  const body = { text: (text || '').length > 280 ? `${text.slice(0, 277)}...` : text || '' };

  const paths = imageUrlPaths?.length ? imageUrlPaths : imageUrlPath ? [imageUrlPath] : [];
  if (paths.length > 4) {
    throw new Error('X allows at most 4 images per post.');
  }
  if (paths.length > 0) {
    const mediaIds = await Promise.all(paths.map((p) => uploadMedia(accessToken, p)));
    body.media = { media_ids: mediaIds };
  }

  const res = await fetch(`${API_BASE}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || data.title || data.detail || `X rejected the post (${res.status}).`);

  const id = data.data.id;
  return { externalUrl: `https://x.com/${username}/status/${id}` };
}
