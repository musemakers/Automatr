import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Post from '../models/Post.js';
import BrandAsset from '../models/BrandAsset.js';
import AiUsageLog from '../models/AiUsageLog.js';
import AppSetting from '../models/AppSetting.js';
import { unscoped } from '../tenant/context.js';
import { createCustomer, slugify } from './customerService.js';

const FLAG = 'migrations.multiCustomer';
const PLATFORMS = ['linkedin', 'meta', 'x', 'youtube'];
const TOKEN_KEY = { linkedin: 'accessToken', meta: 'pageAccessToken', x: 'accessToken', youtube: 'accessToken' };

/**
 * One-time upgrade from the single-workspace app to multi-customer. Safe to run on every
 * boot: it does nothing once the flag is set, and every step is idempotent anyway.
 *
 *  1. Creates the first customer (DEFAULT_CUSTOMER_NAME, default "Musemakers") if none exist.
 *     Its brand kit/competitors come from the oldest admin; each social connection comes from
 *     the oldest user who had one.
 *  2. Assigns every existing user, post, brand asset, usage log to that customer.
 *
 * Files are NOT moved: existing files stay where they are and keep working (the server still
 * serves/resolves the old flat paths). Only new files go into the customer's own folder.
 */
export async function runTenantMigration() {
  return unscoped(async () => {
    const setting = await AppSetting.findOne({ key: 'global' }).lean();
    if (setting?.migrations?.multiCustomer) return { skipped: true };

    let customer = await Customer.findOne({}).sort({ createdAt: 1 });
    let created = false;
    if (!customer) {
      const users = await User.find({}).sort({ createdAt: 1 });
      const firstAdmin = users.find((u) => u.role === 'admin') || users[0] || null;
      const name = (process.env.DEFAULT_CUSTOMER_NAME || 'Musemakers').trim();
      customer = await createCustomer({ name, slug: slugify(name), industry: firstAdmin?.company?.industry });
      if (firstAdmin) {
        const a = firstAdmin.toObject();
        customer.brandKit = a.brandKit;
        customer.competitors = a.competitors || [];
        customer.competitorsDetectedAt = a.competitorsDetectedAt || null;
      }
      const accounts = {};
      for (const p of PLATFORMS) {
        const holder = users.find((u) => u.connectedAccounts?.[p]?.[TOKEN_KEY[p]]);
        if (holder) accounts[p] = holder.toObject().connectedAccounts[p];
      }
      customer.connectedAccounts = accounts;
      await customer.save();
      created = true;
    }

    const id = customer._id;
    const unassigned = { $or: [{ customer: null }, { customer: { $exists: false } }] };
    const counts = {};
    counts.users = (await User.updateMany(unassigned, { $set: { customer: id } })).modifiedCount;
    for (const [label, Model] of [['posts', Post], ['brandAssets', BrandAsset], ['usageLogs', AiUsageLog]]) {
      counts[label] = (await Model.updateMany(unassigned, { $set: { customer: id } })).modifiedCount;
    }

    await AppSetting.updateOne({ key: 'global' }, { $set: { [FLAG]: new Date().toISOString() } }, { upsert: true });
    console.log(`[tenant] Multi-customer migration done. ${created ? `Created customer "${customer.name}". ` : ''}Assigned:`, counts);
    return { skipped: false, created, customerId: String(id), counts };
  });
}
