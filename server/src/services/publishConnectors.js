/**
 * Publish connectors - one function per platform that actually pushes a
 * finished post live.
 *
 * LinkedIn, Instagram, Facebook, X, and YouTube are all wired up for real
 * (see services/linkedinService.js, metaService.js, xService.js,
 * youtubeService.js). Only TikTok and Pinterest are still mock/simulated
 * adapters: they log the "deploy" and return a fake external URL so the
 * rest of the workflow (including the UI) works end-to-end without
 * requiring a developer app for those platforms too.
 *
 * To make one of those real, follow the same shape the others use:
 *   - TikTok: TikTok Content Posting API
 *   - Pinterest: Pinterest API v5 (POST /pins)
 * Each needs its own OAuth app + per-user access token, stored on the User
 * document the same way the other connectedAccounts.* fields are.
 */
import * as linkedinService from './linkedinService.js';
import * as metaService from './metaService.js';
import * as xService from './xService.js';
import * as youtubeService from './youtubeService.js';

const CONNECTORS = {
  Instagram: deployToInstagram,
  LinkedIn: deployToLinkedIn,
  X: deployToX,
  Facebook: deployToFacebook,
  TikTok: mockDeploy('TikTok'),
  Pinterest: mockDeploy('Pinterest'),
  YouTube: deployToYouTube
};

function mockDeploy(platform) {
  return async function deploy({ account, imageUrl, caption }) {
    console.log(`[publish:${platform}] (simulated) deploying for ${account}: "${caption?.slice(0, 60)}..."`);
    await new Promise((r) => setTimeout(r, 300)); // pretend it takes a moment
    return {
      platform,
      account,
      deployedAt: new Date(),
      externalUrl: `https://example-${platform.toLowerCase()}.invalid/posts/${Date.now()}`,
      simulated: true
    };
  };
}

/**
 * Real LinkedIn publish. `user` is the Mongoose User document making the
 * request (passed through from the posts controller) - its
 * connectedAccounts.linkedin holds the OAuth token from the connect flow.
 */
async function deployToLinkedIn({ user, imageUrl, caption, carouselImageUrls }) {
  const li = user?.connectedAccounts?.linkedin;
  if (!li?.accessToken) {
    throw new Error('LinkedIn is not connected for this account. Connect it from Settings first.');
  }

  let accessToken = li.accessToken;

  // Best-effort refresh if we're past (or very near) expiry and a refresh
  // token exists - LinkedIn access tokens only last 60 days. If there's no
  // refresh token, or the refresh itself fails, we let the actual post
  // attempt fail naturally with a clear "reconnect" error instead of
  // guessing here.
  const isExpiringSoon = li.expiresAt && new Date(li.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (isExpiringSoon && li.refreshToken) {
    try {
      const refreshed = await linkedinService.refreshAccessToken(li.refreshToken);
      accessToken = refreshed.accessToken;
      user.connectedAccounts.linkedin.accessToken = refreshed.accessToken;
      user.connectedAccounts.linkedin.refreshToken = refreshed.refreshToken;
      user.connectedAccounts.linkedin.expiresAt = refreshed.expiresAt;
      await user.save();
    } catch (err) {
      console.warn('[publish:LinkedIn] token refresh failed, attempting with existing token:', err.message);
    }
  }

  try {
    const { externalUrl } = await linkedinService.createPost(
      carouselImageUrls?.length
        ? { accessToken, personURN: li.personURN, caption, imageUrlPaths: carouselImageUrls }
        : { accessToken, personURN: li.personURN, caption, imageUrlPath: imageUrl }
    );
    return { platform: 'LinkedIn', account: li.name || li.personURN, deployedAt: new Date(), externalUrl, simulated: false };
  } catch (err) {
    if (err.message?.includes('401') || err.message?.includes('403')) {
      throw new Error('LinkedIn rejected the request - the connection may have expired. Reconnect it from Settings.');
    }
    throw err;
  }
}

/**
 * Real Facebook Page publish. `user` is the Mongoose User document making
 * the request - its connectedAccounts.meta holds the Page access token
 * from the Meta connect flow.
 */
async function deployToFacebook({ user, imageUrl, caption, carouselImageUrls }) {
  const meta = user?.connectedAccounts?.meta;
  if (!meta?.pageAccessToken) {
    throw new Error('Meta is not connected for this account. Connect it from Settings first.');
  }
  try {
    if (carouselImageUrls?.length) {
      const publicUrls = carouselImageUrls.map((u) => metaService.resolvePublicImageUrl(u));
      const { externalUrl } = await metaService.publishCarouselToFacebookPage({
        pageId: meta.pageId,
        pageAccessToken: meta.pageAccessToken,
        imageUrls: publicUrls,
        caption
      });
      return { platform: 'Facebook', account: meta.pageName, deployedAt: new Date(), externalUrl, simulated: false };
    }
    const publicImageUrl = metaService.resolvePublicImageUrl(imageUrl);
    const { externalUrl } = await metaService.publishToFacebookPage({
      pageId: meta.pageId,
      pageAccessToken: meta.pageAccessToken,
      imageUrl: publicImageUrl,
      caption
    });
    return { platform: 'Facebook', account: meta.pageName, deployedAt: new Date(), externalUrl, simulated: false };
  } catch (err) {
    if (err.message?.includes('190') || /session|token/i.test(err.message || '')) {
      throw new Error('Facebook rejected the request - the connection may have expired. Reconnect Meta from Settings.');
    }
    throw err;
  }
}

/**
 * Real Instagram publish, via the Page's linked Instagram professional
 * account. Same connectedAccounts.meta source as deployToFacebook.
 */
async function deployToInstagram({ user, imageUrl, caption, carouselImageUrls }) {
  const meta = user?.connectedAccounts?.meta;
  if (!meta?.pageAccessToken) {
    throw new Error('Meta is not connected for this account. Connect it from Settings first.');
  }
  if (!meta.instagramBusinessId) {
    throw new Error('The connected Facebook Page has no linked Instagram professional account. Link one in Meta Business Suite, then reconnect from Settings.');
  }
  try {
    if (carouselImageUrls?.length) {
      const publicUrls = carouselImageUrls.map((u) => metaService.resolvePublicImageUrl(u));
      const { externalUrl } = await metaService.publishCarouselToInstagram({
        instagramBusinessId: meta.instagramBusinessId,
        pageAccessToken: meta.pageAccessToken,
        imageUrls: publicUrls,
        caption
      });
      return { platform: 'Instagram', account: `@${meta.instagramUsername}`, deployedAt: new Date(), externalUrl, simulated: false };
    }
    const publicImageUrl = metaService.resolvePublicImageUrl(imageUrl);
    const { externalUrl } = await metaService.publishToInstagram({
      instagramBusinessId: meta.instagramBusinessId,
      pageAccessToken: meta.pageAccessToken,
      imageUrl: publicImageUrl,
      caption
    });
    return { platform: 'Instagram', account: `@${meta.instagramUsername}`, deployedAt: new Date(), externalUrl, simulated: false };
  } catch (err) {
    if (err.message?.includes('190') || /session|token/i.test(err.message || '')) {
      throw new Error('Instagram rejected the request - the connection may have expired. Reconnect Meta from Settings.');
    }
    throw err;
  }
}

/**
 * Real X publish. `user` is the Mongoose User document - its
 * connectedAccounts.x holds the OAuth 2.0 tokens from the connect flow.
 * X access tokens only last ~2 hours, so a refresh attempt here is the
 * normal path, not a rare edge case like it is for LinkedIn/Meta.
 */
async function deployToX({ user, imageUrl, caption, carouselImageUrls }) {
  const x = user?.connectedAccounts?.x;
  if (!x?.accessToken) {
    throw new Error('X is not connected for this account. Connect it from Settings first.');
  }

  let accessToken = x.accessToken;
  const isExpiringSoon = x.expiresAt && new Date(x.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (isExpiringSoon && x.refreshToken) {
    try {
      const refreshed = await xService.refreshAccessToken(x.refreshToken);
      accessToken = refreshed.accessToken;
      user.connectedAccounts.x.accessToken = refreshed.accessToken;
      user.connectedAccounts.x.refreshToken = refreshed.refreshToken;
      user.connectedAccounts.x.expiresAt = refreshed.expiresAt;
      await user.save();
    } catch (err) {
      console.warn('[publish:X] token refresh failed, attempting with existing token:', err.message);
    }
  }

  try {
    // X allows at most 4 images per post - if a carousel has more slides
    // than that, only the first 4 are attached (clearest option: post
    // something rather than fail outright over a platform-specific cap).
    const trimmedCarousel = carouselImageUrls?.slice(0, 4);
    const { externalUrl } = await xService.createPost({
      accessToken,
      username: x.username,
      text: caption,
      ...(trimmedCarousel?.length ? { imageUrlPaths: trimmedCarousel } : { imageUrlPath: imageUrl })
    });
    return { platform: 'X', account: `@${x.username}`, deployedAt: new Date(), externalUrl, simulated: false };
  } catch (err) {
    if (err.message?.includes('401') || err.message?.includes('403')) {
      throw new Error('X rejected the request - the connection may have expired. Reconnect it from Settings.');
    }
    throw err;
  }
}

/**
 * Real YouTube publish. Unlike every other connector here, this needs an
 * actual generated video, not the still image - `videoUrl` comes from the
 * post's selected variant (see posts.controller.js#publishPost), and is
 * only populated once Step 03's video generation has completed for that
 * variant. Errors clearly rather than silently substituting the image.
 */
async function deployToYouTube({ user, videoUrl, caption, title }) {
  const yt = user?.connectedAccounts?.youtube;
  if (!yt?.accessToken) {
    throw new Error('YouTube is not connected for this account. Connect it from Settings first.');
  }
  if (!videoUrl) {
    throw new Error('This post has no generated video yet - generate one from the design step before publishing to YouTube.');
  }

  let accessToken = yt.accessToken;
  const isExpiringSoon = yt.expiresAt && new Date(yt.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (isExpiringSoon) {
    try {
      const refreshed = await youtubeService.refreshAccessToken(yt.refreshToken);
      accessToken = refreshed.accessToken;
      user.connectedAccounts.youtube.accessToken = refreshed.accessToken;
      user.connectedAccounts.youtube.expiresAt = refreshed.expiresAt;
      await user.save();
    } catch (err) {
      console.warn('[publish:YouTube] token refresh failed, attempting with existing token:', err.message);
    }
  }

  try {
    const { externalUrl } = await youtubeService.uploadVideo({ accessToken, title, description: caption, videoUrlPath: videoUrl });
    return { platform: 'YouTube', account: yt.channelTitle, deployedAt: new Date(), externalUrl, simulated: false };
  } catch (err) {
    if (err.message?.includes('401') || /invalid.*credentials/i.test(err.message || '')) {
      throw new Error('YouTube rejected the request - the connection may have expired. Reconnect it from Settings.');
    }
    throw err;
  }
}

export async function deployToPlatform(platform, payload) {
  const connector = CONNECTORS[platform];
  if (!connector) throw new Error(`No publish connector configured for "${platform}".`);
  return connector(payload);
}

export const SUPPORTED_PLATFORMS = Object.keys(CONNECTORS);
