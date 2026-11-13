import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import { Card, CardHead, Btn, Chip, Field, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';

const RES_FIELDS = ['1K', '2K', '4K'];
const SOURCE_LABEL = {
  default: 'Built-in ballpark prices (not verified)',
  ai: 'Fetched by AI and approved by an admin',
  manual: 'Entered by an admin'
};

const usd = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const inrFmt = (usdAmount, rate) => {
  if (typeof usdAmount !== 'number' || !Number.isFinite(usdAmount) || !rate) return '-';
  const n = usdAmount * rate;
  if (n === 0) return '₹0';
  if (n < 0.01) return '<₹0.01';
  return `₹${n.toLocaleString('en-IN', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '-');

// pricing (numbers) -> editable draft (strings), restricted to a stable shape
function toDraft(pricing) {
  const d = { image: {}, text: {}, video: {} };
  for (const [p, row] of Object.entries(pricing?.image || {})) d.image[p] = Object.fromEntries(RES_FIELDS.map((r) => [r, String(row[r] ?? '')]));
  for (const [p, row] of Object.entries(pricing?.text || {})) d.text[p] = { input: String(row.input ?? ''), output: String(row.output ?? '') };
  for (const [p, row] of Object.entries(pricing?.video || {})) d.video[p] = { perSecond: String(row.perSecond ?? '') };
  return d;
}

// draft (strings) -> numbers, or throws a readable error
function fromDraft(draft) {
  const out = { image: {}, text: {}, video: {} };
  const parse = (v, label) => {
    const n = Number(v);
    if (v === '' || !Number.isFinite(n) || n < 0) throw new Error(`"${label}" must be a number of 0 or more.`);
    return n;
  };
  for (const [p, row] of Object.entries(draft.image)) out.image[p] = Object.fromEntries(RES_FIELDS.map((r) => [r, parse(row[r], `${p} image ${r}`)]));
  for (const [p, row] of Object.entries(draft.text)) out.text[p] = { input: parse(row.input, `${p} text input`), output: parse(row.output, `${p} text output`) };
  for (const [p, row] of Object.entries(draft.video)) out.video[p] = { perSecond: parse(row.perSecond, `${p} video per second`) };
  return out;
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: 13, verticalAlign: 'middle' };
const priceInput = { width: 86, padding: '5px 7px', fontSize: 13 };

function SliderRow({ label, value, max, onChange, suffix }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="range" min={0} max={Math.min(max, 500)} step={1} value={Math.min(value, Math.min(max, 500))} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--blue)' }} aria-label={label} />
        <input type="number" min={0} max={max} value={value} onChange={(e) => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))))} style={{ width: 84 }} aria-label={`${label} (exact)`} />
        {suffix ? <span className="hint" style={{ margin: 0 }}>{suffix}</span> : null}
      </div>
    </Field>
  );
}

export default function AdminUsageEstimator() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [inputs, setInputs] = useState(null);
  const [result, setResult] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [fxDraft, setFxDraft] = useState('');

  const [draft, setDraft] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [includeAll, setIncludeAll] = useState(false);
  const [proposal, setProposal] = useState(null); // { sources, warnings, modelIds, fetchedAt }
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  function loadConfig({ keepInputs = false } = {}) {
    return adminApi
      .getEstimator()
      .then((c) => {
        setConfig(c);
        setFxDraft(String(c.fx?.usdToInr ?? ''));
        setDraft(toDraft(c.pricing));
        if (!keepInputs) setInputs({ ...c.defaults, imageProvider: '', videoProvider: '', copyProvider: '' });
      })
      .catch((e) => setError(apiErrorMessage(e)));
  }

  useEffect(() => {
    loadConfig().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live estimate: debounced, last-write-wins so a slow response never overwrites a newer one.
  const reqId = useRef(0);
  useEffect(() => {
    if (!inputs) return undefined;
    const id = ++reqId.current;
    setEstimating(true);
    const t = setTimeout(() => {
      adminApi
        .estimateUsage(inputs)
        .then((r) => { if (id === reqId.current) { setResult(r); setError(''); } })
        .catch((e) => { if (id === reqId.current) setError(apiErrorMessage(e)); })
        .finally(() => { if (id === reqId.current) setEstimating(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [inputs, config?.pricingMeta?.updatedAt]);

  const set = (patch) => setInputs((i) => ({ ...i, ...patch }));

  const providerRows = useMemo(() => {
    if (!config) return { text: [], image: [], video: [] };
    const keep = (kind, all) => {
      const ids = new Set([...(config.configured[kind] || []).map((p) => p.id)]);
      const act = config.active;
      if (kind === 'text') [act.copy, act.vision, act.template].forEach((a) => ids.add(a.provider));
      if (kind === 'image') ids.add(act.image.provider);
      if (kind === 'video') ids.add(act.video.provider);
      return all.filter((p) => ids.has(p));
    };
    return {
      text: keep('text', Object.keys(draft?.text || {})),
      image: keep('image', Object.keys(draft?.image || {})),
      video: keep('video', Object.keys(draft?.video || {}))
    };
  }, [config, draft]);

  const labelOf = (id) => (config?.configured && [...config.configured.text, ...config.configured.image, ...config.configured.video].find((p) => p.id === id)?.label) || id;
  const modelOf = (kind, id) => (config?.configured?.[kind] || []).find((p) => p.id === id)?.model || '';

  function editDraft(kind, provider, field, value) {
    setEdited(true);
    setDraft((d) => ({ ...d, [kind]: { ...d[kind], [provider]: { ...d[kind][provider], [field]: value } } }));
  }

  async function handleFetch() {
    setFetching(true);
    setError('');
    setNotice('');
    try {
      const r = await adminApi.fetchPricing({ includeAll });
      setDraft((d) => {
        const next = { image: { ...d.image }, text: { ...d.text }, video: { ...d.video } };
        for (const [p, row] of Object.entries(r.proposed.image || {})) next.image[p] = { ...next.image[p], ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)])) };
        for (const [p, row] of Object.entries(r.proposed.text || {})) next.text[p] = { input: String(row.input), output: String(row.output) };
        for (const [p, row] of Object.entries(r.proposed.video || {})) next.video[p] = { perSecond: String(row.perSecond) };
        return next;
      });
      if (r.fx?.usdToInr) setFxDraft(String(r.fx.usdToInr));
      setProposal({ sources: r.sources, warnings: r.warnings, modelIds: r.modelIds, fetchedAt: new Date().toISOString(), fxSource: r.fx?.sourceUrl || '' });
      setEdited(false);
      setNotice('Prices loaded below for review. Nothing is applied until you press "Save pricing".');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    setError('');
    setNotice('');
    let pricing;
    try {
      pricing = fromDraft(draft);
    } catch (e) {
      setError(e.message);
      return;
    }
    const rate = Number(fxDraft);
    if (!Number.isFinite(rate) || rate < 1 || rate > 1000) {
      setError('"₹ per US$" must be a number between 1 and 1000.');
      return;
    }
    setSaving(true);
    try {
      await adminApi.savePricing({
        usdToInr: rate,
        pricing,
        source: proposal && !edited ? 'ai' : 'manual',
        modelIds: proposal?.modelIds || config.pricingMeta?.modelIds || {},
        sources: proposal?.sources || config.pricingMeta?.sources || [],
        notes: ''
      });
      setProposal(null);
      setEdited(false);
      await loadConfig({ keepInputs: true });
      setNotice('Pricing saved. The estimate (and the cost tags users see) now use these prices.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await adminApi.resetPricing();
      setProposal(null);
      setEdited(false);
      await loadConfig({ keepInputs: true });
      setNotice('Back to the built-in ballpark prices.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const rate = result?.fx?.usdToInr || config?.fx?.usdToInr || 0;
  // Rupees first, dollars underneath (provider prices are billed in USD).
  const Money = ({ usd: amount, align }) => (
    <span style={{ display: 'inline-block', textAlign: align || 'left' }}>
      <strong>{inrFmt(amount, rate)}</strong>
      <span className="hint" style={{ display: 'block', margin: 0 }}>{usd(amount)}</span>
    </span>
  );
  const meta = config?.pricingMeta;
  const stale = useMemo(() => {
    // Saved prices were fetched for different model ids than are active now.
    if (!config || !meta || meta.source === 'default') return false;
    const check = (kind, prov, model) => meta.modelIds?.[kind]?.[prov] && meta.modelIds[kind][prov] !== model;
    const a = config.active;
    return check('image', a.image.provider, a.image.model) || check('video', a.video.provider, a.video.model) || check('text', a.copy.provider, a.copy.model);
  }, [config, meta]);

  if (loading) {
    return (
      <Layout eyebrow="Admin" title="Usage Estimator">
        <LoadingSpinner label="Loading estimator…" />
      </Layout>
    );
  }

  return (
    <Layout eyebrow="Admin" title="Usage Estimator">
      <div className="page-lede">
        <p>
          Plan what Automatr will cost to run. Set how many images and videos you expect, and the estimate prices them with the
          rates saved below. Text cost is worked out from the calls each workflow actually makes. Use AI to fetch the current
          list prices of the models you have selected, review them, then save.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>
      {notice && !error && <p className="hint" style={{ color: 'var(--blue-dark)' }}>{notice}</p>}

      {config && inputs && (
        <div className="grid-2 reverse" style={{ alignItems: 'start' }}>
          <Card>
            <CardHead title="Expected usage" />

            <SliderRow label="Total images" value={inputs.images} max={config.limits.maxImages} onChange={(v) => set({ images: v })} />

            <Field label="Image resolution">
              <select value={inputs.resolution} onChange={(e) => set({ resolution: e.target.value })}>
                {config.resolutions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>

            <SliderRow label="Total videos" value={inputs.videos} max={config.limits.maxVideos} onChange={(v) => set({ videos: v })} />

            <Field
              label="Length of each video"
              hint={result && inputs.videos > 0 && result.video.billedSeconds !== inputs.videoSeconds ? `The selected video model rounds this to ${result.video.billedSeconds}s, so ${result.video.billedSeconds}s is what gets billed.` : undefined}
            >
              <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                {config.videoLengths.map((s) => (
                  <Chip key={s} selected={inputs.videoSeconds === s} onClick={() => set({ videoSeconds: s })}>{s} sec</Chip>
                ))}
              </div>
            </Field>

            <Field label="Creative workflow" hint={config.workflows.find((w) => w.id === inputs.workflow)?.hint}>
              <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                {config.workflows.map((w) => (
                  <Chip key={w.id} selected={inputs.workflow === w.id} onClick={() => set({ workflow: w.id })}>{w.label}</Chip>
                ))}
              </div>
            </Field>

            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>Assumptions &amp; what-if</summary>
              <div style={{ marginTop: 12 }}>
                <Field label="Images per brief" hint="Brief-level text calls (suggestions, template analysis) run once per brief. 3 = one set of style options.">
                  <input type="number" min={1} max={100} value={inputs.imagesPerBrief} onChange={(e) => set({ imagesPerBrief: Math.max(1, Math.round(Number(e.target.value) || 1)) })} style={{ width: 90 }} />
                </Field>
                <Field label="Reference assets sent with each image" hint="Pictures (product, style reference) sent along with every generation. Providers bill them as input.">
                  <input type="number" min={0} max={10} value={inputs.referenceAssets ?? 1} onChange={(e) => set({ referenceAssets: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))) })} style={{ width: 90 }} />
                </Field>
                <Field label="Logos sent with each image" hint="The brand logo attached to every generation.">
                  <input type="number" min={0} max={10} value={inputs.logos ?? 1} onChange={(e) => set({ logos: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))) })} style={{ width: 90 }} />
                </Field>
                <Field label="Retry / regeneration buffer (%)" hint="Extra spend on re-runs and automatic retries. 0 assumes every generation succeeds first time.">
                  <input type="number" min={0} max={200} value={inputs.retryBufferPct} onChange={(e) => set({ retryBufferPct: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 90 }} />
                </Field>
                {[['image', 'imageProvider', 'Price images with'], ['video', 'videoProvider', 'Price videos with'], ['text', 'copyProvider', 'Price copy text with']].map(([kind, key, label]) => (
                  <Field key={key} label={label}>
                    <select value={inputs[key]} onChange={(e) => set({ [key]: e.target.value })}>
                      <option value="">Current default ({config.active[kind === 'text' ? 'copy' : kind].label})</option>
                      {(config.configured[kind] || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </details>
          </Card>

          <Card>
            <CardHead title="Estimated cost" tag={estimating ? 'updating…' : undefined} />
            {!result && <LoadingSpinner label="Calculating…" />}
            {result && (
              <>
                <div className="stat" style={{ marginBottom: 14 }}>
                  <span>Total estimate</span>
                  <strong>{inrFmt(result.totalUsd, rate)}</strong>
                  <span style={{ marginTop: 6, marginBottom: 0 }}>{usd(result.totalUsd)} at ₹{rate.toLocaleString('en-IN', { maximumFractionDigits: 2 })} per US$</span>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr><th style={th}>Item</th><th style={th}>Unit</th><th style={{ ...th, textAlign: 'right' }}>Cost</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={td}>{result.image.count} image{result.image.count === 1 ? '' : 's'} · {result.image.resolution}<div className="hint" style={{ margin: 0 }}>{result.providers.image.model || result.providers.image.label}</div></td>
                      <td style={td}><Money usd={result.image.unitUsd} /> each</td>
                      <td style={{ ...td, textAlign: 'right' }}><Money usd={result.image.totalUsd} align="right" /></td>
                    </tr>
                    {result.references && (result.references.referenceAssets + result.references.logos) > 0 && (
                      <tr>
                        <td style={td}>Reference &amp; logo pictures<div className="hint" style={{ margin: 0 }}>{result.references.referenceAssets} reference + {result.references.logos} logo per image, billed as input</div></td>
                        <td style={td}><Money usd={result.references.unitUsd} /> per image</td>
                        <td style={{ ...td, textAlign: 'right' }}><Money usd={result.references.totalUsd} align="right" /></td>
                      </tr>
                    )}
                    <tr>
                      <td style={td}>{result.video.count} video{result.video.count === 1 ? '' : 's'} · {result.video.billedSeconds}s<div className="hint" style={{ margin: 0 }}>{result.providers.video.model || result.providers.video.label}</div></td>
                      <td style={td}><Money usd={result.video.unitUsd} /> each</td>
                      <td style={{ ...td, textAlign: 'right' }}><Money usd={result.video.totalUsd} align="right" /></td>
                    </tr>
                    <tr>
                      <td style={td}>Text &amp; analysis<div className="hint" style={{ margin: 0 }}>{result.text.briefs} brief{result.text.briefs === 1 ? '' : 's'} · {fmtTokens(result.text.totalInputTokens)} in / {fmtTokens(result.text.totalOutputTokens)} out tokens</div></td>
                      <td style={td}>from workflow</td>
                      <td style={{ ...td, textAlign: 'right' }}><Money usd={result.text.totalUsd} align="right" /></td>
                    </tr>
                  </tbody>
                </table>

                <details style={{ marginTop: 14 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>How text usage is worked out</summary>
                  <div style={{ overflowX: 'auto', marginTop: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
                      <thead><tr><th style={th}>Step</th><th style={th}>Calls</th><th style={th}>Tokens / call</th><th style={{ ...th, textAlign: 'right' }}>Cost</th></tr></thead>
                      <tbody>
                        {result.text.lines.map((l) => (
                          <tr key={l.id}>
                            <td style={td}>{l.label}<div className="hint" style={{ margin: 0 }}>{l.model || l.providerLabel}</div></td>
                            <td style={td}>{l.calls}</td>
                            <td style={td}>{l.tokensPerCall.input} in / {l.tokensPerCall.output} out</td>
                            <td style={{ ...td, textAlign: 'right' }}><Money usd={l.usd} align="right" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="hint">Token sizes are estimates read from each step&apos;s prompt and output limit (the app doesn&apos;t log token counts yet), so treat text as the least precise line.</p>
                </details>

                <p className="hint" style={{ marginTop: 14 }}>
                  {result.pricingSource === 'default'
                    ? 'These use built-in ballpark prices, not live ones. Fetch current pricing below for a trustworthy figure.'
                    : `Prices: ${SOURCE_LABEL[result.pricingSource]}${result.pricingFetchedAt ? `, ${fmtDate(result.pricingFetchedAt)}` : ''}.`}
                  {' '}Estimates exclude GST, bank FX fees and any provider minimums.
                </p>
              </>
            )}
          </Card>
        </div>
      )}

      {config && draft && (
        <Card style={{ marginTop: 20 }}>
          <CardHead title="Model pricing" tag={SOURCE_LABEL[meta.source]} />

          <div style={{ fontSize: 13, marginBottom: 12 }}>
            {[['Copy', config.active.copy], ['Vision / analysis', config.active.vision], ['Template analysis', config.active.template], ['Images', config.active.image], ['Video', config.active.video]].map(([label, m]) => (
              <div key={label}><span style={{ color: 'var(--muted)' }}>{label}:</span> {m.label}{m.model ? ` - ${m.model}` : ''}</div>
            ))}
          </div>

          {meta.source !== 'default' && <p className="hint">Saved {fmtDate(meta.updatedAt)}{meta.fetchedAt ? ` · prices looked up ${fmtDate(meta.fetchedAt)}` : ''}.</p>}
          {stale && <p className="error-text">A selected model has changed since these prices were fetched. Fetch again to price the new model.</p>}

          <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Btn variant="primary" loading={fetching} onClick={handleFetch}>Fetch current pricing with AI</Btn>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
              Also price other configured models (for what-if)
            </label>
          </div>
          {fetching && <p className="hint">Searching official pricing pages. This can take up to a minute and uses a small amount of AI credit.</p>}

          {proposal?.warnings?.length > 0 && (
            <div style={{ margin: '12px 0', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 }}>
              <strong>Check these:</strong>
              <ul style={{ margin: '6px 0 0 18px' }}>{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}

          <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Exchange rate</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>₹ per US$ 1</span>
            <input type="number" min={1} step="0.01" style={priceInput} value={fxDraft} onChange={(e) => { setFxDraft(e.target.value); setEdited(true); }} />
            <span className="hint" style={{ margin: 0 }}>
              {config.fx?.isDefault ? 'Built-in starting rate (16 Oct 2026) - fetch or edit, then save.' : `Saved ${fmtDate(config.fx?.updatedAt)}.`}
              {proposal?.fxSource ? <> <a href={proposal.fxSource} target="_blank" rel="noreferrer">source ↗</a></> : null}
            </span>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>Providers bill in US$, so the tables below stay in dollars; the estimate above converts to rupees with this rate.</p>

          <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Text (USD per 1M tokens)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead><tr><th style={th}>Provider</th><th style={th}>Input</th><th style={th}>Output</th></tr></thead>
              <tbody>
                {providerRows.text.map((p) => (
                  <tr key={p}>
                    <td style={td}>{labelOf(p)}<div className="hint" style={{ margin: 0 }}>{modelOf('text', p)}</div></td>
                    <td style={td}><input type="number" min={0} step="any" style={priceInput} value={draft.text[p].input} onChange={(e) => editDraft('text', p, 'input', e.target.value)} /></td>
                    <td style={td}><input type="number" min={0} step="any" style={priceInput} value={draft.text[p].output} onChange={(e) => editDraft('text', p, 'output', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Images (USD per image)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead><tr><th style={th}>Provider</th>{RES_FIELDS.map((r) => <th key={r} style={th}>{r}</th>)}</tr></thead>
              <tbody>
                {providerRows.image.map((p) => (
                  <tr key={p}>
                    <td style={td}>{labelOf(p)}<div className="hint" style={{ margin: 0 }}>{modelOf('image', p)}</div></td>
                    {RES_FIELDS.map((r) => (
                      <td key={r} style={td}><input type="number" min={0} step="any" style={priceInput} value={draft.image[p][r]} onChange={(e) => editDraft('image', p, r, e.target.value)} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta.source === 'default' && <p className="hint">Until fetched, 2K and 4K both use the built-in &quot;high&quot; price, so 4K is probably understated.</p>}

          <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Video (USD per second, no audio)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 320 }}>
              <thead><tr><th style={th}>Provider</th><th style={th}>Per second</th></tr></thead>
              <tbody>
                {providerRows.video.map((p) => (
                  <tr key={p}>
                    <td style={td}>{labelOf(p)}<div className="hint" style={{ margin: 0 }}>{modelOf('video', p)}</div></td>
                    <td style={td}><input type="number" min={0} step="any" style={priceInput} value={draft.video[p].perSecond} onChange={(e) => editDraft('video', p, 'perSecond', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(proposal?.sources?.length > 0 || meta.sources?.length > 0) && (
            <details style={{ marginTop: 16 }} open={Boolean(proposal)}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>Where these prices came from</summary>
              <ul style={{ margin: '8px 0 0 18px', fontSize: 13 }}>
                {(proposal?.sources || meta.sources).map((s, i) => (
                  <li key={`${s.label}-${i}`} style={{ marginBottom: 6 }}>
                    <strong>{s.label}</strong> <span style={{ color: 'var(--muted)' }}>({s.confidence} confidence)</span>
                    {s.url ? <> - <a href={s.url} target="_blank" rel="noreferrer">source ↗</a></> : ' - no source link given'}
                    {s.note ? <div className="hint" style={{ margin: 0 }}>{s.note}</div> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="btn-row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
            <Btn variant="primary" loading={saving} onClick={handleSave}>Save pricing</Btn>
            {meta.source !== 'default' && <Btn variant="secondary" loading={saving} onClick={handleReset}>Reset to built-in prices</Btn>}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            AI-read prices can be wrong, so check the source links before saving. Saving also updates the &quot;~$&quot; cost tags
            users see next to generate buttons. You can edit any figure by hand.
          </p>
        </Card>
      )}
    </Layout>
  );
}
