import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import * as metaService from '../services/metaService.js';

// Same state-signing approach as linkedin.controller.js - see that file's
// top comment for why this is needed (the connect click is an authenticated
// API call, but the actual OAuth redirect and callback are full browser
// navigations that can't carry our normal Authorization header).
const STATE_PURPOSE = 'meta_oauth';

/** [requireAuth] */
export async function getConnectUrl(req, res, next) {
  try {
    if (!metaService.isConfigured()) {
      return res.status(400).json({
        error: 'Meta is not configured on this server. An admin needs to add META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI in server/.env.'
      });
    }
    const state = jwt.sign({ purpose: STATE_PURPOSE, sub: req.user._id.toString(), cid: String(req.customer._id) }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ url: metaService.getAuthorizationUrl(state) });
  } catch (err) {
    next(err);
  }
}

/**
 * [public - hit directly by Meta's redirect] Exchanges the code for a
 * long-lived user token, finds the Page the user manages (auto-selecting
 * the first if they manage more than one - see the note in Settings about
 * this being a current limitation), resolves any linked Instagram
 * professional account, and saves the connection. Always redirects back to
 * the client app rather than returning JSON, same as the LinkedIn callback.
 */
export async function callback(req, res) {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const redirectTo = (status, extra = '') => res.redirect(`${clientOrigin}/settings?meta=${status}${extra}`);

  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return redirectTo('error', `&message=${encodeURIComponent('Meta authorization was denied.')}`);
    if (!code || !state) return redirectTo('error', `&message=${encodeURIComponent('Missing code or state from Meta.')}`);

    let payload;
    try {
      payload = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return redirectTo('error', `&message=${encodeURIComponent('This connection link expired - please try again.')}`);
    }
    if (payload.purpose !== STATE_PURPOSE) return redirectTo('error');

    const { accessToken: shortLivedToken } = await metaService.exchangeCodeForToken(code);
    const { accessToken: userAccessToken, expiresIn } = await metaService.getLongLivedUserToken(shortLivedToken);

    const pages = await metaService.fetchManagedPages(userAccessToken);
    if (pages.length === 0) {
      return redirectTo(
        'error',
        `&message=${encodeURIComponent('No Facebook Page found for this account - you need to manage at least one Page to connect.')}`
      );
    }

    // MVP: auto-select the first Page. If someone manages multiple Pages
    // and wants a different one, that needs a page-picker step this
    // doesn't have yet - disconnect and reconnect after adjusting which
    // Page comes first in your Meta account isn't ideal, but works for now.
    const page = pages[0];
    const igAccount = await metaService.fetchLinkedInstagramAccount(page.id, page.access_token).catch(() => null);

    // The connection belongs to the customer workspace (not one user): the state token names it.
    const user = await Customer.findById(payload.cid); // holds connectedAccounts, same shape as before
    if (!user) return redirectTo('error', `&message=${encodeURIComponent('Customer workspace not found.')}`);

    user.connectedAccounts = user.connectedAccounts || {};
    user.connectedAccounts.meta = {
      userAccessToken,
      expiresAt: new Date(Date.now() + (expiresIn || 0) * 1000),
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      instagramBusinessId: igAccount?.id || '',
      instagramUsername: igAccount?.username || '',
      connectedAt: new Date()
    };
    await user.save();

    return redirectTo('connected');
  } catch (err) {
    console.error('[meta] OAuth callback failed:', err.message);
    return redirectTo('error', `&message=${encodeURIComponent(err.message || 'Something went wrong connecting Meta.')}`);
  }
}

/** [requireAuth] Redacted status - never returns the actual tokens. */
export async function status(req, res, next) {
  try {
    const meta = req.user.connectedAccounts?.meta;
    res.json({
      configured: metaService.isConfigured(),
      connected: Boolean(meta?.pageAccessToken),
      pageName: meta?.pageName || '',
      instagramUsername: meta?.instagramUsername || '',
      connectedAt: meta?.connectedAt || null
    });
  } catch (err) {
    next(err);
  }
}

/** [requireAuth] */
export async function disconnect(req, res, next) {
  try {
    const user = await Customer.findById(req.customer._id);
    if (user.connectedAccounts?.meta) {
      user.connectedAccounts.meta = undefined;
      await user.save();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
