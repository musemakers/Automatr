// One Meta ("Facebook Login") OAuth connection covers both Instagram and
// Facebook publishing - a Facebook Page access token can post to that Page
// directly, and (if the Page has a linked Instagram professional account)
// to Instagram too, via the container-based Content Publishing API.
//
// Requirements on Meta's side, none of which this code can satisfy for
// you: a Meta Developer app, a Facebook Page, an Instagram professional
// (Business/Creator) account linked to that Page, and - for real users
// beyond your own ~25 app testers - App Review approval for
// pages_manage_posts / pages_show_list / instagram_basic /
// instagram_content_publish.
const GRAPH_VERSION = process.env.META_API_VERSION || 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_DIALOG_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'].join(',');

export function isConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

/**
 * Both the Facebook Photos endpoint and Instagram's media container expect
 * a publicly fetchable HTTPS URL, not an upload - Meta's servers reach out
 * and download the image themselves. Our stored path is server-relative
 * (e.g. "/uploads/gen-xyz.png"), so it needs to be resolved against this
 * server's actual public origin - which only exists once deployed
 * somewhere real (Railway, etc.). Plain localhost URLs are unreachable
 * from Meta's side, so this throws early with a clear message instead of
 * letting the publish call fail confusingly against their API.
 */
export function resolvePublicImageUrl(imageUrlPath) {
  const publicOrigin = process.env.PUBLIC_SERVER_URL;
  if (!publicOrigin) {
    throw new Error('PUBLIC_SERVER_URL is not set in server/.env - Meta needs a real public HTTPS URL to fetch the image from, not localhost.');
  }
  return `${publicOrigin.replace(/\/$/, '')}${imageUrlPath}`;
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('Meta is not configured (missing META_APP_ID / META_APP_SECRET / META_REDIRECT_URI).');
  }
}

/** @param {string} state - opaque, server-signed value round-tripped through Meta to identify the user on callback (see meta.controller.js) */
export function getAuthorizationUrl(state) {
  requireConfigured();
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state,
    scope: SCOPES,
    response_type: 'code'
  });
  return `${OAUTH_DIALOG_URL}?${params.toString()}`;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Meta Graph API returned ${res.status}.`);
  return data;
}

/** Short-lived (~1-2 hour) user access token from the one-time authorization code. */
export async function exchangeCodeForToken(code) {
  requireConfigured();
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code
  });
  const data = await getJson(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Trades the short-lived user token for a long-lived one (~60 days) - Page tokens derived from this are effectively non-expiring while it remains valid. */
export async function getLongLivedUserToken(shortLivedToken) {
  requireConfigured();
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken
  });
  const data = await getJson(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Every Facebook Page this user manages, each with its own Page access token. */
export async function fetchManagedPages(userAccessToken) {
  const data = await getJson(`${GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}`);
  return data.data || [];
}

/** The Instagram professional account linked to a Page, if any. */
export async function fetchLinkedInstagramAccount(pageId, pageAccessToken) {
  const data = await getJson(
    `${GRAPH_BASE}/${pageId}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(pageAccessToken)}`
  );
  return data.instagram_business_account || null;
}

/**
 * Publishes a photo post directly to a Facebook Page - single API call,
 * unlike Instagram's two-step container flow.
 * @param {{pageId: string, pageAccessToken: string, imageUrl: string, caption: string}} args
 */
export async function publishToFacebookPage({ pageId, pageAccessToken, imageUrl, caption }) {
  const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl, caption, access_token: pageAccessToken })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Facebook rejected the post (${res.status}).`);
  return { externalUrl: `https://www.facebook.com/${data.post_id || data.id}` };
}

/**
 * Publishes a photo to Instagram via the container flow: create a media
 * container referencing the image, then publish that container.
 * @param {{instagramBusinessId: string, pageAccessToken: string, imageUrl: string, caption: string}} args
 */
export async function publishToInstagram({ instagramBusinessId, pageAccessToken, imageUrl, caption }) {
  const createRes = await fetch(`${GRAPH_BASE}/${instagramBusinessId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: pageAccessToken })
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) throw new Error(createData.error?.message || `Instagram rejected the media container (${createRes.status}).`);
  const containerId = createData.id;

  const publishRes = await fetch(`${GRAPH_BASE}/${instagramBusinessId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: pageAccessToken })
  });
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) throw new Error(publishData.error?.message || `Instagram rejected publishing the container (${publishRes.status}).`);

  const mediaId = publishData.id;
  // Best-effort - the permalink field isn't strictly required to succeed.
  let permalink = `https://www.instagram.com/`;
  try {
    const info = await getJson(`${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(pageAccessToken)}`);
    if (info.permalink) permalink = info.permalink;
  } catch {
    /* non-fatal */
  }

  return { externalUrl: permalink };
}

/**
 * Publishes an Instagram Carousel (2-10 images, swipeable): each image
 * first becomes its own "carousel item" container, then a parent
 * container of media_type CAROUSEL references all of them by id, then
 * that parent container is published - three round-trips instead of
 * single-image's two, per Meta's Content Publishing API.
 * @param {{instagramBusinessId: string, pageAccessToken: string, imageUrls: string[], caption: string}} args
 */
export async function publishCarouselToInstagram({ instagramBusinessId, pageAccessToken, imageUrls, caption }) {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('Instagram carousels need between 2 and 10 images.');
  }

  const itemContainerIds = await Promise.all(
    imageUrls.map(async (imageUrl) => {
      const res = await fetch(`${GRAPH_BASE}/${instagramBusinessId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: pageAccessToken })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || `Instagram rejected a carousel item (${res.status}).`);
      return data.id;
    })
  );

  const parentRes = await fetch(`${GRAPH_BASE}/${instagramBusinessId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'CAROUSEL', children: itemContainerIds, caption, access_token: pageAccessToken })
  });
  const parentData = await parentRes.json().catch(() => ({}));
  if (!parentRes.ok) throw new Error(parentData.error?.message || `Instagram rejected the carousel container (${parentRes.status}).`);

  const publishRes = await fetch(`${GRAPH_BASE}/${instagramBusinessId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: parentData.id, access_token: pageAccessToken })
  });
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) throw new Error(publishData.error?.message || `Instagram rejected publishing the carousel (${publishRes.status}).`);

  const mediaId = publishData.id;
  let permalink = 'https://www.instagram.com/';
  try {
    const info = await getJson(`${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(pageAccessToken)}`);
    if (info.permalink) permalink = info.permalink;
  } catch {
    /* non-fatal */
  }

  return { externalUrl: permalink };
}

/**
 * Publishes a multi-photo Facebook Page post (2-10 images shown as a
 * gallery in the feed): each image is first uploaded as an unpublished
 * Page photo, then a single /feed post attaches all of them together.
 * @param {{pageId: string, pageAccessToken: string, imageUrls: string[], caption: string}} args
 */
export async function publishCarouselToFacebookPage({ pageId, pageAccessToken, imageUrls, caption }) {
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('Facebook multi-photo posts need between 2 and 10 images.');
  }

  const photoIds = await Promise.all(
    imageUrls.map(async (imageUrl) => {
      const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, published: false, access_token: pageAccessToken })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || `Facebook rejected an unpublished photo upload (${res.status}).`);
      return data.id;
    })
  );

  const res = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: caption,
      attached_media: photoIds.map((id) => ({ media_fbid: id })),
      access_token: pageAccessToken
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Facebook rejected the multi-photo post (${res.status}).`);

  return { externalUrl: `https://www.facebook.com/${data.id}` };
}
