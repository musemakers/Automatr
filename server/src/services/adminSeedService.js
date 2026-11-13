import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { isValidActiveSegment } from './industrySegmentsService.js';

/**
 * Runs at every boot, but only *acts* the very first time - i.e. only if
 * the database has zero admin users. This is intentionally different from
 * the seed:admin CLI script's upsert-by-email behavior: if we re-applied
 * SEED_ADMIN_PASSWORD on every restart, it would silently overwrite a
 * password someone changed later through the app. Once any admin exists,
 * this is a no-op forever.
 */
export async function seedDefaultAdminIfNone() {
  const existingAdminCount = await User.countDocuments({ role: 'admin' });
  if (existingAdminCount > 0) return;

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@automatr.test').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const name = process.env.SEED_ADMIN_NAME || 'Admin';
  const companyName = process.env.SEED_ADMIN_COMPANY || 'AUTOMATr';
  const requestedIndustry = process.env.SEED_ADMIN_INDUSTRY || '';

  // Someone might already have an account at this exact email without the
  // admin role (e.g. registered normally first) - promote rather than
  // erroring on a duplicate-key conflict.
  let user = await User.findOne({ email });

  const industry = requestedIndustry && (await isValidActiveSegment(requestedIndustry)) ? requestedIndustry : 'Technology';

  if (user) {
    user.role = 'admin';
    user.isActive = true;
    await user.save();
    console.log(`[seed:admin] Promoted existing user "${email}" to admin (no admin existed yet).`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    passwordHash,
    role: 'admin',
    company: { name: companyName, industry }
  });

  console.log(
    `[seed:admin] No admin existed yet - created default admin account.\n` +
      `  email: ${email}\n` +
      `  password: ${password}\n` +
      `  IMPORTANT: change this password after first login (Settings), especially in production.`
  );
}
