/**
 * Move an existing user into a customer workspace (as that customer's admin by default) and
 * move everything they created - posts, brand-library assets, AI usage log, reels - with them.
 *
 * Usage (from the server folder):
 *   npm run move-user -- --email=olivia@automatr.test --customer=olivia          # preview only
 *   npm run move-user -- --email=olivia@automatr.test --customer=olivia --apply  # do it
 *   npm run move-user -- --undo=move-user-backup-<timestamp>.json --apply        # put it back
 *
 * Options:
 *   --customer=   the target customer's name, folder/slug or id
 *   --role=       customerAdmin (default) | member | admin
 *   --workspace=  copy (default) | skip
 *                 copy: bring the user's own brand kit, competitors and social connections over to
 *                 the target customer wherever the customer has none. Connections that were copied
 *                 from this user into the old customer at migration time are removed from it.
 *   --apply       actually write. Without it nothing is changed.
 *
 * Uploaded files are not moved on disk: their URLs keep working from wherever they are.
 * A backup of what changed is written next to where you run this (move-user-backup-*.json).
 */
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User, { DEFAULT_MEMBER_PERMISSIONS, ROLES } from '../models/User.js';
import Customer from '../models/Customer.js';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import AiUsageLog from '../models/AiUsageLog.js';
import MultiSceneJob from '../models/MultiSceneJob.js';
import { unscoped } from '../tenant/context.js';

const PLATFORMS = ['linkedin', 'meta', 'x', 'youtube'];
const TOKEN_KEY = { linkedin: 'accessToken', meta: 'pageAccessToken', x: 'accessToken', youtube: 'accessToken' };
const MODELS = [['posts', Post], ['brandAssets', BrandAsset], ['usageLogs', AiUsageLog], ['reels', MultiSceneJob]];
const DEFAULT_COLORS = ['#0F2A5C', '#2E5EFF', '#EEF3FF', '#0A0E17', '#FFFFFF'];

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

async function findCustomer(query) {
  const q = String(query || '').trim();
  const all = await Customer.find({}).sort({ name: 1 });
  const list = all.map((c) => `  - ${c.name}  (folder: ${c.slug}, status: ${c.status})`).join('\n');
  if (!q) throw new Error(`Pass --customer=<name or folder>. Customers:\n${list}`);
  const lower = q.toLowerCase();
  let hits = all.filter((c) => String(c._id) === q || c.slug === lower || c.name.toLowerCase() === lower);
  if (!hits.length) hits = all.filter((c) => c.slug.includes(lower) || c.name.toLowerCase().includes(lower));
  if (hits.length !== 1) throw new Error(`${hits.length ? 'More than one customer matches' : 'No customer matches'} "${q}". Customers:\n${list}`);
  return hits[0];
}

const hasBrandKit = (kit) => {
  if (!kit) return false;
  const colorsChanged = JSON.stringify(kit.colors || []) !== JSON.stringify(DEFAULT_COLORS);
  return colorsChanged || Boolean(kit.designLanguage?.summary);
};

async function undo(file, apply) {
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Undo of: ${b.user.email} -> ${b.targetCustomer.name}`);
  for (const [label, Model] of MODELS) {
    const ids = b.moved[label] || [];
    console.log(`  ${label}: ${ids.length} back to ${b.sourceCustomer?.name || 'previous customer'}`);
    if (apply && ids.length) await unscoped(async () => await Model.updateMany({ _id: { $in: ids } }, { $set: { customer: b.sourceCustomer?._id || null } }));
  }
  if (apply) {
    await User.updateOne({ _id: b.user._id }, { $set: { customer: b.before.customer, role: b.before.role, permissions: b.before.permissions, 'company.name': b.before.companyName } });
    console.log('  user role/customer restored.');
    console.log('  Note: brand kit / social connections copied to the customer are not removed by undo.');
  } else console.log('\nPreview only - add --apply to undo.');
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  await connectDB();

  if (args.undo) {
    await unscoped(() => undo(args.undo, apply));
    return;
  }

  const email = String(args.email || '').toLowerCase().trim();
  if (!email) throw new Error('Pass --email=<user email>.');
  const role = args.role || 'customerAdmin';
  if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
  const workspace = args.workspace || 'copy';

  await unscoped(async () => {
    const user = await User.findOne({ email });
    if (!user) throw new Error(`No user with email ${email}.`);
    const target = await findCustomer(args.customer);
    const source = user.customer ? await Customer.findById(user.customer) : null;

    console.log(`\nUser:     ${user.name} <${user.email}>  role=${user.role}  customer=${source?.name || '(none)'}`);
    console.log(`Target:   ${target.name}  (folder: ${target.slug}, status: ${target.status})`);
    console.log(`New role: ${role}${role === 'customerAdmin' ? ' (can manage the team, settings, library and delivery of this customer)' : ''}\n`);
    if (target.status !== 'active') console.log(`  ! Target customer is ${target.status}; its users cannot sign in until it is active.\n`);

    // ---- content to move
    const moved = {};
    for (const [label, Model] of MODELS) {
      const docs = await Model.find({ user: user._id, customer: { $ne: target._id } }).select('_id customer').lean();
      moved[label] = docs.map((d) => String(d._id));
      console.log(`Content: ${label.padEnd(12)} ${String(docs.length).padStart(4)} to move`);
    }

    // ---- workspace data (brand kit / competitors / social connections)
    const u = user.toObject();
    const copyPlan = { brandKit: false, competitors: false, accounts: [], removeFromSource: [] };
    if (workspace === 'copy') {
      if (hasBrandKit(u.brandKit) && !target.brandKit?.designLanguage?.summary && !hasBrandKit(target.toObject().brandKit)) copyPlan.brandKit = true;
      if ((u.competitors || []).length && !(target.competitors || []).length) copyPlan.competitors = true;
      const tAcc = target.toObject().connectedAccounts || {};
      const sAcc = source?.toObject().connectedAccounts || {};
      for (const p of PLATFORMS) {
        const tok = u.connectedAccounts?.[p]?.[TOKEN_KEY[p]];
        if (!tok) continue;
        if (!tAcc[p]?.[TOKEN_KEY[p]]) copyPlan.accounts.push(p);
        if (source && sAcc[p]?.[TOKEN_KEY[p]] === tok && String(source._id) !== String(target._id)) copyPlan.removeFromSource.push(p);
      }
    }
    console.log(`\nWorkspace (${workspace}):`);
    console.log(`  brand kit -> ${copyPlan.brandKit ? 'copied to target' : 'not copied'}`);
    console.log(`  competitors -> ${copyPlan.competitors ? 'copied to target' : 'not copied'}`);
    console.log(`  social connections -> ${copyPlan.accounts.length ? copyPlan.accounts.join(', ') + ' copied to target' : 'none copied'}`);
    if (copyPlan.removeFromSource.length) console.log(`  ${source.name} currently holds this user's ${copyPlan.removeFromSource.join(', ')} connection(s) (copied at migration) - will be removed from ${source.name}`);

    if (!apply) {
      console.log('\nPreview only - nothing was changed. Add --apply to do it.');
      return;
    }

    // ---- backup, then write
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `move-user-backup-${stamp}.json`;
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          user: { _id: user._id, email: user.email },
          before: { customer: user.customer, role: user.role, permissions: user.permissions, companyName: user.company?.name || '' },
          sourceCustomer: source ? { _id: source._id, name: source.name } : null,
          targetCustomer: { _id: target._id, name: target.name },
          moved
        },
        null,
        2
      )
    );

    for (const [label, Model] of MODELS) {
      if (!moved[label].length) continue;
      const r = await Model.updateMany({ _id: { $in: moved[label] } }, { $set: { customer: target._id } });
      console.log(`  moved ${r.modifiedCount} ${label}`);
    }

    if (copyPlan.brandKit) target.brandKit = u.brandKit;
    if (copyPlan.competitors) {
      target.competitors = u.competitors;
      target.competitorsDetectedAt = u.competitorsDetectedAt || null;
    }
    for (const p of copyPlan.accounts) target.set(`connectedAccounts.${p}`, u.connectedAccounts[p]);
    if (copyPlan.brandKit || copyPlan.competitors || copyPlan.accounts.length) await target.save();
    if (copyPlan.removeFromSource.length) {
      for (const p of copyPlan.removeFromSource) source.set(`connectedAccounts.${p}`, undefined);
      await source.save();
    }

    user.customer = target._id;
    user.role = role;
    if (role === 'customerAdmin') user.permissions = { ...DEFAULT_MEMBER_PERMISSIONS, manageTeam: true, manageIndustries: false };
    user.company = { ...(user.company?.toObject?.() || {}), name: target.name };
    await user.save();

    console.log(`\nDone. ${user.email} is now ${role} of "${target.name}". Backup (for --undo): ${backupFile}`);
  });
}

main()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
