import fs from 'node:fs';
import path from 'node:path';
import { resolveUploadPath } from '../utils/storage.js';

// Google OAuth 2.0 for the youtube.upload scope. Uploading a video always
// needs a real video file - unlike the other platforms, there's no
// "just post the image" fallback, since YouTube doesn't accept photo
// posts. See deployToYouTube in publishConnectors.js for how it errors
// clearly if the selected post variant has no generated video yet.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'].join(' ');

export function isConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URI);
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('YouTube is not configured (missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REDIRECT_URI).');
  }
}

export function getAuthorizationUrl(state) {
  requireConfigured();
  const params = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    redirect_uri: process.env.YOUTUBE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // required to get a refresh_token back at all
    prompt: 'consent', // forces the consent screen every time, which is what guarantees a refresh_token is (re-)issued
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Google token endpoint returned ${res.status}.`);
  return data;
}

export async function exchangeCodeForToken(code) {
  requireConfigured();
  const data = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.YOUTUBE_REDIRECT_URI,
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET
  });
  return {
    accessToken: data.access_token,
    // Google only returns a refresh_token on the very first consent (or
    // when prompt=consent forces re-issuance) - treat as optional here too.
    refreshToken: data.refresh_token || '',
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

export async function refreshAccessToken(refreshToken) {
  requireConfigured();
  const data = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET
  });
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in || 0) * 1000)
  };
}

export async function fetchChannelInfo(accessToken) {
  const res = await fetch(`${API_BASE}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Could not fetch YouTube channel (${res.status}).`);
  const channel = data.items?.[0];
  if (!channel) throw new Error('This Google account has no YouTube channel.');
  return { channelId: channel.id, channelTitle: channel.snippet?.title || '' };
}

/**
 * Resumable upload: initiate a session (metadata only), then PUT the video
 * bytes to the session URL Google hands back. This is the required path
 * for anything but trivially small files - a plain single-request upload
 * has no recovery if it's interrupted partway through.
 * @param {{accessToken: string, title: string, description: string, videoUrlPath: string, privacyStatus?: string}} args
 * @returns {Promise<{ externalUrl: string, videoId: string }>}
 */
export async function uploadVideo({ accessToken, title, description, videoUrlPath, privacyStatus = 'public' }) {
  const filePath = resolveUploadPath(videoUrlPath);
  const stat = fs.statSync(filePath);

  const initRes = await fetch(`${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(stat.size)
    },
    body: JSON.stringify({
      snippet: { title: title?.slice(0, 100) || 'Automatr post', description: description?.slice(0, 5000) || '' },
      status: { privacyStatus }
    })
  });

  if (!initRes.ok) {
    const errBody = await initRes.text().catch(() => '');
    throw new Error(`YouTube could not start the upload (${initRes.status}): ${errBody.slice(0, 200)}`);
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL.');

  const bytes = fs.readFileSync(filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(stat.size) },
    body: bytes
  });
  const data = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) throw new Error(data.error?.message || `YouTube rejected the video upload (${uploadRes.status}).`);

  return { externalUrl: `https://www.youtube.com/watch?v=${data.id}`, videoId: data.id };
}
