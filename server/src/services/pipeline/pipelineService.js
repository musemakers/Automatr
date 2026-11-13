import AiPipeline from '../../models/AiPipeline.js';
import { currentCustomerId } from '../../tenant/context.js';
import { compile, defaultGraph, WORKFLOWS } from './blocks.js';
import { makeCustomProvider } from './customProvider.js';

// Loads the saved AI block graph for the active customer (own pipeline, else the agency default),
// compiles it to a plan, and caches it briefly. When nothing is saved, getPlan() returns null and
// the generation code behaves exactly as it did before this feature existed.

const TTL_MS = 15000;
const cache = new Map(); // `${scope}:${workflow}` -> { at, plan }
const registry = new Map(); // custom provider key -> provider module

export const invalidate = () => cache.clear();

/** Provider module for a 'custom:...' key from any compiled plan (used by the routers). */
export const customProvider = (key) => registry.get(key) || null;

function register(plan) {
  for (const [key, cfg] of Object.entries(plan.custom || {})) registry.set(key, makeCustomProvider(cfg));
}

async function loadStored(workflow, customerId) {
  return AiPipeline.findOne({ workflow, customer: customerId || null }).lean();
}

/** The compiled plan in force for this request's customer, or null if no pipeline is saved. */
export async function getPlan(workflow) {
  const cid = currentCustomerId();
  const ck = `${cid || 'global'}:${workflow}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;

  let plan = null;
  try {
    let doc = cid ? await loadStored(workflow, cid) : null;
    let scope = cid || 'global';
    if (!doc) { doc = await loadStored(workflow, null); scope = 'global'; }
    if (doc) {
      const res = compile(workflow, { nodes: doc.nodes, edges: doc.edges }, scope);
      if (res.plan) { plan = res.plan; register(plan); }
      else console.warn(`[pipeline] saved ${workflow} pipeline is invalid, ignoring it:`, res.errors.join(' | '));
    }
  } catch (err) {
    console.warn('[pipeline] could not load pipeline, using built-in behaviour:', err.message);
  }
  cache.set(ck, { at: Date.now(), plan });
  return plan;
}

/** Graph to show in the editor for a scope: own saved, else inherited global, else built-in default. */
export async function effective(workflow, customerId, settings) {
  if (customerId) {
    const own = await loadStored(workflow, customerId);
    if (own) return { graph: { nodes: own.nodes, edges: own.edges }, source: 'custom', updatedAt: own.updatedAt, updatedBy: own.updatedBy };
  }
  const global = await loadStored(workflow, null);
  if (global) return { graph: { nodes: global.nodes, edges: global.edges }, source: customerId ? 'inherited' : 'custom', updatedAt: global.updatedAt, updatedBy: global.updatedBy };
  return { graph: defaultGraph(workflow, settings), source: 'default' };
}

export async function save(workflow, graph, customerId, updatedBy) {
  if (!WORKFLOWS[workflow]) throw Object.assign(new Error('Unknown workflow.'), { status: 404 });
  const clean = {
    nodes: (graph.nodes || []).map((n) => ({ id: n.id, type: n.type, x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0), config: n.config && typeof n.config === 'object' ? n.config : {} })),
    edges: (graph.edges || []).map((e) => ({ id: String(e.id || `${e.from}-${e.fromPort || 'out'}-${e.to}`).slice(0, 120), from: e.from, fromPort: e.fromPort === 'fail' ? 'fail' : 'out', to: e.to }))
  };
  const doc = await AiPipeline.findOneAndUpdate(
    { workflow, customer: customerId || null },
    { $set: { ...clean, updatedBy: updatedBy || '' } },
    { upsert: true, new: true }
  ).lean();
  invalidate();
  return doc;
}

export async function clear(workflow, customerId) {
  await AiPipeline.deleteOne({ workflow, customer: customerId || null });
  invalidate();
}
