import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import * as xService from '../services/xService.js';

// Same state-signing approach as linkedin/meta controllers, with one
// addition: X's OAuth needs PKCE, so the code_verifier generated at
// connect-time has to survive until the callback. Rather than a separate
// server-side store, it's carried right inside this same signed JWT -
// it's already tamper-evident and short-lived, so it doubles as a safe
// place to stash it.
const STATE_PURPOSE = 'x_oauth';

/** [requireAuth] */
export async function getConnectUrl(req, res, next) {
  try {
    if (!xService.isConfigured()) {
      return res.status(400).json({
        error: 'X is not configured on this server. An admin needs to add X_CLIENT_ID and X_REDIRECT_URI in server/.env.'
      });
    }
    const { codeVerifier, codeChallenge } = xService.generatePkce();
    const state = jwt.sign(
      { purpose: STATE_PURPOSE, sub: req.user._id.toString(), cid: String(req.customer._id), codeVerifier },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.json({ url: xService.getAuthorizationUrl(state, codeChallenge) });
  } catch (err) {
    next(err);
  }
}

/** [public - hit directly by X's redirect] */
export async function callback(req, res) {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const redirectTo = (status, extra = '') => res.redirect(`${clientOrigin}/settings?x=${status}${extra}`);

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return redirectTo('error', `&message=${encodeURIComponent('X authorization was denied.')}`);
    if (!code || !state) return redirectTo('error', `&message=${encodeURIComponent('Missing code or state from X.')}`);

    let payload;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return redirectTo('error', `&message=${encodeURIComponent('This connection link expired - please try again.')}`);
    }
    if (payload.purpose !== STATE_PURPOSE) return redirectTo('error');

    const { accessToken, refreshToken, expiresAt } = await xService.exchangeCodeForToken(code, payload.codeVerifier);
    const { userId, username } = await xService.fetchUserInfo(accessToken);

    // The connection belongs to the customer workspace (not one user): the state token names it.
    const user = await Customer.findById(payload.cid); // holds connectedAccounts, same shape as before
    if (!user) return redirectTo('error', `&message=${encodeURIComponent('Customer workspace not found.')}`);

    user.connectedAccounts = user.connectedAccounts || {};
    user.connectedAccounts.x = { accessToken, refreshToken, expiresAt, userId, username, connectedAt: new Date() };
    await user.save();

    return redirectTo('connected');
  } catch (err) {
    console.error('[x] OAuth callback failed:', err.message);
    return redirectTo('error', `&message=${encodeURIComponent(err.message || 'Something went wrong connecting X.')}`);
  }
}

/** [requireAuth] */
export async function status(req, res, next) {
  try {
    const x = req.user.connectedAccounts?.x;
    res.json({
      configured: xService.isConfigured(),
      connected: Boolean(x?.accessToken),
      username: x?.username || '',
      connectedAt: x?.connectedAt || null
    });
  } catch (err) {
    next(err);
  }
}

/** [requireAuth] */
export async function disconnect(req, res, next) {
  try {
    const user = await Customer.findById(req.customer._id);
    if (user.connectedAccounts?.x) {
      user.connectedAccounts.x = undefined;
      await user.save();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
