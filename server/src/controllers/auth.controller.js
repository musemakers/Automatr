import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import { sessionPayload } from '../services/customerService.js';
import { isAgency } from '../middleware/auth.js';
import { getGroupedActiveSegments, getFlatActiveSegmentNames, isValidActiveSegment } from '../services/industrySegmentsService.js';
import { signToken } from '../utils/token.js';
import { emailConfigured, appUrl, sendPasswordResetEmail, sendPasswordChangedEmail } from '../services/emailService.js';

// The workspace a freshly logged-in user lands in: their own customer, or - for agency admins
// without one - the oldest active customer (they can switch afterwards).
async function landingCustomer(user) {
  if (user.customer) return Customer.findById(user.customer);
  if (isAgency(user)) return Customer.findOne({ status: 'active' }).sort({ createdAt: 1 });
  return null;
}

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function register(req, res, next) {
  try {
    const { name, email, password, companyName, designation, industry } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    // Accounts are normally created by an admin (Admin -> Team / Customers). Public sign-up is
    // closed unless this is the very first account ever (bootstrap) or the operator explicitly
    // opens it for ONE customer with ALLOW_PUBLIC_REGISTRATION=true + PUBLIC_REGISTRATION_CUSTOMER=<slug>.
    const noUsersYet = (await User.estimatedDocumentCount()) === 0;
    let joinCustomer = null;
    if (!noUsersYet) {
      if (process.env.ALLOW_PUBLIC_REGISTRATION !== 'true' || !process.env.PUBLIC_REGISTRATION_CUSTOMER) {
        return res.status(403).json({ error: 'Sign-up is by invitation. Ask your admin to create your account.' });
      }
      joinCustomer = await Customer.findOne({ slug: process.env.PUBLIC_REGISTRATION_CUSTOMER, status: 'active' });
      if (!joinCustomer) return res.status(403).json({ error: 'Sign-up is currently unavailable.' });
    } else {
      joinCustomer = await Customer.findOne({ status: 'active' }).sort({ createdAt: 1 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Bootstrap: the very first account ever created becomes an admin so
    // there's always a way in to the admin panel without touching the
    // database by hand. After that, only emails explicitly listed in
    // ADMIN_EMAILS (server/.env) are auto-promoted; everyone else starts
    // as a regular member and an existing admin can promote them later.
    const isFirstEverUser = (await User.estimatedDocumentCount()) === 0;
    const adminEmails = parseAdminEmails();
    // Public sign-ups into a customer are never admins; only the bootstrap account is.
    const role = isFirstEverUser || (!joinCustomer || noUsersYet ? adminEmails.includes(normalizedEmail) : false) ? 'admin' : 'member';

    const validIndustry = (await isValidActiveSegment(industry)) ? industry : 'Technology';

    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role,
      customer: joinCustomer?._id || null,
      company: {
        name: companyName || '',
        designation: designation || '',
        industry: validIndustry
      }
    });

    const token = signToken(user);
    res.status(201).json({ token, ...(await sessionPayload(user, joinCustomer)) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'This account has been disabled. Contact your workspace admin.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const customer = await landingCustomer(user);
    if (!isAgency(user)) {
      if (!customer) return res.status(403).json({ error: 'Your account is not assigned to a customer workspace. Contact your agency admin.' });
      if (customer.status !== 'active') return res.status(403).json({ error: `This workspace is ${customer.status}. Contact your agency admin.` });
    }

    const token = signToken(user);
    res.json({ token, ...(await sessionPayload(user, customer)) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    res.json(await sessionPayload(req.user, req.customer));
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req, res, next) {
  try {
    const { name, companyName, designation, industry } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
      req.user.name = name.trim();
    }
    if (companyName !== undefined) req.user.company.name = companyName;
    if (designation !== undefined) req.user.company.designation = designation;

    if (industry !== undefined) {
      const valid = await isValidActiveSegment(industry);
      if (!valid) {
        return res.status(400).json({ error: `"${industry}" is not a known active industry segment.` });
      }
      req.user.company.industry = industry;
    }

    await req.user.save();
    res.json(await sessionPayload(req.user, req.customer));
  } catch (err) {
    next(err);
  }
}

export async function industries(_req, res, next) {
  try {
    const [groups, flat] = await Promise.all([getGroupedActiveSegments(), getFlatActiveSegmentNames()]);
    // Always alphabetical: the groups, and the segments inside each group.
    const alpha = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    const sortedGroups = (groups || []).map((g) => ({ ...g, items: [...(g.items || [])].sort(alpha) })).sort((a, b) => alpha(a.group, b.group));
    res.json({ industries: [...(flat || [])].sort(alpha), groups: sortedGroups });
  } catch (err) {
    next(err);
  }
}

// ---- Forgot / reset password ----------------------------------------------------------------
const RESET_TTL_MIN = 60;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** POST /auth/forgot-password { email } - always answers the same way so it can't be used to probe accounts. */
export async function forgotPassword(req, res, next) {
  try {
    if (!emailConfigured()) {
      return res.status(503).json({ error: 'Password reset by email is not set up yet. Please ask your admin to reset your password.' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
    if (!email) return res.status(400).json({ error: 'Enter your email address.' });

    const user = await User.findOne({ email });
    // Silently skip unknown / disabled accounts and throttle repeat requests (1 per minute per account).
    if (!user || user.isActive === false) return res.json(generic);
    if (user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < 60 * 1000) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = sha256(token);
    user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);
    user.resetRequestedAt = new Date();
    await user.save();

    const resetUrl = `${appUrl()}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl, expiresIn: `${RESET_TTL_MIN} minutes` });
    } catch (err) {
      console.error('[auth] reset email failed:', err.message);
      return res.status(502).json({ error: 'We could not send the email right now. Please try again shortly or contact your admin.' });
    }
    res.json(generic);
  } catch (err) {
    next(err);
  }
}

/** POST /auth/reset-password { token, password } */
export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'The reset link or new password is missing.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' });

    const user = await User.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: new Date() } });
    if (!user || user.isActive === false) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }
    user.passwordHash = await bcrypt.hash(String(password), 10);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    await user.save();

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) => console.error('[auth] password-changed email failed:', err.message));
    res.json({ ok: true, message: 'Your password has been updated. You can sign in now.' });
  } catch (err) {
    next(err);
  }
}

/** GET /auth/forgot-password/status - lets the login page know whether to show the link. */
export function resetAvailable(_req, res) {
  res.json({ enabled: emailConfigured() });
}
