// AI Block Architecture - the block catalog, the built-in default graphs, and the compiler that
// turns a drawn graph into the plan the generation code actually follows.
//
// A graph is { nodes: [{ id, type, x, y, config }], edges: [{ id, from, fromPort, to }] }.
//   - Edges leave a block's "out" port (the normal flow) or - model blocks only - its "fail"
//     port ("if this model fails, try the next one").
//   - The MAIN PATH is every block reachable from an input along "out" edges that also reaches
//     an output. Blocks on it are live; blocks off it are ignored (and reported as warnings).
//   - The model block on the main path is the PRIMARY model. Model blocks chained from it with
//     "fail" edges are the FALLBACKS, tried in order.
//   - QA blocks on the main path switch those checks on; remove the block and the check is off.
//   - Prompt blocks on the main path (before the model) change the prompt the model receives.

export const WORKFLOWS = {
  image: { label: 'Image generation', modelKind: 'image', output: 'output.image', blurb: 'Every image the app creates: design images, image options, format ports, hero/headline edits.' },
  video: { label: 'Video generation', modelKind: 'video', output: 'output.video', blurb: 'Single-variant videos (text-to-video and image-to-video).' },
  copy: { label: 'Copy / text', modelKind: 'text', output: 'output.text', blurb: 'Captions, headlines, copy directions, suggestions and other text.' }
};

export const TEXT_PROVIDERS = { openai: 'OpenAI GPT', anthropic: 'Anthropic Claude', gemini: 'Google Gemini' };
export const IMAGE_PROVIDERS = { openai: 'OpenAI GPT Image', gemini: 'Google Gemini', seedream: 'ByteDance Seedream' };
export const VIDEO_PROVIDERS = { veo: 'Google Veo', kling: 'Kling', runway: 'Runway', seedance: 'ByteDance Seedance' };
const PROVIDERS_BY_KIND = { text: TEXT_PROVIDERS, image: IMAGE_PROVIDERS, video: VIDEO_PROVIDERS };

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

const ALL = ['image', 'video', 'copy'];

export const BLOCKS = [
  // ---- inputs
  { type: 'input.prompt', group: 'Inputs', label: 'Brief / prompt', desc: 'The text the model receives: the brief, brand voice and instructions built by the app.', ports: { in: false, out: true }, workflows: ALL, fields: [] },
  { type: 'input.image', group: 'Inputs', label: 'Input image', desc: 'A reference, product or source image sent along with the prompt (when the step has one).', ports: { in: false, out: true }, workflows: ['image', 'video'], fields: [] },
  // ---- built-in steps (shown so the architecture is exact; not editable)
  { type: 'sys.promptBuilder', group: 'Built-in steps', label: 'Prompt builder', desc: 'Built-in. Combines the brief with brand kit, colour rules, canvas rules and references into the final prompt.', ports: { in: true, out: true }, workflows: ALL, fixed: true, fields: [] },
  // ---- AI models
  { type: 'model.text', group: 'AI models', label: 'Text model', desc: 'A built-in text model (GPT, Claude or Gemini).', kind: 'text', ports: { in: true, out: true, fail: true }, workflows: ['copy'],
    fields: [{ key: 'provider', label: 'Model', type: 'select', options: opts(TEXT_PROVIDERS), default: 'openai' },
             { key: 'rotate', label: 'Spread across models', type: 'checkbox', default: false, help: 'Copy only: give each copy direction to a different model in the fallback chain, for variety.', only: ['copy'] }] },
  { type: 'model.image', group: 'AI models', label: 'Image model', desc: 'A built-in image model (GPT Image, Gemini or Seedream).', kind: 'image', ports: { in: true, out: true, fail: true }, workflows: ['image'],
    fields: [{ key: 'provider', label: 'Model', type: 'select', options: opts(IMAGE_PROVIDERS), default: 'openai' }] },
  { type: 'model.video', group: 'AI models', label: 'Video model', desc: 'A built-in video model (Veo, Kling, Runway or Seedance).', kind: 'video', ports: { in: true, out: true, fail: true }, workflows: ['video'],
    fields: [{ key: 'provider', label: 'Model', type: 'select', options: opts(VIDEO_PROVIDERS), default: 'veo' }] },
  { type: 'model.custom', group: 'AI models', label: 'Custom model', desc: 'Add any OpenAI-compatible text or image model: your own endpoint, model name and API key.', kind: 'custom', ports: { in: true, out: true, fail: true }, workflows: ['image', 'copy'],
    fields: [{ key: 'label', label: 'Name', type: 'text', default: 'My model', max: 40 },
             { key: 'kind', label: 'Type', type: 'select', options: [{ value: 'image', label: 'Image' }, { value: 'text', label: 'Text' }], default: 'image' },
             { key: 'baseUrl', label: 'API base URL', type: 'text', default: 'https://api.example.com/v1', help: 'https only. Calls {base}/chat/completions (text) or {base}/images/generations (image).' },
             { key: 'model', label: 'Model name', type: 'text', default: '' },
             { key: 'apiKeyEnv', label: 'API key variable', type: 'text', default: 'CUSTOM_AI_MYMODEL_KEY', help: 'Name of an environment variable in server/.env holding the key. Must start with CUSTOM_AI_. The key itself is never stored here.' }] },
  // ---- prompt blocks
  { type: 'prompt.suffix', group: 'Processing', label: 'Add instruction', desc: 'Appends your fixed text to every prompt before it reaches the model (e.g. a house style rule).', ports: { in: true, out: true }, workflows: ['image', 'video', 'copy'],
    fields: [{ key: 'text', label: 'Text to add', type: 'textarea', default: '', max: 600 }] },
  { type: 'prompt.enhance', group: 'Processing', label: 'Prompt enhancer', desc: 'A text model rewrites the image prompt (richer, more specific) before the image model sees it. Adds one small text call per image.', ports: { in: true, out: true }, workflows: ['image'],
    fields: [{ key: 'instruction', label: 'Rewrite instruction', type: 'textarea', default: 'Rewrite this image prompt to be more vivid and specific about composition, lighting and materials. Keep every requirement, colour rule and piece of required text exactly as given. Return only the rewritten prompt.', max: 800 }] },
  // ---- quality checks
  { type: 'qa.blackbars', group: 'Quality checks', label: 'Black-bar check', desc: 'Rejects images with a black band along an edge and regenerates them.', ports: { in: true, out: true }, workflows: ['image'],
    fields: [{ key: 'retries', label: 'Retries', type: 'number', min: 0, max: 5, default: 2 }] },
  { type: 'qa.colour', group: 'Quality checks', label: 'Colour check', desc: 'Rejects black-and-white results (unless your references are) and regenerates in full colour.', ports: { in: true, out: true }, workflows: ['image'],
    fields: [{ key: 'retries', label: 'Retries', type: 'number', min: 0, max: 5, default: 2 }] },
  // ---- outputs
  { type: 'output.image', group: 'Outputs', label: 'Output image', desc: 'The finished image.', ports: { in: true, out: false }, workflows: ['image'], fields: [] },
  { type: 'output.video', group: 'Outputs', label: 'Output video', desc: 'The finished video.', ports: { in: true, out: false }, workflows: ['video'], fields: [] },
  { type: 'output.text', group: 'Outputs', label: 'Output text', desc: 'The finished copy.', ports: { in: true, out: false }, workflows: ['copy'], fields: [] }
];

const BLOCK = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));
export const catalog = () => ({ blocks: BLOCKS, workflows: WORKFLOWS });

const label = (kind, key) => PROVIDERS_BY_KIND[kind]?.[key] || key;
const isModel = (t) => t.startsWith('model.');
const kindOfNode = (n) => (n.type === 'model.custom' ? n.config?.kind : BLOCK[n.type]?.kind);

const CUSTOM_KEY_RE = /^CUSTOM_AI_[A-Z0-9_]{1,50}$/;

/** Canonical provider key for a model node ('openai', 'veo', ... or 'custom:<scope>:<nodeId>'). */
export function providerKeyOf(node, scope) {
  return node.type === 'model.custom' ? `custom:${scope}:${node.id}` : node.config?.provider;
}

function checkConfig(n, workflow, errs) {
  const def = BLOCK[n.type];
  const c = n.config || {};
  if (n.type === 'model.text' || n.type === 'model.image' || n.type === 'model.video') {
    if (!PROVIDERS_BY_KIND[def.kind][c.provider]) errs.push(`${def.label}: pick a model.`);
  }
  if (n.type === 'model.custom') {
    const tag = `Custom model "${String(c.label || 'unnamed').slice(0, 40)}"`;
    if (!['image', 'text'].includes(c.kind)) errs.push(`${tag}: choose Image or Text.`);
    else if (c.kind === 'image' && workflow !== 'image') errs.push(`${tag}: image models can't be used in the ${WORKFLOWS[workflow].label} workflow.`);
    else if (c.kind === 'text' && workflow !== 'copy') errs.push(`${tag}: text models can't be used in the ${WORKFLOWS[workflow].label} workflow.`);
    let u = null;
    try { u = new URL(c.baseUrl); } catch { /* handled below */ }
    if (!u || u.protocol !== 'https:') errs.push(`${tag}: the API base URL must be a valid https:// address.`);
    if (!String(c.model || '').trim()) errs.push(`${tag}: enter the model name.`);
    if (!CUSTOM_KEY_RE.test(String(c.apiKeyEnv || ''))) errs.push(`${tag}: the API key variable must be named CUSTOM_AI_<NAME> (letters, numbers, underscores).`);
  }
  if (n.type === 'qa.blackbars' || n.type === 'qa.colour') {
    const r = Number(c.retries);
    if (!Number.isInteger(r) || r < 0 || r > 5) errs.push(`${def.label}: retries must be a whole number from 0 to 5.`);
  }
  if (n.type === 'prompt.suffix' && String(c.text || '').length > 600) errs.push('Add instruction: keep it under 600 characters.');
  if (n.type === 'prompt.enhance' && !String(c.instruction || '').trim()) errs.push('Prompt enhancer: enter the rewrite instruction.');
}

/**
 * Compile a graph for a workflow. Returns { errors, warnings, plan, summary }.
 * plan is null when there are errors. scope namespaces custom-model keys ('global' or a customer id).
 */
export function compile(workflow, graph, scope = 'global') {
  const errors = [];
  const warnings = [];
  const wf = WORKFLOWS[workflow];
  if (!wf) return { errors: [`Unknown workflow "${workflow}".`], warnings, plan: null, summary: [] };
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length > 40 || edges.length > 80) errors.push('This graph is too large (max 40 blocks).');

  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(n.id)) { errors.push('A block has an invalid id.'); continue; }
    if (byId.has(n.id)) { errors.push(`Duplicate block id "${n.id}".`); continue; }
    const def = BLOCK[n.type];
    if (!def) { errors.push(`Unknown block type "${n.type}".`); continue; }
    if (!def.workflows.includes(workflow)) { errors.push(`"${def.label}" can't be used in the ${wf.label} workflow.`); continue; }
    byId.set(n.id, n);
    checkConfig(n, workflow, errors);
  }

  const out = new Map(); // id -> [ids] via "out"
  const fail = new Map(); // id -> [ids] via "fail"
  const incoming = new Map();
  for (const e of edges) {
    const from = byId.get(e?.from);
    const to = byId.get(e?.to);
    if (!from || !to) { errors.push('A connection points at a block that does not exist.'); continue; }
    if (from.id === to.id) { errors.push('A block cannot connect to itself.'); continue; }
    const port = e.fromPort === 'fail' ? 'fail' : 'out';
    if (!BLOCK[from.type].ports[port]) { errors.push(`"${BLOCK[from.type].label}" has no ${port === 'fail' ? '"if fails"' : 'output'} connection.`); continue; }
    if (!BLOCK[to.type].ports.in) { errors.push(`Nothing can connect into "${BLOCK[to.type].label}".`); continue; }
    if (port === 'fail' && !isModel(to.type)) { errors.push('An "if fails" connection must lead to another model block.'); continue; }
    const map = port === 'fail' ? fail : out;
    if (!map.has(from.id)) map.set(from.id, []);
    map.get(from.id).push(to.id);
    if (port === 'out') incoming.set(to.id, (incoming.get(to.id) || 0) + 1);
  }

  // cycle check over every edge
  const adj = new Map();
  for (const m of [out, fail]) for (const [k, v] of m) adj.set(k, [...(adj.get(k) || []), ...v]);
  const state = new Map();
  const dfs = (id) => {
    state.set(id, 1);
    for (const nx of adj.get(id) || []) {
      if (state.get(nx) === 1) return true;
      if (!state.get(nx) && dfs(nx)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const id of byId.keys()) if (!state.get(id) && dfs(id)) { errors.push('The blocks form a loop. Connections must flow from inputs to the output.'); break; }

  const inputs = [...byId.values()].filter((n) => n.type.startsWith('input.'));
  const outputs = [...byId.values()].filter((n) => n.type.startsWith('output.'));
  if (!inputs.length) errors.push('Add an input block (Brief / prompt).');
  if (!outputs.length) errors.push('Add an output block.');
  if (outputs.some((o) => o.type !== wf.output)) errors.push(`The ${wf.label} workflow ends in "${BLOCK[wf.output].label}".`);
  if (errors.length) return { errors, warnings, plan: null, summary: [] };

  // main path = reachable from an input AND reaching an output, along "out" edges
  const fwd = new Set();
  const stack = inputs.map((n) => n.id);
  while (stack.length) { const id = stack.pop(); if (fwd.has(id)) continue; fwd.add(id); for (const nx of out.get(id) || []) stack.push(nx); }
  const rev = new Map();
  for (const [k, v] of out) for (const t of v) rev.set(t, [...(rev.get(t) || []), k]);
  const back = new Set();
  const st2 = outputs.map((n) => n.id);
  while (st2.length) { const id = st2.pop(); if (back.has(id)) continue; back.add(id); for (const pv of rev.get(id) || []) st2.push(pv); }
  const main = new Set([...fwd].filter((id) => back.has(id)));
  if (!outputs.some((o) => main.has(o.id))) errors.push('Connect the blocks from the input to the output.');
  if (errors.length) return { errors, warnings, plan: null, summary: [] };

  // topological order of the main path (stable by position)
  const indeg = new Map([...main].map((id) => [id, 0]));
  for (const id of main) for (const nx of out.get(id) || []) if (main.has(nx)) indeg.set(nx, indeg.get(nx) + 1);
  const pos = (id) => [byId.get(id).x || 0, byId.get(id).y || 0];
  const ready = [...main].filter((id) => indeg.get(id) === 0).sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1]);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const nx of out.get(id) || []) if (main.has(nx)) { indeg.set(nx, indeg.get(nx) - 1); if (indeg.get(nx) === 0) { ready.push(nx); ready.sort((a, b) => pos(a)[0] - pos(b)[0] || pos(a)[1] - pos(b)[1]); } }
  }

  const failChainOf = (startId) => {
    const chain = [];
    let cur = startId;
    while (true) {
      const nexts = fail.get(cur) || [];
      if (nexts.length > 1) { errors.push(`"${BLOCK[byId.get(cur).type].label}" has more than one "if fails" connection. Chain the fallbacks one after another.`); break; }
      if (!nexts.length) break;
      cur = nexts[0];
      if (main.has(cur)) { errors.push('A fallback model cannot also sit on the main path.'); break; }
      chain.push(cur);
    }
    return chain;
  };

  const modelsOnMain = order.filter((id) => isModel(byId.get(id).type));
  const failOnly = [...byId.values()].filter((n) => isModel(n.type) && !main.has(n.id));
  const used = new Set(main);

  const plan = { workflow, scope, order: [], rotate: false, custom: {}, qa: { blackBars: { enabled: false, retries: 0 }, colour: { enabled: false, retries: 0 } }, promptBlocks: [] };
  const summary = [];
  const keyOf = (id) => {
    const n = byId.get(id);
    const k = providerKeyOf(n, scope);
    if (n.type === 'model.custom') plan.custom[k] = { label: String(n.config.label).slice(0, 40), kind: n.config.kind, baseUrl: n.config.baseUrl, model: String(n.config.model).trim(), apiKeyEnv: n.config.apiKeyEnv };
    return k;
  };
  const nameOf = (id) => {
    const n = byId.get(id);
    return n.type === 'model.custom' ? String(n.config.label) : label(kindOfNode(n), n.config.provider);
  };

  if (wf.modelKind) {
    if (modelsOnMain.length !== 1) {
      errors.push(modelsOnMain.length === 0
        ? `Add a ${wf.modelKind} model block between the input and the output.`
        : 'Only one model block can sit on the main path. Connect extra models with the "if fails" dot so they become fallbacks.');
    } else {
      const chain = [modelsOnMain[0], ...failChainOf(modelsOnMain[0])];
      for (const id of chain) {
        used.add(id);
        if (kindOfNode(byId.get(id)) !== wf.modelKind) errors.push(`"${nameOf(id)}" is not a ${wf.modelKind} model.`);
      }
      plan.order = chain.map(keyOf);
      plan.rotate = Boolean(byId.get(modelsOnMain[0]).config.rotate) && workflow === 'copy';
      summary.push(`Model order: ${chain.map(nameOf).join('  →  (if it fails)  ')}`);
      const seen = new Set();
      for (const k of plan.order) { if (seen.has(k)) warnings.push('The same model appears twice in the chain.'); seen.add(k); }
    }
  }
  if (errors.length) return { errors, warnings, plan: null, summary: [] };

  const primaryIdx = wf.modelKind ? order.indexOf(modelsOnMain[0]) : -1;
  for (const [i, id] of order.entries()) {
    const n = byId.get(id);
    if (n.type === 'qa.blackbars') { plan.qa.blackBars = { enabled: true, retries: Number(n.config.retries) }; summary.push(`Black-bar check: on, ${n.config.retries} retries`); }
    if (n.type === 'qa.colour') { plan.qa.colour = { enabled: true, retries: Number(n.config.retries) }; summary.push(`Colour check: on, ${n.config.retries} retries`); }
    if (n.type === 'prompt.suffix' && String(n.config.text || '').trim()) {
      if (primaryIdx >= 0 && i > primaryIdx) warnings.push('"Add instruction" sits after the model, so it has no effect. Move it before the model.');
      else plan.promptBlocks.push({ type: 'prompt.suffix', text: String(n.config.text).trim() });
    }
    if (n.type === 'prompt.enhance') {
      if (primaryIdx >= 0 && i > primaryIdx) warnings.push('"Prompt enhancer" sits after the model, so it has no effect. Move it before the model.');
      else { plan.promptBlocks.push({ type: 'prompt.enhance', instruction: String(n.config.instruction).trim() }); summary.push('Prompt enhancer: on'); }
    }
  }
  if (workflow === 'image') {
    if (!plan.qa.blackBars.enabled) summary.push('Black-bar check: off');
    if (!plan.qa.colour.enabled) summary.push('Colour check: off');
  }

  const dangling = [...byId.values()].filter((n) => !used.has(n.id) && !n.type.startsWith('input.') && !n.type.startsWith('output.'));
  for (const n of dangling) warnings.push(`"${BLOCK[n.type].label}" is not connected to the main path, so it is ignored.`);
  const unusedInputs = inputs.filter((n) => !main.has(n.id));
  for (const n of unusedInputs) warnings.push(`"${BLOCK[n.type].label}" is not connected, so it is ignored.`);
  for (const n of failOnly) if (!used.has(n.id)) { /* reported above as dangling */ }
  return { errors: [], warnings, plan, summary };
}

// ------------------------------------------------------------------ default graphs
const TEXT_ALIAS = { gpt: 'openai', openai: 'openai', chatgpt: 'openai', claude: 'anthropic', anthropic: 'anthropic', gemini: 'gemini', google: 'gemini' };
const IMAGE_ALIAS = { gpt: 'openai', openai: 'openai', chatgpt: 'openai', gemini: 'gemini', google: 'gemini', seedream: 'seedream', bytedance: 'seedream' };
const VIDEO_ALIAS = { veo: 'veo', google: 'veo', gemini: 'veo', kling: 'kling', runway: 'runway', runwayml: 'runway', seedance: 'seedance', bytedance: 'seedance' };

function envOrder(envVar, alias, fallback) {
  const raw = process.env[envVar];
  const list = (raw ? raw.split(',') : fallback).map((s) => alias[s.trim().toLowerCase()]).filter(Boolean);
  return [...new Set(list)];
}

/**
 * The graph that matches how the app behaves TODAY (your AI Settings model choices plus the
 * AI_*_PRIORITY fallback chains), so the first thing you see is the exact current architecture.
 */
export function defaultGraph(workflow, settings = {}) {
  const nodes = [];
  const edges = [];
  const add = (id, type, col, row, config = {}) => nodes.push({ id, type, x: 60 + col * 250, y: 60 + row * 120, config });
  const link = (from, to, fromPort = 'out') => edges.push({ id: `${from}-${fromPort}-${to}`, from, fromPort, to });

  const chainFor = (kind, pinned, alias, envVar, fallback, extra = {}) => {
    const pin = alias[String(pinned || '').toLowerCase()];
    const list = pin ? [pin] : envOrder(envVar, alias, fallback);
    return { list, extra };
  };

  if (workflow === 'image') {
    const { list } = chainFor('image', settings.imageModel, IMAGE_ALIAS, 'AI_IMAGE_PRIORITY', ['openai', 'gemini', 'seedream']);
    add('in_prompt', 'input.prompt', 0, 0);
    add('in_image', 'input.image', 0, 1);
    add('builder', 'sys.promptBuilder', 1, 0);
    add('m0', 'model.image', 2, 0, { provider: list[0] });
    list.slice(1).forEach((p, i) => add(`m${i + 1}`, 'model.image', 2, i + 1, { provider: p }));
    // The automatic black-bar / colour checks are OFF by default (see router.js: the rules are in the prompt instead).
    // They only appear in the default graph when IMAGE_QA_CHECKS=on; they can still be added from the Quality checks palette.
    const qaOn = String(process.env.IMAGE_QA_CHECKS || '').toLowerCase() === 'on';
    if (qaOn) {
      add('qa_bars', 'qa.blackbars', 3, 0, { retries: 2 });
      add('qa_colour', 'qa.colour', 4, 0, { retries: 2 });
    }
    add('out', 'output.image', qaOn ? 5 : 3, 0);
    link('in_prompt', 'builder'); link('in_image', 'builder'); link('builder', 'm0');
    list.slice(1).forEach((_, i) => link(`m${i}`, `m${i + 1}`, 'fail'));
    if (qaOn) { link('m0', 'qa_bars'); link('qa_bars', 'qa_colour'); link('qa_colour', 'out'); } else { link('m0', 'out'); }
  } else if (workflow === 'video') {
    const { list } = chainFor('video', settings.videoModel, VIDEO_ALIAS, 'AI_VIDEO_PRIORITY', ['veo', 'kling', 'runway', 'seedance']);
    add('in_prompt', 'input.prompt', 0, 0);
    add('in_image', 'input.image', 0, 1);
    add('builder', 'sys.promptBuilder', 1, 0);
    add('m0', 'model.video', 2, 0, { provider: list[0] });
    list.slice(1).forEach((p, i) => add(`m${i + 1}`, 'model.video', 2, i + 1, { provider: p }));
    add('out', 'output.video', 3, 0);
    link('in_prompt', 'builder'); link('in_image', 'builder'); link('builder', 'm0');
    list.slice(1).forEach((_, i) => link(`m${i}`, `m${i + 1}`, 'fail'));
    link('m0', 'out');
  } else if (workflow === 'copy') {
    const pinned = TEXT_ALIAS[String(settings.copyModel || '').toLowerCase()];
    const list = pinned ? [pinned] : envOrder('AI_TEXT_PRIORITY', TEXT_ALIAS, ['openai', 'anthropic', 'gemini']);
    add('in_prompt', 'input.prompt', 0, 0);
    add('builder', 'sys.promptBuilder', 1, 0);
    add('m0', 'model.text', 2, 0, { provider: list[0], rotate: !pinned });
    list.slice(1).forEach((p, i) => add(`m${i + 1}`, 'model.text', 2, i + 1, { provider: p }));
    add('out', 'output.text', 3, 0);
    link('in_prompt', 'builder'); link('builder', 'm0');
    list.slice(1).forEach((_, i) => link(`m${i}`, `m${i + 1}`, 'fail'));
    link('m0', 'out');
  }
  return { nodes, edges };
}
