// One-off: recalculate estimatedCostUsd on past Veo usage rows at the corrected rate.
// DRY RUN by default. Usage (from server/):  node scripts/recalcVeoUsage.js [--apply] [--rate 0.08] [--model-contains lite]
// Back up MongoDB first. Only touches type:'video', provider:'veo' rows that have videoSeconds.
import 'dotenv/config';
import mongoose from 'mongoose';
import AiUsageLog from '../src/models/AiUsageLog.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const rate = Number(arg('--rate', '0.08'));
const modelContains = arg('--model-contains', 'lite').toLowerCase();

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
// Use the raw collection so the tenant plugin doesn't scope this to one customer - we need every customer's rows.
const col = AiUsageLog.collection;
const filter = { type: 'video', provider: 'veo', videoSeconds: { $gt: 0 }, model: { $regex: modelContains, $options: 'i' } };
const rows = await col.find(filter).toArray();
let before = 0, after = 0, changed = 0;
const ops = [];
for (const r of rows) {
  const attempts = r.attempts > 0 ? r.attempts : 1;
  const unit = Math.round(r.videoSeconds * rate * 1e6) / 1e6; // cost of one attempt
  const next = Math.round(unit * attempts * 1e6) / 1e6;
  before += r.estimatedCostUsd || 0; after += next;
  if (Math.abs((r.estimatedCostUsd || 0) - next) > 1e-9) {
    changed++;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { estimatedCostUsd: next, unitCostUsd: unit } } } });
  }
}
console.log(`${rows.length} Veo rows matched, ${changed} need changes. Total $${before.toFixed(4)} -> $${after.toFixed(4)} @ $${rate}/sec`);
if (apply && ops.length) { const res = await col.bulkWrite(ops); console.log('Updated', res.modifiedCount); }
else console.log(apply ? 'Nothing to update.' : 'Dry run only. Re-run with --apply to write.');
await mongoose.disconnect();
