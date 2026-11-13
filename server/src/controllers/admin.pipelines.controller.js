import { currentCustomerId, currentCustomer } from '../tenant/context.js';
import { getSettings, getGlobalSettings } from '../services/appSettingsService.js';
import { providerStatus } from '../services/ai/router.js';
import { providerStatus as videoProviderStatus } from '../services/ai/videoRouter.js';
import { catalog, compile, WORKFLOWS } from '../services/pipeline/blocks.js';
import * as pipelines from '../services/pipeline/pipelineService.js';

// AI Block Architecture admin API. Agency admins only (routes enforce it), except /status.
// scope=customer (default) edits the selected customer's pipeline; scope=global edits the
// agency-wide default that customers without their own pipeline inherit.

const scopeOf = (req) => (req.query.scope === 'global' ? 'global' : 'customer');
const scopeKey = (req) => (scopeOf(req) === 'global' ? 'global' : String(currentCustomerId() || 'global'));
const customerIdFor = (req) => (scopeOf(req) === 'global' ? null : currentCustomerId() || null);
const checkWorkflow = (req) => {
  if (!WORKFLOWS[req.params.workflow]) throw Object.assign(new Error('Unknown workflow.'), { status: 404 });
  return req.params.workflow;
};
const envStatus = (graph) => {
  const out = {};
  for (const n of graph?.nodes || []) {
    if (n?.type === 'model.custom' && n.config?.apiKeyEnv) out[n.id] = Boolean(process.env[String(n.config.apiKeyEnv)]);
  }
  return out;
};

export async function getPipelines(req, res, next) {
  try {
    const scope = scopeOf(req);
    const customerId = customerIdFor(req);
    const settings = scope === 'global' ? await getGlobalSettings() : await getSettings();
    const workflows = {};
    for (const wf of Object.keys(WORKFLOWS)) {
      const eff = await pipelines.effective(wf, customerId, settings);
      const result = compile(wf, eff.graph, scopeKey(req));
      workflows[wf] = {
        ...eff,
        errors: result.errors,
        warnings: result.warnings,
        summary: result.summary,
        customKeys: envStatus(eff.graph)
      };
    }
    const c = currentCustomer?.();
    res.json({
      scope,
      customer: scope === 'customer' && c ? { id: String(c._id || c.id), name: c.name } : null,
      catalog: catalog(),
      providers: { ...providerStatus(), ...videoProviderStatus() },
      workflows
    });
  } catch (err) { next(err); }
}

export async function previewPipeline(req, res, next) {
  try {
    const wf = checkWorkflow(req);
    const graph = { nodes: req.body?.nodes, edges: req.body?.edges };
    const r = compile(wf, graph, scopeKey(req));
    res.json({ errors: r.errors, warnings: r.warnings, summary: r.summary, customKeys: envStatus(graph) });
  } catch (err) { next(err); }
}

export async function putPipeline(req, res, next) {
  try {
    const wf = checkWorkflow(req);
    const graph = { nodes: req.body?.nodes, edges: req.body?.edges };
    const r = compile(wf, graph, scopeKey(req));
    if (r.errors.length) return res.status(400).json({ message: r.errors[0], errors: r.errors, warnings: r.warnings });
    await pipelines.save(wf, graph, customerIdFor(req), req.user?.email || '');
    res.json({ ok: true, errors: [], warnings: r.warnings, summary: r.summary });
  } catch (err) { next(err); }
}

export async function deletePipeline(req, res, next) {
  try {
    const wf = checkWorkflow(req);
    await pipelines.clear(wf, customerIdFor(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** Which workflows are driven by a saved pipeline for the active customer (any staff may ask). */
export async function pipelineStatus(_req, res, next) {
  try {
    const managed = {};
    for (const wf of Object.keys(WORKFLOWS)) managed[wf] = Boolean(await pipelines.getPlan(wf));
    res.json({ managed });
  } catch (err) { next(err); }
}
