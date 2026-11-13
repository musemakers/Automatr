/**
 * Simple whole-site password gate, separate from the app's real user
 * login/auth system (middleware/auth.js). Meant for pre-launch situations
 * where you want NOTHING - not the API, not the built client, not even
 * robots.txt - reachable without a shared password, e.g. to keep an
 * unfinished build private while it's deployed at a public URL.
 *
 * Uses plain HTTP Basic Auth: the browser's native username/password
 * prompt. Any username works - only the password matters. Set SITE_PASSWORD
 * in the environment to override the default; unset it falls back to
 * 'ACKMG' so this works out of the box.
 *
 * Mount this before anything else in index.js (cors, static, routes) so it
 * genuinely gates everything.
 */
export function siteGate(req, res, next) {
  const password = process.env.SITE_PASSWORD || 'ACKMG';

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      decoded = '';
    }
    const separatorIndex = decoded.indexOf(':');
    const suppliedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;

    if (suppliedPassword === password) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="AUTOMATr", charset="UTF-8"');
  return res.status(401).send('Authentication required.');
}
