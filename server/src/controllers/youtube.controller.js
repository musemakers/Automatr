import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import * as youtubeService from '../services/youtubeService.js';

const STATE_PURPOSE = 'youtube_oauth';

/** [requireAuth] */
export async function getConnectUrl(req, res, next) {
  try {
    if (!youtubeService.isConfigured()) {
      return res.status(400).json({
        error: 'YouTube is not configured on this server. An admin needs to add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI in server/.env.'
      });
    }
    const state = jwt.sign({ purpose: STATE_PURPOSE, sub: req.user._id.toString(), cid: String(req.customer._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ url: youtubeService.getAuthorizationUrl(state) });
  } catch (err) {
    next(err);
  }
}

/** [public - hit directly by Google's redirect] */
export async function callback(req, res) {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const redirectTo = (status, extra = '') => res.redirect(`${clientOrigin}/settings?youtube=${status}${extra}`);

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return redirectTo('error', `&message=${encodeURIComponent('Google authorization was denied.')}`);
    if (!code || !state) return redirectTo('error', `&message=${encodeURIComponent('Missing code or state from Google.')}`);

    let payload;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return redirectTo('error', `&message=${encodeURIComponent('This connection link expired - please try again.')}`);
    }
    if (payload.purpose !== STATE_PURPOSE) return redirectTo('error');

    const { accessToken, refreshToken, expiresAt } = await youtubeService.exchangeCodeForToken(code);
    if (!refreshToken) {
      return redirectTo(
        'error',
        `&message=${encodeURIComponent('Google did not return a refresh token - disconnect any prior authorization for this app at myaccount.google.com/permissions and try connecting again.')}`
      );
    }
    const { channelId, channelTitle } = await youtubeService.fetchChannelInfo(accessToken);

    // The connection belongs to the customer workspace (not one user): the state token names it.
    const user = await Customer.findById(payload.cid); // holds connectedAccounts, same shape as before
    if (!user) return redirectTo('error', `&message=${encodeURIComponent('Customer workspace not found.')}`);

    user.connectedAccounts = user.connectedAccounts || {};
    user.connectedAccounts.youtube = { accessToken, refreshToken, expiresAt, channelId, channelTitle, connectedAt: new Date() };
    await user.save();

    return redirectTo('connected');
  } catch (err) {
    console.error('[youtube] OAuth callback failed:', err.message);
    return redirectTo('error', `&message=${encodeURIComponent(err.message || 'Something went wrong connecting YouTube.')}`);
  }
}

/** [requireAuth] */
export async function status(req, res, next) {
  try {
    const yt = req.user.connectedAccounts?.youtube;
    res.json({
      configured: youtubeService.isConfigured(),
      connected: Boolean(yt?.accessToken),
      channelTitle: yt?.channelTitle || '',
      connectedAt: yt?.connectedAt || null
    });
  } catch (err) {
    next(err);
  }
}

/** [requireAuth] */
export async function disconnect(req, res, next) {
  try {
    const user = await Customer.findById(req.customer._id);
    if (user.connectedAccounts?.youtube) {
      user.connectedAccounts.youtube = undefined;
      await user.save();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
