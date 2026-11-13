/**
 * Create (or promote) an admin user directly, without going through the
 * registration UI. Useful for first-time setup on a server, CI/CD, or
 * Docker entrypoints where nobody's going to click through a signup form.
 *
 * Usage (CLI flags):
 *   node src/scripts/seedAdmin.js --email=admin@automatr.test --password=ChangeMe123 --name="Admin User"
 *
 * Usage (from server/.env instead of flags):
 *   SEED_ADMIN_EMAIL=admin@automatr.test
 *   SEED_ADMIN_PASSWORD=ChangeMe123
 *   SEED_ADMIN_NAME=Admin User
 *   then just: node src/scripts/seedAdmin.js
 *
 * Or via the npm script from server/package.json:
 *   npm run seed:admin -- --email=admin@automatr.test --password=ChangeMe123
 *
 * Behavior:
 *   - If no user exists with that email, creates a new one with role=admin.
 *   - If a user already exists with that email, promotes them to
 *     role=admin and re-activates the account (isActive=true). Their
 *     password is only changed if --password / SEED_ADMIN_PASSWORD was
 *     explicitly provided on this run.
 *   - Safe to re-run any time - it's an upsert, not a one-shot migration.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { seedIndustrySegmentsIfEmpty, isValidActiveSegment } from '../services/industrySegmentsService.js';

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const flags = parseArgs();

  const email = (flags.email || process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = flags.password || process.env.SEED_ADMIN_PASSWORD || '';
  const name = flags.name || process.env.SEED_ADMIN_NAME || 'Admin';
  const companyName = flags.company || process.env.SEED_ADMIN_COMPANY || '';
  const requestedIndustry = flags.industry || process.env.SEED_ADMIN_INDUSTRY || '';

  if (!email) {
    console.error(
      '[seed:admin] No email provided.\n' +
        'Pass --email=you@example.com --password=somethingSecure, or set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in server/.env.'
    );
    process.exit(1);
  }

  await connectDB();
  await seedIndustrySegmentsIfEmpty();

  const industry = requestedIndustry && (await isValidActiveSegment(requestedIndustry)) ? requestedIndustry : 'Technology';

  let user = await User.findOne({ email });

  if (user) {
    user.role = 'admin';
    user.isActive = true;
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }
    await user.save();
    console.log(`[seed:admin] Promoted existing user to admin: ${email}${password ? ' (password updated)' : ' (password unchanged)'}`);
  } else {
    if (!password) {
      console.error(
        `[seed:admin] No user exists with email "${email}" yet, and no password was provided to create one.\n` +
          'Pass --password=somethingSecure or set SEED_ADMIN_PASSWORD.'
      );
      await mongoose.connection.close();
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    user = await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
      company: { name: companyName, industry }
    });
    console.log(`[seed:admin] Created new admin user: ${email}`);
  }

  console.log(`[seed:admin] Done. Log in at your app's /login page with:\n  email: ${email}${password ? `\n  password: ${password}` : ''}`);

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:admin] failed:', err.message);
  process.exit(1);
});
