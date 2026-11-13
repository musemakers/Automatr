import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User, { ROLES, DEFAULT_MEMBER_PERMISSIONS } from '../models/User.js';
import Customer from '../models/Customer.js';
import { isValidActiveSegment } from '../services/industrySegmentsService.js';
import { isAgency } from '../middleware/auth.js';

const PERMISSION_KEYS = Object.keys(DEFAULT_MEMBER_PERMISSIONS);

function generateTempPassword() {
  // Readable-ish random password, e.g. "f3a9-72bd-91ke" - good enough for an
  // admin to hand off out-of-band; the user should change it after login.
  return crypto.randomBytes(6).toString('hex').match(/.{1,4}/g).join('-');
}

// ---- customer scoping ---------------------------------------------------
// Agency admins (role "admin") manage users of whichever customer they have selected (or all
// customers in the roll-up view). A customer's own admin ("customerAdmin") only ever sees and
// manages users of their own customer, and can never create/edit agency admins.
const ALLOWED_ROLES = (req) => (isAgency(req.user) ? ROLES : ['customerAdmin', 'member']);

function scopeFilter(req) {
  if (req.tenant?.all || !req.customer) return isAgency(req.user) ? {} : { customer: null, _id: null };
  return { customer: req.customer._id };
}

function canManage(req, target) {
  if (isAgency(req.user)) return true;
  return String(target.customer?._id || target.customer || '') === String(req.customer?._id || '') && target.role !== 'admin';
}

const forbidden = (res) => res.status(403).json({ error: "You can only manage people in your own workspace, and not agency admins." });

function sanitizePermissions(input = {}) {
  const out = {};
  for (const key of PERMISSION_KEYS) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

export async function listUsers(req, res, next) {
  try {
    const { search = '', role, page = 1, limit = 25 } = req.query;
    const filter = { ...scopeFilter(req) };

    if (role && ROLES.includes(role)) filter.role = role;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { email: re }, { 'company.name': re }];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 25));

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash')
        .populate('customer', 'name slug')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      User.countDocuments(filter)
    ]);

    res.json({ users, total, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash').populate('customer', 'name slug');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!canManage(req, user)) return forbidden(res);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { name, email, password, role = 'member', permissions, companyName, designation, industry, customer: customerId } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }
    if (role && !ALLOWED_ROLES(req).includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES(req).join(', ')}` });
    }

    // Which customer the new person belongs to: the agency may pick one, otherwise it is the active workspace.
    let customerDoc = req.customer;
    if (isAgency(req.user) && customerId) {
      customerDoc = await Customer.findById(customerId);
      if (!customerDoc) return res.status(400).json({ error: 'That customer does not exist.' });
    }
    if (!customerDoc) return res.status(400).json({ error: 'Choose a customer for this user first.' });

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }

    const tempPassword = password || generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    let validIndustry = 'Technology';
    if (industry && (await isValidActiveSegment(industry))) validIndustry = industry;
    else if (customerDoc.industry && (await isValidActiveSegment(customerDoc.industry))) validIndustry = customerDoc.industry; // new users inherit the customer's segment

    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      role,
      customer: customerDoc._id,
      permissions: { ...DEFAULT_MEMBER_PERMISSIONS, ...sanitizePermissions(permissions) },
      company: { name: companyName || customerDoc.name, designation: designation || '', industry: validIndustry }
    });

    const safeUser = user.toSafeJSON();
    res.status(201).json({
      user: safeUser,
      // Only ever returned once, at creation time - there's no email
      // service wired up, so the admin needs to hand this off manually.
      temporaryPassword: password ? undefined : tempPassword
    });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (!canManage(req, target)) return forbidden(res);

    const { name, email, role, permissions, isActive, companyName, designation, industry, password, customer: customerId } = req.body;

    if (role && !ALLOWED_ROLES(req).includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES(req).join(', ')}` });
    }

    // Guard: don't allow demoting/deactivating the last remaining admin -
    // otherwise the workspace could lock itself out of the admin panel.
    if ((role === 'member' || role === 'customerAdmin' || isActive === false) && target.role === 'admin') {
      const otherActiveAdmins = await User.countDocuments({
        role: 'admin',
        isActive: { $ne: false },
        _id: { $ne: target._id }
      });
      if (otherActiveAdmins === 0) {
        return res.status(400).json({ error: 'Cannot remove admin access from the last remaining admin.' });
      }
    }

    if (name !== undefined) target.name = name;
    if (email !== undefined) target.email = email.toLowerCase();
    if (role !== undefined) target.role = role;
    if (customerId !== undefined && isAgency(req.user)) {
      if (customerId === null || customerId === '') target.customer = null;
      else {
        if (!(await Customer.exists({ _id: customerId }))) return res.status(400).json({ error: 'That customer does not exist.' });
        target.customer = customerId;
      }
    }
    if (isActive !== undefined) target.isActive = isActive;
    if (permissions !== undefined) {
      target.permissions = { ...target.permissions.toObject(), ...sanitizePermissions(permissions) };
    }
    if (companyName !== undefined) target.company.name = companyName;
    if (designation !== undefined) target.company.designation = designation;
    if (industry !== undefined) {
      if (!(await isValidActiveSegment(industry))) {
        return res.status(400).json({ error: `"${industry}" is not a known active industry segment.` });
      }
      target.company.industry = industry;
    }
    if (password) {
      target.passwordHash = await bcrypt.hash(password, 10);
    }

    await target.save();
    res.json({ user: target.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'That email is already in use by another account.' });
    }
    next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: "You can't delete your own account while logged in as it." });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (!canManage(req, target)) return forbidden(res);

    if (target.role === 'admin') {
      const otherActiveAdmins = await User.countDocuments({
        role: 'admin',
        isActive: { $ne: false },
        _id: { $ne: target._id }
      });
      if (otherActiveAdmins === 0) {
        return res.status(400).json({ error: 'Cannot delete the last remaining admin.' });
      }
    }

    await target.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export function meta(req, res) {
  res.json({ roles: ALLOWED_ROLES(req), permissionKeys: PERMISSION_KEYS, canPickCustomer: isAgency(req.user) });
}
