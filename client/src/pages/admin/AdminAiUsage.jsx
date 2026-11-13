import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout.jsx';
import { Card, CardHead, Btn, Chip, ErrorText } from '../../components/ui.jsx';
import LoadingSpinner from '../../components/LoadingSpinner.jsx';
import { adminApi } from '../../api/resources.js';
import { apiErrorMessage, resolveAssetUrl } from '../../api/client.js';
import { useLightbox } from '../../context/LightboxContext.jsx';

const ACTION_LABELS = {
  caption: 'Caption',
  copy_directions: 'Copy directions (×6)',
  design_variants: 'Design variants (copy + image)',
  headline: 'Headline',
  copy_modify: 'Copy modify',
  suggestion_look_and_feel: 'AI Suggestion (Look & feel)',
  suggestion_message: 'AI Suggestion (Message)',
  image_generate: 'Image generate',
  image_options: 'Image options (×3)',
  image_port_format: 'Image port to format',
  image_modify: 'Image modify',
  video_generate: 'Video generate',
  video_port_format: 'Video port to format',
  multiscene_video: 'Multi-scene video'
};

const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  seedream: 'Seedream',
  veo: 'Veo',
  kling: 'Kling',
  runway: 'Runway',
  seedance: 'Seedance',
  placeholder: 'Placeholder (no key)'
};

// Costs are logged in US$ (what providers bill). The admin sees them in rupees using
// the rate saved on the Usage Estimator page; falls back to US$ if no rate is available.
let FX_RATE = 0;

function formatCost(usd) {
  if (FX_RATE) {
    const n = (usd || 0) * FX_RATE;
    if (n === 0) return '₹0';
    if (n < 0.01) return '<₹0.01';
    return `₹${n.toLocaleString('en-IN', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (!usd) return '$0.00';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

const inrText = (n) => {
  if (n === 0) return '₹0';
  if (n < 0.01) return '<₹0.01';
  return `₹${n.toLocaleString('en-IN', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// A row's own price: the rupee amount stored when it was generated (at that day's rate), else today's rate.
function rowPrice(log) {
  if (log.fxUsdToInr > 0 && typeof log.costInr === 'number') return inrText(log.costInr);
  return formatCost(log.estimatedCostUsd);
}

// How the price was produced (set on every row logged from now on).
const BASIS = {
  'provider-tokens': { short: 'exact', long: 'Exact: real token usage reported by the provider x the provider token price' },
  'rate-card': { short: 'exact', long: 'Exact: the provider bills this at a fixed price per second / per image' },
  'tokens-estimated': { short: 'estimate', long: 'Estimate from the token formula; replaced by the real bill when the video finishes' },
  'flat-estimate': { short: 'rough', long: 'Rough estimate: a flat price per image (the provider does not report usage for this model)' },
  'not-billed-failed': { short: 'not billed', long: 'Generation failed - the provider does not charge for failed videos' }
};

function priceTitle(log) {
  const parts = [];
  parts.push(`US$${(log.estimatedCostUsd || 0).toFixed(4)}${log.fxUsdToInr > 0 ? ` at ₹${log.fxUsdToInr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} per US$ (rate when generated)` : ''}`);
  if (log.attempts > 1) parts.push(`${formatCost(log.unitCostUsd)} per try x ${log.attempts} tries`);
  if (log.type === 'video' && log.rateUsd) parts.push(`${log.videoSeconds}s${log.resolution ? ` at ${log.resolution}` : ''} - effective US$${log.rateUsd.toFixed(4)} per second`);
  if (log.type === 'image' && log.imageInputTokens) parts.push(`${fmtInt(log.imageInputTokens)} of the input tokens were image tokens`);
  if (BASIS[log.costBasis]) parts.push(BASIS[log.costBasis].long);
  return parts.join('\n');
}

function useInrRate() {
  const [rate, setRate] = useState(0);
  useEffect(() => {
    adminApi
      .getEstimator()
      .then((c) => {
        const r = Number(c?.fx?.usdToInr);
        FX_RATE = Number.isFinite(r) && r > 0 ? r : 0;
        setRate(FX_RATE);
      })
      .catch(() => {});
  }, []);
  return rate;
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const WINDOWS = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '', label: 'All time' }
];

const TABS = [
  { key: 'customers', label: 'By customer' },
  { key: 'models', label: 'By model' },
  { key: 'users', label: 'By user' },
  { key: 'log', label: 'Detailed log' }
];

const TH = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const THR = { ...TH, textAlign: 'right' };
const TD = { padding: '7px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
const TDR = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

const fmtInt = (n) => (n || 0).toLocaleString('en-IN');
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0));
const fmtDuration = (ms) => (!ms ? '' : ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

// Everything the filter bar can narrow the whole page to.
function filterParams(f) {
  const p = {};
  if (f.from || f.to) {
    if (f.from) p.from = f.from;
    if (f.to) p.to = f.to;
  } else if (f.windowKey) p.sinceDays = f.windowKey;
  if (f.customerId) p.customerId = f.customerId;
  if (f.type) p.type = f.type;
  if (f.provider) p.provider = f.provider;
  return p;
}

function Stat({ label, children, sub }) {
  return (
    <div>
      <p className="hint" style={{ margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>{children}</p>
      {sub && <p className="hint" style={{ margin: '2px 0 0' }}>{sub}</p>}
    </div>
  );
}

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fn()
      .then((data) => live && setState({ data, loading: false, error: '' }))
      .catch((e) => live && setState({ data: null, loading: false, error: apiErrorMessage(e) }));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function CustomersTable({ params, onPick }) {
  const { data, loading, error } = useLoad(() => adminApi.getUsageByCustomers(params), [JSON.stringify(params)]);
  const rows = data?.customers || [];
  return (
    <Card>
      <CardHead title="Spend by customer" tag="click a row for its detailed log" />
      <ErrorText>{error}</ErrorText>
      {loading && <LoadingSpinner label="Loading customers…" />}
      {!loading && rows.length === 0 && <p className="hint">No AI activity in this window.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={TH}>Customer</th>
                <th style={THR}>Text</th><th style={THR}>Images</th><th style={THR}>Videos</th>
                <th style={THR}>Tokens in / out</th>
                <th style={THR}>Est. spend</th>
                <th style={THR}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.customerId || 'none'}
                  onClick={() => c.customerId && onPick(c)}
                  style={{ cursor: c.customerId ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fog)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={{ ...TD, fontWeight: 600 }}>{c.customerName || (c.customerId ? '(unnamed)' : '(no customer)')}</td>
                  <td style={TDR}>{fmtInt(c.textCalls)}</td>
                  <td style={TDR}>{fmtInt(c.imageCalls)}</td>
                  <td style={TDR}>{fmtInt(c.videoCalls)}{c.videoSeconds ? <span className="hint"> · {c.videoSeconds}s</span> : null}</td>
                  <td style={TDR}>{fmtTokens(c.inputTokens)} / {fmtTokens(c.outputTokens)}</td>
                  <td style={{ ...TDR, fontWeight: 600 }}>{formatCost(c.totalCostUsd)}</td>
                  <td style={TDR}>{formatTimestamp(c.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ModelsTable({ params }) {
  const { data, loading, error } = useLoad(() => adminApi.getUsageByModels(params), [JSON.stringify(params)]);
  const rows = data?.models || [];
  return (
    <Card>
      <CardHead title="Spend by model" tag="exact model ids" />
      <ErrorText>{error}</ErrorText>
      {loading && <LoadingSpinner label="Loading models…" />}
      {!loading && rows.length === 0 && <p className="hint">No AI activity in this window.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={TH}>Type</th><th style={TH}>Provider</th><th style={TH}>Model</th>
                <th style={THR}>Calls</th><th style={THR}>Tokens in / out</th><th style={THR}>Video secs</th><th style={THR}>Est. spend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...TD, textTransform: 'capitalize' }}>{m.type}</td>
                  <td style={TD}>{PROVIDER_LABELS[m.provider] || m.provider}</td>
                  <td style={TD}>{m.model ? <code>{m.model}</code> : <span className="hint">not recorded (older calls)</span>}</td>
                  <td style={TDR}>{fmtInt(m.calls)}</td>
                  <td style={TDR}>{m.inputTokens || m.outputTokens ? `${fmtTokens(m.inputTokens)} / ${fmtTokens(m.outputTokens)}` : ''}</td>
                  <td style={TDR}>{m.videoSeconds || ''}</td>
                  <td style={{ ...TDR, fontWeight: 600 }}>{formatCost(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UsersList({ params, onSelectUser }) {
  const { data, loading, error } = useLoad(() => adminApi.getUsageByUsers(params), [JSON.stringify(params)]);
  const users = data?.users || [];
  return (
    <Card>
      <CardHead title="Users" />
      <ErrorText>{error}</ErrorText>
      {loading && <LoadingSpinner label="Loading users…" />}
      {!loading && users.length === 0 && <p className="hint">No AI generation activity recorded yet.</p>}
      {!loading && users.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={TH}>User</th><th style={THR}>Text calls</th><th style={THR}>Image calls</th><th style={THR}>Videos</th>
                <th style={THR}>Est. spend</th><th style={THR}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.userId || 'unattributed'}
                  onClick={() => onSelectUser(u)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fog)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={TD}>
                    <span style={{ fontWeight: 600 }}>{u.userName || '(unknown user)'}</span>
                    {u.userEmail && <span className="hint" style={{ display: 'block' }}>{u.userEmail}</span>}
                  </td>
                  <td style={TDR}>{u.textCalls}</td>
                  <td style={TDR}>{u.imageCalls}</td>
                  <td style={TDR}>{u.videoCalls || 0}</td>
                  <td style={TDR}>{formatCost(u.totalCostUsd)}</td>
                  <td style={TDR}>{formatTimestamp(u.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


const REF_ROLE_LABELS = {
  'brand-reference': 'Brand look & feel (style only)',
  layout: 'Preferred layout (starting composition)',
  template: 'Template (preserve this creative)',
  'source-frame': 'Source frame for the video',
  '': 'Reference / product image'
};

/** The reference creatives that were sent to the model alongside the prompt, as clickable thumbnails. */
function ReferenceImages({ files, count }) {
  const { open: openLightbox } = useLightbox();
  const [broken, setBroken] = useState({});
  if (!files.length) {
    return count > 0
      ? <p className="hint" style={{ margin: 0 }}>{count} reference image{count > 1 ? 's were' : ' was'} sent, but the files were not recorded (this generation was made before reference images were saved in the log).</p>
      : <p className="hint" style={{ margin: 0 }}>No reference images were sent with this generation.</p>;
  }
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {files.map((f, i) => {
        const src = resolveAssetUrl(f.url);
        return (
          <div key={`${f.url}-${i}`} style={{ width: 132 }}>
            {broken[i] ? (
              <div style={{ width: 132, height: 132, display: 'grid', placeItems: 'center', border: '1px dashed var(--line)', borderRadius: 8, textAlign: 'center', padding: 8 }} className="hint">File no longer available</div>
            ) : (
              <img
                src={src}
                alt={f.name || 'Reference'}
                onError={() => setBroken((b) => ({ ...b, [i]: true }))}
                onClick={() => openLightbox({ src, title: f.name || 'Reference image', meta: [{ label: 'Sent as', value: REF_ROLE_LABELS[f.role] || REF_ROLE_LABELS[''] }] })}
                style={{ width: 132, height: 132, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', cursor: 'zoom-in', display: 'block', background: 'var(--fog)' }}
              />
            )}
            <p style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 600, wordBreak: 'break-word' }}>{f.name || 'Image'}</p>
            <p className="hint" style={{ margin: 0, fontSize: 11 }}>{REF_ROLE_LABELS[f.role] || REF_ROLE_LABELS['']}</p>
          </div>
        );
      })}
    </div>
  );
}

/** What the customer selected + the exact prompt for one generation (agency admins). */
function GenerationDetail({ id }) {
  const { data, loading, error } = useLoad(() => adminApi.getUsageLogDetail(id), [id]);
  const [copied, setCopied] = useState(false);
  if (loading) return <LoadingSpinner label="Loading details…" />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return null;
  const groups = [];
  for (const o of data.options || []) {
    let g = groups.find((x) => x.name === o.group);
    if (!g) groups.push((g = { name: o.group, items: [] }));
    g.items.push(o);
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <>
    <div style={{ padding: '6px 4px 14px' }}>
      <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Reference creatives sent to the model{data.referenceFiles?.length ? ` (${data.referenceFiles.length})` : ''}</p>
      <ReferenceImages files={data.referenceFiles || []} count={data.referenceCount || 0} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr)', gap: 24, padding: '6px 4px 10px', borderTop: '1px solid var(--line)' }}>
      <div>
        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Options selected</p>
        {!data.hasPost && <p className="hint">This generation isn't linked to a creative, so the customer's selections aren't available.</p>}
        {groups.map((g) => (
          <div key={g.name} style={{ marginBottom: 10 }}>
            <p className="hint" style={{ margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 11 }}>{g.name}</p>
            {g.items.map((o, i) => (
              <p key={i} style={{ margin: '0 0 2px', fontSize: 13 }}>
                <span className="hint">{o.label}: </span>{o.value}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Prompt sent to the model</p>
          {data.prompt && <button type="button" className="link-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
        </div>
        {data.prompt ? (
          <>
            {data.promptSource && data.promptSource !== 'logged' && <p className="hint" style={{ margin: '0 0 6px' }}>Source: {data.promptSource}</p>}
            <pre style={{ margin: 0, padding: 12, background: 'var(--fog)', borderRadius: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>{data.prompt}</pre>
          </>
        ) : (
          <p className="hint">No prompt was recorded for this generation (it was made before prompts were stored).</p>
        )}
      </div>
    </div>
    </>
  );
}

/** The full per-call log: customer, user, model, size, tokens, attempts, time taken, price. */
function LogTable({ params, userId, title = 'Detailed log', showCustomer = true }) {
  const { open: openLightbox } = useLightbox();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState('');
  const key = JSON.stringify({ ...params, userId });
  useEffect(() => setPage(1), [key]);
  const { data, loading, error } = useLoad(() => adminApi.getUsageLogs({ ...params, userId, page, limit: 50 }), [key, page]);
  const logs = data?.logs || [];

  return (
    <Card>
      <CardHead title={title} tag={data ? `${fmtInt(data.total)} calls · ${typeof data.totals?.costInr === 'number' && FX_RATE ? inrText(data.totals.costInr) : formatCost(data.totals?.costUsd)}` : undefined} />
      <ErrorText>{error}</ErrorText>
      {loading && <LoadingSpinner label="Loading log…" />}
      {!loading && logs.length === 0 && <p className="hint">No activity recorded for these filters.</p>}
      {logs.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={TH}>Time</th>
                  {showCustomer && <th style={TH}>Customer</th>}
                  <th style={TH}>User</th>
                  <th style={TH}>What</th>
                  <th style={TH}>Provider · model</th>
                  <th style={TH}>Size</th>
                  <th style={THR}>Tokens in / out</th>
                  <th style={THR}>Tries</th>
                  <th style={THR}>Took</th>
                  <th style={THR}>Price</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const tokens = log.inputTokens || log.outputTokens;
                  return (
                    <React.Fragment key={log._id}>
                    <tr>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>{formatTimestamp(log.createdAt)}</td>
                      {showCustomer && <td style={TD}>{log.customerName || '—'}</td>}
                      <td style={TD}>{log.userName || log.userEmail || '—'}</td>
                      <td style={TD}>
                        {ACTION_LABELS[log.action] || log.action}
                        <span className="hint" style={{ display: 'block', textTransform: 'capitalize' }}>
                          {log.type}{log.type === 'video' && log.videoSeconds ? ` · ${log.videoSeconds}s` : ''}{log.mode ? ` · ${log.mode}` : ''}
                        </span>
                        {log.type === 'image' && log.imageUrl && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => openLightbox({
                              src: log.imageUrl,
                              title: ACTION_LABELS[log.action] || log.action,
                              meta: [
                                { label: 'Customer', value: log.customerName || '—' },
                                { label: 'Model', value: log.model || PROVIDER_LABELS[log.provider] || log.provider },
                                { label: 'Price', value: rowPrice(log) }
                              ]
                            })}
                          >
                            view image
                          </button>
                        )}
                        {(log.type === 'image' || log.type === 'video') && (
                          <button type="button" className="link-btn" style={{ display: 'block' }} onClick={() => setOpenId(openId === log._id ? '' : log._id)}>
                            {openId === log._id ? 'hide options & prompt' : 'options & prompt'}
                          </button>
                        )}
                      </td>
                      <td style={TD}>
                        {PROVIDER_LABELS[log.provider] || log.provider}
                        {log.model && <code style={{ display: 'block', fontSize: 11.5 }}>{log.model}</code>}
                      </td>
                      <td style={TD}>
                        {log.size || ''}
                        {log.resolution ? <span className="hint" style={{ display: 'block' }}>{log.resolution}</span> : null}
                        {log.referenceImages ? <button type="button" className="link-btn" style={{ display: 'block', fontSize: 12 }} onClick={() => setOpenId(log._id)}>{log.referenceImages} reference image{log.referenceImages > 1 ? 's' : ''} · view</button> : null}
                      </td>
                      <td style={TDR} title={log.tokensEstimated ? 'Estimated: about 4 characters per token (providers do not report usage)' : undefined}>
                        {tokens ? `${log.tokensEstimated ? '~' : ''}${fmtInt(log.inputTokens)} / ${fmtInt(log.outputTokens)}` : ''}
                      </td>
                      <td style={TDR}>{log.attempts > 1 ? <b title="Regenerated by the quality checks; every try is priced">{log.attempts}×</b> : log.type === 'image' ? '1' : ''}</td>
                      <td style={TDR}>{fmtDuration(log.durationMs)}</td>
                      <td style={{ ...TDR, fontWeight: 600 }} title={priceTitle(log)}>
                        {rowPrice(log)}
                        {BASIS[log.costBasis] && <span className="hint" style={{ display: 'block', fontWeight: 400, margin: 0 }}>{BASIS[log.costBasis].short}</span>}
                      </td>
                    </tr>
                    {openId === log._id && (
                      <tr>
                        <td colSpan={showCustomer ? 10 : 9} style={{ ...TD, background: 'var(--paper, #fff)' }}>
                          <GenerationDetail id={log._id} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.totalPages > 1 && (
            <div className="btn-row" style={{ marginTop: 16, justifyContent: 'center' }}>
              <Btn variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</Btn>
              <span className="hint" style={{ alignSelf: 'center' }}>Page {page} of {data.totalPages}</span>
              <Btn variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Older →</Btn>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function UserDetail({ user, params, onBack }) {
  return (
    <>
      <button type="button" className="link-btn" onClick={onBack} style={{ marginBottom: 14 }}>← All users</button>
      <Card style={{ marginBottom: 18 }}>
        <CardHead title={user.userName || '(unknown user)'} tag={user.userEmail} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16 }}>
          <Stat label="Est. total spend">{formatCost(user.totalCostUsd)}</Stat>
          <Stat label="Text calls">{user.textCalls}</Stat>
          <Stat label="Image calls">{user.imageCalls}</Stat>
          <Stat label="Videos" sub={`${user.videoSeconds || 0}s`}>{user.videoCalls || 0}</Stat>
          <Stat label="Last activity">{formatTimestamp(user.lastActivityAt)}</Stat>
        </div>
      </Card>
      <LogTable params={params} userId={user.userId} title="Activity log" />
    </>
  );
}

export default function AdminAiUsage() {
  const fxRate = useInrRate(); // re-renders the page once the rate is known
  const [filters, setFilters] = useState({ windowKey: '30', from: '', to: '', customerId: '', type: '', provider: '' });
  const [tab, setTab] = useState('customers');
  const [selectedUser, setSelectedUser] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const params = filterParams(filters);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  useEffect(() => {
    adminApi.listCustomers().then((r) => setCustomers(r.customers || r || [])).catch(() => {});
  }, []);

  const { data: summary, loading: loadingSummary, error } = useLoad(() => adminApi.getUsageSummary(params), [JSON.stringify(params)]);

  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const blob = await adminApi.exportUsageCsv(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(apiErrorMessage(e, 'Could not export.'));
    } finally {
      setExporting(false);
    }
  }

  const selectStyle = { font: 'inherit', fontSize: 13.5, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff' };

  return (
    <Layout eyebrow="Admin" title="AI Usage">
      <div className="page-lede">
        <p>
          A log of every real text, image and video generation, for every customer: who triggered it, which exact model ran,
          the size, tokens, how many tries and what it cost. Prices are estimates from the rates on the Usage Estimator page,
          not provider invoices; token counts are estimated at about 4 characters each.
          {fxRate ? ` Shown in ₹ at ₹${fxRate.toLocaleString('en-IN', { maximumFractionDigits: 2 })} per US$.` : ''}
        </p>
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chip-row">
            {WINDOWS.map((w) => (
              <Chip key={w.key} selected={!filters.from && !filters.to && filters.windowKey === w.key} onClick={() => set({ windowKey: w.key, from: '', to: '' })}>{w.label}</Chip>
            ))}
          </div>
          <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            From <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} style={selectStyle} />
          </label>
          <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            To <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} style={selectStyle} />
          </label>
          <select value={filters.customerId} onChange={(e) => { set({ customerId: e.target.value }); setSelectedUser(null); }} style={selectStyle} aria-label="Customer">
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => set({ type: e.target.value })} style={selectStyle} aria-label="Type">
            <option value="">Text, image &amp; video</option>
            <option value="text">Text</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
          <select value={filters.provider} onChange={(e) => set({ provider: e.target.value })} style={selectStyle} aria-label="Provider">
            <option value="">All providers</option>
            {Object.entries(PROVIDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span style={{ marginLeft: 'auto' }}>
            <Btn variant="secondary" loading={exporting} onClick={exportCsv}>⬇ Export CSV</Btn>
          </span>
        </div>
        <ErrorText>{exportError}</ErrorText>
      </Card>

      <ErrorText>{error}</ErrorText>

      <Card style={{ marginBottom: 18 }}>
        <CardHead title="Summary" />
        {loadingSummary && <LoadingSpinner label="Loading summary…" />}
        {!loadingSummary && summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            <Stat label="Total estimated spend">{formatCost(summary.totalCostUsd)}</Stat>
            <Stat label="Total calls">{fmtInt(summary.totalCalls)}</Stat>
            <Stat label="Tokens in / out">{fmtTokens(summary.inputTokens)} / {fmtTokens(summary.outputTokens)}</Stat>
            <Stat label="Text" sub={formatCost(summary.byType.text?.totalCostUsd || 0)}>{fmtInt(summary.byType.text?.totalCalls)}</Stat>
            <Stat label="Images" sub={formatCost(summary.byType.image?.totalCostUsd || 0)}>{fmtInt(summary.byType.image?.totalCalls)}</Stat>
            <Stat label="Videos" sub={formatCost(summary.byType.video?.totalCostUsd || 0)}>{fmtInt(summary.byType.video?.totalCalls)}</Stat>
          </div>
        )}
      </Card>

      <div className="chip-row" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <Chip key={t.key} selected={tab === t.key} onClick={() => { setTab(t.key); setSelectedUser(null); }}>{t.label}</Chip>
        ))}
      </div>

      {tab === 'customers' && (
        <CustomersTable params={params} onPick={(c) => { set({ customerId: c.customerId }); setTab('log'); }} />
      )}
      {tab === 'models' && <ModelsTable params={params} />}
      {tab === 'users' && !selectedUser && <UsersList params={params} onSelectUser={setSelectedUser} />}
      {tab === 'users' && selectedUser && <UserDetail user={selectedUser} params={params} onBack={() => setSelectedUser(null)} />}
      {tab === 'log' && <LogTable params={params} />}
    </Layout>
  );
}
