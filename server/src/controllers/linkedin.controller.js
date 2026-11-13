import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import * as linkedinService from '../services/linkedinService.js';

// The OAuth "connect" click is a normal authenticated API call (bearer
// token in the Authorization header, like everything else in this app),
// but the actual redirect to LinkedIn - and LinkedIn's redirect back to our
// callback - are full browser navigations that can't carry that header.
// So we identify the user across that round trip by signing their id into
// the `state` param LinkedIn is required to echo back verbatim. It's
// short-lived (10 min, plenty for a login flow) and tamper-evident (HMAC
// with the same JWT_SECRET already used for session tokens), which avoids
// needing any server-side session storage for this.
const STATE_PURPOSE = 'linkedin_oauth';

/** [requireAuth] Returns the URL the client should navigate the browser to. */
export async function getConnectUrl(req, res, next) {
  try {
    if (!linkedinService.isConfigured()) {
      return res.status(400).json({
        error: 'LinkedIn is not configured on this server. An admin needs to add LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and LINKEDIN_REDIRECT_URI in server/.env.'
      });
    }
    const state = jwt.sign({ purpose: STATE_PURPOSE, sub: req.user._id.toString(), cid: String(req.customer._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ url: linkedinService.getAuthorizationUrl(state) });
  } catch (err) {
    next(err);
  }
}

/**
 * [public - hit directly by LinkedIn's redirect, not our SPA] Exchanges the
 * code for tokens, fetches the member's identity, and saves the connection
 * on their User document. Always ends in a redirect back to the client app
 * (success or failure) rather than a JSON response, since there's no SPA
 * code running to receive one at this point in the flow.
 */
export async function callback(req, res) {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const redirectTo = (status, extra = '') => res.redirect(`${clientOrigin}/settings?linkedin=${status}${extra}`);

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return redirectTo('error', `&message=${encodeURIComponent('LinkedIn authorization was denied.')}`);
    if (!code || !state) return redirectTo('error', `&message=${encodeURIComponent('Missing code or state from LinkedIn.')}`);

    let payload;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return redirectTo('error', `&message=${encodeURIComponent('This connection link expired - please try again.')}`);
    }
    if (payload.purpose !== STATE_PURPOSE) return redirectTo('error');

    const { accessToken, refreshToken, expiresAt } = await linkedinService.exchangeCodeForToken(code);
    const { personURN, name, email } = await linkedinService.fetchUserInfo(accessToken);

    // The connection belongs to the customer workspace (not one user): the state token names it.
    const user = await Customer.findById(payload.cid); // holds connectedAccounts, same shape as before
    if (!user) return redirectTo('error', `&message=${encodeURIComponent('Customer workspace not found.')}`);

    user.connectedAccounts = user.connectedAccounts || {};
    user.connectedAccounts.linkedin = { accessToken, refreshToken, expiresAt, personURN, name, email, connectedAt: new Date() };
    await user.save();

    return redirectTo('connected');
  } catch (err) {
    console.error('[linkedin] OAuth callback failed:', err.message);
    return redirectTo('error', `&message=${encodeURIComponent(err.message || 'Something went wrong connecting LinkedIn.')}`);
  }
}

/** [requireAuth] Redacted status - never returns the actual tokens. */
export async function status(req, res, next) {
  try {
    const li = req.user.connectedAccounts?.linkedin;
    res.json({
      configured: linkedinService.isConfigured(),
      connected: Boolean(li?.accessToken),
      name: li?.name || '',
      connectedAt: li?.connectedAt || null
    });
  } catch (err) {
    next(err);
  }
}

/** [requireAuth] */
export async function disconnect(req, res, next) {
  try {
    const user = await Customer.findById(req.customer._id);
    if (user.connectedAccounts?.linkedin) {
      user.connectedAccounts.linkedin = undefined;
      await user.save();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
