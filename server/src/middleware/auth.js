import mongoose from 'mongoose';
import { verifyToken } from '../utils/token.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import { runWithTenant } from '../tenant/context.js';

// Customer-owned workspace fields. Historically these lived on the User; they now
// live on the Customer, but a lot of code (AI services, publish connectors,
// controllers) still reads/writes them as req.user.brandKit etc. attachCustomerView
// makes req.user transparently read from - and save to - the active customer, so
// that code keeps working unchanged.
const WORKSPACE_FIELDS = ['brandKit', 'competitors', 'competitorsDetectedAt', 'connectedAccounts'];

export function attachCustomerView(user, customer) {
  user.$customerView = customer;
  for (const field of WORKSPACE_FIELDS) {
    Object.defineProperty(user, field, {
      configurable: true,
      enumerable: true,
      get: () => customer[field],
      set: (v) => {
        customer[field] = v;
      }
    });
  }
  const origMarkModified = user.markModified.bind(user);
  user.markModified = (path, ...rest) => {
    if (WORKSPACE_FIELDS.includes(String(path).split('.')[0])) return customer.markModified(path, ...rest);
    return origMarkModified(path, ...rest);
  };
  const origSave = user.save.bind(user);
  user.save = async (...args) => {
    if (customer.isModified()) await customer.save();
    return origSave(...args);
  };
}

export const isAgency = (user) => user?.role === 'admin';
export const isStaff = (user) => user?.role === 'admin' || user?.role === 'customerAdmin';

function wantsAllCustomers(req) {
  // "All customers" is a read-only roll-up for agency admins on admin pages.
  return req.headers['x-customer-id'] === 'all' && req.method === 'GET' && (req.originalUrl || '').startsWith('/api/admin');
}

async function resolveCustomer(req, user) {
  if (isAgency(user)) {
    const requested = req.headers['x-customer-id'];
    if (requested && requested !== 'all') {
      if (!mongoose.isValidObjectId(requested)) return { error: [400, 'Invalid customer id.'] };
      const c = await Customer.findById(requested);
      // A workspace that was deleted (the browser still remembers it): fall through to the default workspace.
      if (c) return { customer: c };
    }
    if (wantsAllCustomers(req)) return { all: true };
    // Default workspace: the admin's own customer, else the oldest active one.
    const c = (user.customer && (await Customer.findById(user.customer))) || (await Customer.findOne({ status: 'active' }).sort({ createdAt: 1 }));
    if (!c) return { all: true, noCustomers: true };
    return { customer: c };
  }
  if (!user.customer) return { error: [403, 'Your account is not assigned to a customer workspace. Contact your agency admin.'] };
  const c = await Customer.findById(user.customer);
  if (!c) return { error: [403, 'Your customer workspace no longer exists. Contact your agency admin.'] };
  if (c.status !== 'active') return { error: [403, `This workspace is ${c.status}. Contact your agency admin.`] };
  return { customer: c };
}

export async function requireAuth(req, res, next) {
  let user;
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const payload = verifyToken(token);
    user = await User.findById(payload.sub);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  try {
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'This account has been disabled. Contact your workspace admin.' });
    }

    const resolved = await resolveCustomer(req, user);
    if (resolved.error) return res.status(resolved.error[0]).json({ error: resolved.error[1] });

    const customer = resolved.customer || null;
    if (customer) attachCustomerView(user, customer);

    req.user = user;
    req.customer = customer;
    req.tenant = { customerId: customer ? String(customer._id) : null, customer, all: Boolean(resolved.all) };
    // Everything downstream (mongoose plugin, settings, storage) reads the tenant
    // from this context. multer breaks async-context propagation; middleware/upload.js
    // re-enters it from req.tenant.
    return runWithTenant(req.tenant, () => next());
  } catch (err) {
    return next(err);
  }
}

/** Agency admin only (the agency's own staff): customers, global pricing, cross-customer data. */
export function requireAgency(req, res, next) {
  if (!isAgency(req.user)) {
    return res.status(403).json({ error: 'Agency admin access required.' });
  }
  next();
}

/** Agency admin OR the customer's own admin: settings/library/team of the active customer. */
export function requireStaff(req, res, next) {
  if (!isStaff(req.user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

/** Kept for existing imports: "admin" means agency admin. */
export const requireAdmin = requireAgency;

/**
 * Must run after requireAuth. Restricts a route to admins (agency or customer),
 * or members who have the named permission flag set (req.user.permissions[permissionKey]).
 */
export function requirePermission(permissionKey) {
  return function permissionMiddleware(req, res, next) {
    if (isStaff(req.user)) return next();
    if (req.user?.permissions?.[permissionKey]) return next();
    return res.status(403).json({ error: `You don't have the "${permissionKey}" permission for this action.` });
  };
}
