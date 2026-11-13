import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import { Card, Btn, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

// AI Block Architecture: a canvas that shows (and edits) exactly how each generation workflow
// runs. Drag blocks from the palette, drag blocks around, drag from a dot to connect. The model
// on the main path is the primary; models linked with the amber "if fails" dot are fallbacks,
// tried in order. Saved graphs are LIVE: the generation code follows them.

const W = 196;
const H = 66;
const GROUP_COLOR = {
  Inputs: '#12805C',
  'Built-in steps': '#667085',
  'AI models': '#2E5EFF',
  Processing: '#7A4FD6',
  'Quality checks': '#C77700',
  Outputs: '#0F2A5C'
};
const SOURCE_LABEL = { default: 'Built-in (matches today’s behaviour)', custom: 'Saved pipeline', inherited: 'Inherited from agency default' };

const CSS = `
.blk-stage{position:relative}
.blk-float{position:absolute;z-index:20;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(10,14,23,.18);display:flex;flex-direction:column;max-height:calc(100% - 28px)}
.blk-float--pal{left:12px;top:12px;width:214px}
.blk-float--insp{right:16px;bottom:16px;width:300px;max-height:min(520px,calc(100% - 28px))}
.blk-float__h{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;border-bottom:1px solid var(--line);font-size:13px;flex:none}
.blk-float__h b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk-float__h button,.blk-pill{border:1px solid var(--line);background:var(--paper);border-radius:8px;cursor:pointer;font:inherit}
.blk-float__h button{width:26px;height:26px;line-height:1;font-size:15px}
.blk-float__b{padding:12px;overflow:auto}
.blk-pill{position:absolute;z-index:20;padding:7px 12px;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(10,14,23,.18)}
.blk-pill--pal{left:12px;top:12px}
.blk-pill--insp{right:16px;bottom:16px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk-pill i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--blue);margin-right:6px}
.blk-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.blk-tab{padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:var(--paper);cursor:pointer;font-size:13.5px;font-weight:500}
.blk-tab.on{background:var(--blue);border-color:var(--blue);color:#fff}
.blk-tab i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#C77700;margin-left:6px}
.blk-pal h4{margin:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.blk-pal h4:first-child{margin-top:0}
.blk-pitem{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--paper);margin-bottom:6px;cursor:grab;font-size:13px;user-select:none}
.blk-pitem:hover{border-color:var(--blue-line);background:var(--blue-soft)}
.blk-pitem b{width:9px;height:9px;border-radius:3px;flex:none}
.blk-scroll{position:relative;overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:#FBFCFD;height:calc(100vh - 290px);min-height:480px}
.blk-canvas{position:relative;background-image:radial-gradient(#E6E9F0 1px,transparent 1px);background-size:20px 20px}
.blk-svg{position:absolute;inset:0;pointer-events:none}
.blk-svg path{pointer-events:stroke}
.blk-node{position:absolute;width:${W}px;height:${H}px;background:var(--paper);border:1.5px solid var(--line);border-radius:10px;box-shadow:0 1px 3px rgba(10,14,23,.08);cursor:grab;user-select:none;touch-action:none}
.blk-node.sel{border-color:var(--blue);box-shadow:0 0 0 3px rgba(46,94,255,.18)}
.blk-node.bad{border-color:#D92D20}
.blk-node__bar{height:5px;border-radius:8px 8px 0 0}
.blk-node__t{padding:6px 10px 0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk-node__s{padding:0 10px;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk-port{position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #98A2B3;cursor:crosshair;z-index:2}
.blk-port:hover{border-color:var(--blue);background:var(--blue-soft)}
.blk-port.in{left:-8px;top:${H / 2 - 7}px}
.blk-port.out{right:-8px;top:${H / 2 - 7}px}
.blk-port.fail{left:${W / 2 - 7}px;bottom:-8px;border-color:#C77700}
.blk-port.fail:hover{background:#FFF4E0}
.blk-dot{position:absolute;right:8px;top:12px;width:8px;height:8px;border-radius:50%}
.blk-msgs{margin-top:12px;font-size:13px}
.blk-msgs ul{margin:4px 0 0 18px;padding:0}
.blk-msgs .e{color:#B42318}.blk-msgs .w{color:#B54708}
.blk-sum{margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);font-size:13px}
.blk-sum div{margin-top:3px}
.blk-field{margin-bottom:12px}
.blk-field label{display:block;font-size:12.5px;font-weight:600;margin-bottom:4px}
.blk-field input[type=text],.blk-field input[type=number],.blk-field select,.blk-field textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:13.5px;background:#fff}
.blk-field textarea{min-height:90px;resize:vertical}
.blk-field .h{font-size:12px;color:var(--muted);margin-top:4px}
.blk-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600}
`;

const uid = (type) => `${type.replace('.', '_')}_${Math.random().toString(36).slice(2, 6)}`;
const clone = (g) => JSON.parse(JSON.stringify(g));

// Height of the visible canvas area (matches .blk-scroll in the CSS above).
const viewHeight = () => Math.max(480, (typeof window === 'undefined' ? 800 : window.innerHeight) - 290);

// Copy of a graph with its blocks centred vertically in the visible canvas, so a freshly opened
// pipeline sits in the middle instead of hugging the top edge. Only the layout moves.
function centered(g) {
  const out = clone(g);
  if (!out.nodes.length) return out;
  const minY = Math.min(...out.nodes.map((n) => n.y));
  const maxY = Math.max(...out.nodes.map((n) => n.y + H));
  const top = Math.max(24, Math.round((viewHeight() - (maxY - minY)) / 2));
  const dy = top - minY;
  for (const n of out.nodes) n.y = Math.max(0, Math.round(n.y + dy));
  return out;
}

export default function AdminAIBlocks() {
  const { customer } = useAuth();
  const customerKey = customer?._id || customer?.id || '';
  const [scope, setScope] = useState('global'); // agency default first; switch to a customer to override it
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workflow, setWorkflow] = useState('image');
  const [drafts, setDrafts] = useState({}); // workflow -> graph being edited
  const [dirty, setDirty] = useState({}); // workflow -> bool
  const [selected, setSelected] = useState(null); // { kind:'node'|'edge', id }
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState(null); // in-progress connection { from, port, x, y }
  // floating panels: remembered per browser, each can be minimised to give the canvas more room
  const keep = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
  const [palOpen, setPalOpenRaw] = useState(() => keep('blk.palOpen', true));
  const [inspOpen, setInspOpenRaw] = useState(() => keep('blk.inspOpen', true));
  const setPalOpen = (v) => { setPalOpenRaw(v); try { localStorage.setItem('blk.palOpen', v ? '1' : '0'); } catch { /* ignore */ } };
  const setInspOpen = (v) => { setInspOpenRaw(v); try { localStorage.setItem('blk.inspOpen', v ? '1' : '0'); } catch { /* ignore */ } };
  const innerRef = useRef(null);
  const dragRef = useRef(null);

  const anyDirty = Object.values(dirty).some(Boolean);
  const params = scope === 'global' ? { scope: 'global' } : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await adminApi.getAiPipelines(scope === 'global' ? { scope: 'global' } : undefined);
      setData(d);
      const g = {};
      for (const [wf, v] of Object.entries(d.workflows)) g[wf] = centered(v.graph);
      setDrafts(g);
      setDirty({});
      setSelected(null);
      setPreview(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the AI blocks.'));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // reload when scope or the selected customer changes
  useEffect(() => { load(); }, [load, customerKey]);

  const catalog = data?.catalog;
  const defs = useMemo(() => Object.fromEntries((catalog?.blocks || []).map((b) => [b.type, b])), [catalog]);
  const graph = drafts[workflow] || { nodes: [], edges: [] };
  const wfInfo = data?.workflows?.[workflow];

  // ----- live validation (debounced) -----------------------------------------------------
  useEffect(() => {
    if (!data || !drafts[workflow]) return undefined;
    if (!dirty[workflow]) { setPreview(null); return undefined; }
    const t = setTimeout(async () => {
      try {
        setPreview(await adminApi.previewAiPipeline(workflow, drafts[workflow], params));
      } catch (err) {
        setPreview({ errors: [apiErrorMessage(err, 'Could not validate.')], warnings: [], summary: [] });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, workflow, dirty, data]);

  const shown = dirty[workflow] && preview ? preview : wfInfo;
  const errors = shown?.errors || [];
  const warnings = shown?.warnings || [];
  const summary = shown?.summary || [];
  const customKeys = shown?.customKeys || {};

  const edit = (fn) => {
    setDrafts((d) => ({ ...d, [workflow]: fn(clone(d[workflow])) }));
    setDirty((d) => ({ ...d, [workflow]: true }));
    setNotice('');
  };

  // ----- node helpers -------------------------------------------------------------------
  const nodeById = (id) => graph.nodes.find((n) => n.id === id);
  const titleOf = (n) => (n.type === 'model.custom' ? n.config?.label || 'Custom model' : defs[n.type]?.label || n.type);
  const subOf = (n) => {
    const def = defs[n.type];
    if (!def) return '';
    if (n.type === 'model.custom') return `${n.config?.kind || 'image'} · ${n.config?.model || 'set model name'}`;
    if (def.type?.startsWith('model.')) {
      const f = def.fields.find((x) => x.key === 'provider');
      const opt = f?.options.find((o) => o.value === n.config?.provider);
      return `${opt?.label || 'pick a model'}`;
    }
    if (n.type === 'qa.blackbars' || n.type === 'qa.colour') return `${n.config?.retries ?? 0} retries`;
    if (n.type === 'prompt.suffix') return n.config?.text ? `“${n.config.text.slice(0, 22)}…”` : 'empty';
    return def.group;
  };
  const dotColor = (n) => {
    if (n.type === 'model.custom') return customKeys[n.id] === false ? '#D92D20' : customKeys[n.id] ? '#12B76A' : null;
    if (n.type.startsWith('model.')) return data?.providers?.[n.config?.provider] ? '#12B76A' : '#D92D20';
    return null;
  };

  const defaultConfig = (def, extra = {}) => {
    const c = {};
    for (const f of def.fields) {
      if (f.only && !f.only.includes(workflow)) continue;
      c[f.key] = f.default ?? (f.type === 'checkbox' ? false : '');
    }
    return { ...c, ...extra };
  };

  const addBlock = (type, x, y) => {
    const def = defs[type];
    if (!def) return;
    const id = uid(type);
    const pos = x == null
      ? { x: 60 + (graph.nodes.length % 5) * 40, y: 60 + (graph.nodes.length % 6) * 40 }
      : { x: Math.max(10, Math.round(x - W / 2)), y: Math.max(10, Math.round(y - H / 2)) };
    edit((g) => { g.nodes.push({ id, type, ...pos, config: defaultConfig(def) }); return g; });
    setSelected({ kind: 'node', id });
  };

  const removeNode = (id) => {
    const n = nodeById(id);
    if (!n || defs[n.type]?.fixed) return;
    edit((g) => { g.nodes = g.nodes.filter((x) => x.id !== id); g.edges = g.edges.filter((e) => e.from !== id && e.to !== id); return g; });
    setSelected(null);
  };
  const removeEdge = (id) => { edit((g) => { g.edges = g.edges.filter((e) => e.id !== id); return g; }); setSelected(null); };

  const setConfig = (id, key, value) => edit((g) => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) return g;
    n.config = { ...n.config, [key]: value };
    return g;
  });

  const connect = (fromId, port, toId) => {
    const from = nodeById(fromId);
    const to = nodeById(toId);
    if (!from || !to || from.id === to.id) return;
    const fd = defs[from.type];
    const td = defs[to.type];
    if (!fd?.ports?.[port] || !td?.ports?.in) return;
    if (port === 'fail' && !to.type.startsWith('model.')) { setNotice('An “if fails” link has to lead to another model block.'); return; }
    if (graph.edges.some((e) => e.from === fromId && e.to === toId && e.fromPort === port)) return;
    edit((g) => {
      if (port === 'fail') g.edges = g.edges.filter((e) => !(e.from === fromId && e.fromPort === 'fail'));
      g.edges.push({ id: `${fromId}-${port}-${toId}`, from: fromId, fromPort: port, to: toId });
      return g;
    });
  };

  // ----- pointer interactions -----------------------------------------------------------
  const canvasPoint = (ev) => {
    const r = innerRef.current.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const startNodeDrag = (ev, n) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    setSelected({ kind: 'node', id: n.id });
    const p = canvasPoint(ev);
    dragRef.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    const move = (e) => {
      const q = canvasPoint(e);
      const d = dragRef.current;
      if (!d) return;
      d.moved = true;
      setDrafts((all) => {
        const g = clone(all[workflow]);
        const node = g.nodes.find((x) => x.id === d.id);
        if (node) { node.x = Math.max(0, Math.round(q.x - d.dx)); node.y = Math.max(0, Math.round(q.y - d.dy)); }
        return { ...all, [workflow]: g };
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragRef.current?.moved) setDirty((d) => ({ ...d, [workflow]: true }));
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startLink = (ev, n, port) => {
    ev.stopPropagation();
    ev.preventDefault();
    const start = canvasPoint(ev);
    setLink({ from: n.id, port, x: start.x, y: start.y });
    const move = (e) => { const q = canvasPoint(e); setLink({ from: n.id, port, x: q.x, y: q.y }); };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node-id]');
      if (el) connect(n.id, port, el.getAttribute('data-node-id'));
      setLink(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = (ev) => {
    ev.preventDefault();
    const type = ev.dataTransfer.getData('text/plain');
    if (!defs[type]) return;
    const p = canvasPoint(ev);
    addBlock(type, p.x, p.y);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!selected || !['Delete', 'Backspace'].includes(e.key)) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      e.preventDefault();
      if (selected.kind === 'node') removeNode(selected.id); else removeEdge(selected.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const warn = (e) => { if (anyDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // ----- save / reset -------------------------------------------------------------------
  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await adminApi.saveAiPipeline(workflow, drafts[workflow], params);
      setNotice(`Saved. ${catalog.workflows[workflow].label} now runs on this architecture${r.warnings?.length ? ' (with warnings)' : ''}.`);
      const d = await adminApi.getAiPipelines(params);
      setData(d);
      setDirty((x) => ({ ...x, [workflow]: false }));
      setDrafts((x) => ({ ...x, [workflow]: centered(d.workflows[workflow].graph) }));
      setPreview(null);
    } catch (err) {
      const errs = err?.response?.data?.errors;
      setPreview({ errors: errs || [apiErrorMessage(err, 'Could not save.')], warnings: [], summary: [] });
      setError(apiErrorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const what = scope === 'global'
      ? 'Go back to the built-in architecture for this workflow?'
      : 'Remove this customer’s own pipeline and inherit the agency default for this workflow?';
    if (!window.confirm(what)) return;
    setSaving(true);
    setError('');
    try {
      await adminApi.resetAiPipeline(workflow, params);
      const d = await adminApi.getAiPipelines(params);
      setData(d);
      setDrafts((x) => ({ ...x, [workflow]: centered(d.workflows[workflow].graph) }));
      setDirty((x) => ({ ...x, [workflow]: false }));
      setPreview(null);
      setNotice('Reset.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reset.'));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDrafts((x) => ({ ...x, [workflow]: centered(data.workflows[workflow].graph) }));
    setDirty((x) => ({ ...x, [workflow]: false }));
    setPreview(null);
    setSelected(null);
  };

  const changeScope = (s) => {
    if (s === scope) return;
    if (anyDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setScope(s);
  };

  // ----- geometry -----------------------------------------------------------------------
  const pos = (n) => ({ x: n.x, y: n.y });
  const portXY = (n, port) => {
    const p = pos(n);
    if (port === 'in') return { x: p.x, y: p.y + H / 2 };
    if (port === 'fail') return { x: p.x + W / 2, y: p.y + H };
    return { x: p.x + W, y: p.y + H / 2 };
  };
  const curve = (a, b, port) => {
    if (port === 'fail') {
      const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
      return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x - 70},${b.y} ${b.x},${b.y}`;
    }
    const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };
  const size = useMemo(() => ({
    w: Math.max(1100, ...graph.nodes.map((n) => n.x + W + 120)),
    h: Math.max(viewHeight() - 2, ...graph.nodes.map((n) => n.y + H + 120))
  }), [graph.nodes]);

  // ----- palette ------------------------------------------------------------------------
  const palette = useMemo(() => {
    const groups = {};
    for (const b of catalog?.blocks || []) {
      if (b.fixed || !b.workflows.includes(workflow)) continue;
      (groups[b.group] = groups[b.group] || []).push(b);
    }
    return groups;
  }, [catalog, workflow]);

  // ----- inspector ----------------------------------------------------------------------
  const selNode = selected?.kind === 'node' ? nodeById(selected.id) : null;
  const selEdge = selected?.kind === 'edge' ? graph.edges.find((e) => e.id === selected.id) : null;
  const selDef = selNode ? defs[selNode.type] : null;

  const renderField = (f) => {
    const c = selNode.config || {};
    const v = c[f.key] ?? '';
    const set = (val) => setConfig(selNode.id, f.key, val);
    return (
      <div className="blk-field" key={f.key}>
        {f.type === 'checkbox' ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <input type="checkbox" checked={Boolean(c[f.key])} onChange={(e) => set(e.target.checked)} /> {f.label}
          </label>
        ) : (
          <label>{f.label}</label>
        )}
        {f.type === 'select' && (
          <select value={v} onChange={(e) => set(e.target.value)}>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {f.type === 'text' && <input type="text" value={v} maxLength={f.max || 200} onChange={(e) => set(e.target.value)} />}
        {f.type === 'number' && (
          <input type="number" min={f.min} max={f.max} value={v} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />
        )}
        {f.type === 'textarea' && <textarea value={v} maxLength={f.max || 800} onChange={(e) => set(e.target.value)} />}
        {f.help && <div className="h">{f.help}</div>}
      </div>
    );
  };

  const statusLine = () => {
    if (!selNode) return null;
    if (selNode.type === 'model.custom') {
      const ok = customKeys[selNode.id];
      return <p className="hint">API key variable: {ok === undefined ? 'checking…' : ok ? <b style={{ color: '#067647' }}>found in server/.env</b> : <b style={{ color: '#B42318' }}>not set in server/.env</b>}</p>;
    }
    if (selNode.type.startsWith('model.')) {
      const ok = data?.providers?.[selNode.config?.provider];
      return <p className="hint">Provider: {ok ? <b style={{ color: '#067647' }}>API key configured</b> : <b style={{ color: '#B42318' }}>no API key in server/.env — it will be skipped</b>}</p>;
    }
    return null;
  };

  if (loading && !data) {
    return <Layout eyebrow="Admin" title="AI Block Architecture"><LoadingSpinner label="Loading…" /></Layout>;
  }

  const wfs = catalog ? Object.entries(catalog.workflows) : [];
  const nodeBad = new Set();
  return (
    <Layout eyebrow="Admin" title="AI Block Architecture">
      <style>{CSS}</style>
      <div className="page-lede">
        <p>
          This is the exact pipeline behind each kind of generation. Drag blocks in from the left, drag them around, and drag from a dot to
          connect them. The model on the main line is tried first; link more models with the amber <b>if fails</b> dot to set the fallback order.
          Saved changes are <b>live</b> — generation follows this diagram. Settings elsewhere (AI Settings) are overridden for any workflow you save here.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>
      {notice && <p className="hint" style={{ color: 'var(--blue-dark)' }}>{notice}</p>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="blk-tabs" style={{ margin: 0 }}>
          <span className={`blk-tab ${scope === 'global' ? 'on' : ''}`} onClick={() => changeScope('global')} role="button" tabIndex={0}>
            Agency default (all customers)
          </span>
          <span className={`blk-tab ${scope === 'customer' ? 'on' : ''}`} onClick={() => changeScope('customer')} role="button" tabIndex={0}>
            {data?.customer?.name ? `Customer: ${data.customer.name}` : 'This customer'}
          </span>
        </div>
      </div>

      <div className="blk-tabs">
        {wfs.map(([key, w]) => (
          <span
            key={key}
            className={`blk-tab ${workflow === key ? 'on' : ''}`}
            onClick={() => { setWorkflow(key); setSelected(null); }}
            role="button"
            tabIndex={0}
            title={w.blurb}
          >
            {w.label}{dirty[key] ? <i /> : null}
          </span>
        ))}
      </div>
      {catalog && <p className="hint" style={{ marginTop: -4 }}>{catalog.workflows[workflow].blurb}</p>}

      <div className="blk-wrap">
        {/* canvas with floating panels */}
        <div>
          <div className="blk-stage">
          <div className="blk-scroll" onPointerDown={() => setSelected(null)}>
            <div
              ref={innerRef}
              className="blk-canvas"
              style={{ width: size.w, height: size.h, marginLeft: palOpen ? 226 : 0, transition: 'margin-left .15s' }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={onDrop}
            >
              <svg className="blk-svg" width={size.w} height={size.h}>
                <defs>
                  <marker id="blk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L10,5 L0,10 z" fill="#667085" />
                  </marker>
                  <marker id="blk-arrow-f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L10,5 L0,10 z" fill="#C77700" />
                  </marker>
                </defs>
                {graph.edges.map((e) => {
                  const a = nodeById(e.from);
                  const b = nodeById(e.to);
                  if (!a || !b) return null;
                  const pa = portXY(a, e.fromPort === 'fail' ? 'fail' : 'out');
                  const pb = portXY(b, 'in');
                  const d = curve(pa, pb, e.fromPort);
                  const on = selEdge?.id === e.id;
                  const fail = e.fromPort === 'fail';
                  return (
                    <g key={e.id}>
                      <path d={d} fill="none" stroke={on ? '#2E5EFF' : fail ? '#C77700' : '#667085'} strokeWidth={on ? 3 : 2} strokeDasharray={fail ? '6 5' : undefined} markerEnd={`url(#${fail ? 'blk-arrow-f' : 'blk-arrow'})`} />
                      <path d={d} fill="none" stroke="transparent" strokeWidth="14" style={{ cursor: 'pointer' }} onPointerDown={(ev) => { ev.stopPropagation(); setSelected({ kind: 'edge', id: e.id }); }} />
                    </g>
                  );
                })}
                {link && nodeById(link.from) && (
                  <path d={curve(portXY(nodeById(link.from), link.port), { x: link.x, y: link.y }, link.port)} fill="none" stroke="#2E5EFF" strokeWidth="2" strokeDasharray="4 4" />
                )}
              </svg>

              {graph.nodes.map((n) => {
                const def = defs[n.type];
                if (!def) return null;
                const dc = dotColor(n);
                return (
                  <div
                    key={n.id}
                    data-node-id={n.id}
                    className={`blk-node ${selected?.kind === 'node' && selected.id === n.id ? 'sel' : ''} ${nodeBad.has(n.id) ? 'bad' : ''}`.trim()}
                    style={{ left: n.x, top: n.y }}
                    onPointerDown={(ev) => startNodeDrag(ev, n)}
                  >
                    <div className="blk-node__bar" style={{ background: GROUP_COLOR[def.group] }} />
                    <div className="blk-node__t">{titleOf(n)}</div>
                    <div className="blk-node__s">{subOf(n)}</div>
                    {dc && <span className="blk-dot" style={{ background: dc }} title={dc === '#12B76A' ? 'API key configured' : 'API key missing'} />}
                    {def.ports.in && <span className="blk-port in" title="Input — drop a connection here" />}
                    {def.ports.out && <span className="blk-port out" title="Drag to connect to the next block" onPointerDown={(ev) => startLink(ev, n, 'out')} />}
                    {def.ports.fail && <span className="blk-port fail" title="Drag to a model to use it if this one fails" onPointerDown={(ev) => startLink(ev, n, 'fail')} />}
                  </div>
                );
              })}
            </div>
          </div>

          {palOpen ? (
            <div className="blk-float blk-float--pal">
              <div className="blk-float__h"><b>Blocks</b><button type="button" onClick={() => setPalOpen(false)} title="Minimise" aria-label="Minimise blocks">–</button></div>
              <div className="blk-float__b blk-pal">
          {Object.entries(palette).map(([group, items]) => (
            <div key={group}>
              <h4>{group}</h4>
              {items.map((b) => (
                <div
                  key={b.type}
                  className="blk-pitem"
                  draggable
                  title={`${b.desc}\n\nDrag onto the canvas, or click to add.`}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', b.type); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => addBlock(b.type)}
                >
                  <b style={{ background: GROUP_COLOR[b.group] }} />
                  {b.label}
                </div>
              ))}
            </div>
          ))}
          <p className="hint" style={{ marginTop: 10 }}>Built-in steps (prompt builder, compose, stitch, end card) always run and can’t be removed.</p>
        </div>
            </div>
          ) : (
            <button type="button" className="blk-pill blk-pill--pal" onClick={() => setPalOpen(true)} title="Show the block palette">＋ Blocks</button>
          )}

          {inspOpen ? (
            <div className="blk-float blk-float--insp">
              <div className="blk-float__h"><b>{selNode ? titleOf(selNode) : selEdge ? 'Connection' : 'Inspector'}</b><button type="button" onClick={() => setInspOpen(false)} title="Minimise" aria-label="Minimise inspector">–</button></div>
              <div className="blk-float__b">
          {!selNode && !selEdge && (
            <div>
              <p className="hint">Select a block to edit it, or a connection to remove it. Press Delete to remove the selection.</p>
              <p className="hint">Solid grey lines are the main flow. Dashed amber lines are fallbacks, tried in order when the model before them fails.</p>
              <p className="hint">Quality checks and prompt blocks only take effect when they sit on the main line.</p>
            </div>
          )}
          {selEdge && (
            <div>
              <p className="hint">{selEdge.fromPort === 'fail' ? 'Fallback: used if the previous model fails.' : 'Main flow.'}</p>
              <Btn variant="secondary" onClick={() => removeEdge(selEdge.id)}>Remove connection</Btn>
            </div>
          )}
          {selNode && selDef && (
            <div>
              <p className="hint" style={{ marginBottom: 12 }}>{selDef.desc}</p>
              {statusLine()}
              {selDef.fields.filter((f) => !f.only || f.only.includes(workflow)).map(renderField)}
              {!selDef.fixed && <Btn variant="secondary" onClick={() => removeNode(selNode.id)}>Remove block</Btn>}
            </div>
          )}
        </div>
            </div>
          ) : (
            <button type="button" className="blk-pill blk-pill--insp" onClick={() => setInspOpen(true)} title="Show the inspector">
              {(selNode || selEdge) && <i />}{selNode ? `Inspector · ${titleOf(selNode)}` : selEdge ? 'Inspector · Connection' : 'Inspector'}
            </button>
          )}
          </div>

          <div className="blk-msgs">
            {errors.length > 0 && (
              <div className="e"><b>Fix before saving:</b><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
            )}
            {warnings.length > 0 && (
              <div className="w" style={{ marginTop: 6 }}><b>Heads up:</b><ul>{warnings.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
            )}
          </div>
          {summary.length > 0 && errors.length === 0 && (
            <div className="blk-sum">
              <b>What will happen</b>
              {summary.map((s, i) => <div key={i}>{s}</div>)}
            </div>
          )}

          <div className="btn-row" style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn onClick={save} loading={saving} disabled={saving || !dirty[workflow] || errors.length > 0}>
              {scope === 'customer' ? 'Save for this customer' : 'Save agency default'}
            </Btn>
            {dirty[workflow] && <Btn variant="secondary" onClick={discard} disabled={saving}>Discard changes</Btn>}
            {wfInfo && wfInfo.source !== 'default' && !(scope === 'customer' && wfInfo.source === 'inherited') && (
              <Btn variant="ghost" onClick={reset} disabled={saving}>{scope === 'customer' ? 'Use agency default' : 'Reset to built-in'}</Btn>
            )}
            {wfInfo && (
              <span className="blk-badge" style={{ background: wfInfo.source === 'custom' ? '#E8F1FF' : '#F2F4F7', color: wfInfo.source === 'custom' ? '#1D3FE0' : '#475467' }}>
                {SOURCE_LABEL[wfInfo.source]}
              </span>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}
