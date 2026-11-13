// One-off: strips the Black-bar check and Colour check blocks out of every SAVED image pipeline
// (the agency default and any per-customer ones) and re-wires the graph around them, so the AI Block
// Architecture page and the image router stop running those checks.
//
// Run from server/ :
//   node scripts/removeImageQaBlocks.js            DRY RUN - lists what would change
//   node scripts/removeImageQaBlocks.js --apply    saves a backup file, then rewrites the pipelines
//   node scripts/removeImageQaBlocks.js --restore <backup file>
// Back up MongoDB first. Reads MONGODB_URI (or MONGO_URI). Restart the server afterwards (the plan is cached briefly).
import 'dotenv/config';
import fs from 'node:fs';
import mongoose from 'mongoose';
import AiPipeline from '../src/models/AiPipeline.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const restoreFile = args.includes('--restore') ? args[args.indexOf('--restore') + 1] : null;
const QA = new Set(['qa.blackbars', 'qa.colour']);

function strip(doc) {
  const removed = doc.nodes.filter((n) => QA.has(n.type)).map((n) => n.id);
  if (!removed.length) return null;
  let edges = (doc.edges || []).map((e) => ({ ...e }));
  for (const id of removed) {
    const ins = edges.filter((e) => e.to === id);
    const outs = edges.filter((e) => e.from === id);
    edges = edges.filter((e) => e.to !== id && e.from !== id);
    for (const i of ins) for (const o of outs) {
      const fromPort = i.fromPort === 'fail' ? 'fail' : 'out';
      const e = { id: `${i.from}-${fromPort}-${o.to}`, from: i.from, fromPort, to: o.to };
      if (!edges.some((x) => x.id === e.id)) edges.push(e);
    }
  }
  // the output block moves left into the gap the checks leave (cosmetic)
  const nodes = doc.nodes.filter((n) => !QA.has(n.type)).map((n) => ({ ...n }));
  const model = Math.max(0, ...nodes.filter((n) => String(n.type).startsWith('model.')).map((n) => n.x || 0));
  for (const n of nodes) if (n.type === 'output.image' && (n.x || 0) > model + 250) n.x = model + 250;
  return { removed, nodes, edges };
}

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const col = AiPipeline.collection;
try {
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
    for (const d of backup.docs) await col.updateOne({ _id: new mongoose.Types.ObjectId(d._id) }, { $set: { nodes: d.nodes, edges: d.edges } });
    console.log(`Restored ${backup.docs.length} pipeline(s) from ${restoreFile}`);
  } else {
    const docs = await col.find({ workflow: 'image' }).toArray();
    const backup = [];
    let changed = 0;
    for (const d of docs) {
      const out = strip(d);
      const label = d.customer ? `customer ${d.customer}` : 'agency default';
      if (!out) { console.log(`${label}: no quality-check blocks, unchanged`); continue; }
      changed++;
      console.log(`${label}: removing ${out.removed.join(', ')}`);
      backup.push({ _id: String(d._id), nodes: d.nodes, edges: d.edges });
      if (apply) await col.updateOne({ _id: d._id }, { $set: { nodes: out.nodes, edges: out.edges } });
    }
    if (apply && backup.length) {
      const file = `image-pipeline-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(file, JSON.stringify({ docs: backup }));
      console.log(`Updated ${changed} pipeline(s). Backup: ${file} (undo with --restore ${file}). Restart the server.`);
    } else {
      console.log(apply ? 'Nothing to change.' : `Dry run: ${changed} of ${docs.length} saved image pipeline(s) would change. Re-run with --apply.`);
    }
  }
} finally {
  await mongoose.disconnect();
}
