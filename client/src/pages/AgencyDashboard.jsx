import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { Card, CardHead, Chip, ErrorText } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { adminApi } from '../api/resources.js';
import { apiErrorMessage, resolveAssetUrl } from '../api/client.js';

// ---- formatting ------------------------------------------------------------------------------
// Costs are logged in US$; show rupees when the estimator has a rate saved (same as the AI usage page).
function makeMoney(rate) {
  return (usd) => {
    const v = usd || 0;
    if (rate) {
      const n = v * rate;
      if (n === 0) return '₹0';
      if (n < 0.01) return '<₹0.01';
      return `₹${n.toLocaleString('en-IN', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (!v) return '$0.00';
    return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  };
}

const fmtInt = (n) => (n || 0).toLocaleString('en-IN');

function timeAgo(iso) {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days}d ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_BADGE = {
  active: 'badge--live',
  suspended: 'badge--review',
  archived: 'badge--draft'
};
const POST_STATUS = { draft: 'Draft', in_review: 'In review', approved: 'Approved', published: 'Published' };

const TH = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 12 };
const THR = { ...TH, textAlign: 'right' };
const TD = { padding: '10px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
const TDR = { ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };

function Meter({ value }) {
  if (value == null) return <span className="hint">no cap</span>;
  const cls = value >= 1 ? 'over' : value >= 0.8 ? 'warn' : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className={`ag-meter ${cls}`.trim()} style={{ flex: 1 }}>
        <i style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
      </div>
      <span className="hint" style={{ minWidth: 34, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function CapCell({ used, limit }) {
  if (limit == null) return <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtInt(used)} <span className="hint">/ ∞</span></span>;
  const ratio = limit ? used / limit : 1;
  return (
    <div style={{ minWidth: 110 }}>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtInt(used)} <span className="hint">/ {fmtInt(limit)}</span></span>
      <Meter value={ratio} />
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function SeverityTag({ severity }) {
  return <span className={`ag-sev ag-sev--${severity}`}>{severity}</span>;
}

// ---- tabs ------------------------------------------------------------------------------------

function SpendTrend({ trend, money }) {
  const max = Math.max(...trend.map((t) => t.total), 0.0001);
  const total = trend.reduce((s, t) => s + t.total, 0);
  return (
    <Card>
      <CardHead title="AI spend, last 14 days" tag={money(total)} />
      <div className="ag-bars">
        {trend.map((t) => (
          <div className="ag-bars__col" key={t.day} title={`${t.day}: ${money(t.total)} across ${t.calls} call(s)`}>
            <div className="ag-bars__bar" style={{ height: `${Math.max(2, (t.total / max) * 100)}%` }} />
            <span className="ag-bars__lbl">{t.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TopModels({ models, money }) {
  return (
    <Card>
      <CardHead title="Top models this month" />
      {models.length === 0 && <div className="empty-state">No AI calls yet this month.</div>}
      {models.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {models.map((m, i) => (
              <tr key={i}>
                <td style={TD}>
                  <strong style={{ fontWeight: 600 }}>{m.model || m.provider}</strong>
                  <div className="hint">{m.type} · {m.provider}</div>
                </td>
                <td style={TDR}>{fmtInt(m.calls)} calls</td>
                <td style={TDR}>{money(m.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ActivityFeed({ items, limit, showCustomer = true }) {
  const list = limit ? items.slice(0, limit) : items;
  if (list.length === 0) return <div className="empty-state">Nothing here yet.</div>;
  return (
    <ul className="ag-feed">
      {list.map((a, i) => (
        <li key={i}>
          <span className={`ag-feed__dot ${a.kind === 'ai' ? 'ai' : ''}`.trim()}>{a.kind === 'ai' ? 'AI' : 'PO'}</span>
          <div>
            <p className="ag-feed__title">{a.title}</p>
            <p className="ag-feed__meta">
              {showCustomer && a.customerName ? <>{a.customerName} · </> : null}
              {a.who}
              {a.detail ? ` · ${a.detail}` : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="ag-feed__meta" style={{ margin: 0 }}>{timeAgo(a.at)}</p>
            {a.kind === 'post' && a.status ? <span className={`badge ${a.status === 'published' ? 'badge--live' : a.status === 'draft' ? 'badge--draft' : 'badge--review'}`}>{POST_STATUS[a.status] || a.status}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AlertList({ alerts, limit }) {
  const list = limit ? alerts.slice(0, limit) : alerts;
  if (list.length === 0) return <div className="empty-state">All clear - nothing needs attention right now.</div>;
  return (
    <div>
      {list.map((a, i) => (
        <div className="ag-alert" key={i}>
          <SeverityTag severity={a.severity} />
          <div>
            <p className="ag-feed__title">{a.title}{a.customerName ? ` · ${a.customerName}` : ''}</p>
            <p className="ag-feed__meta">{a.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({ data, money, goTab }) {
  const { kpis } = data;
  const budgetPct = kpis.spend.budgetUsd ? kpis.spend.monthUsd / kpis.spend.budgetUsd : null;
  const delta = kpis.spend.prevMonthUsd ? (kpis.spend.monthUsd - kpis.spend.prevMonthUsd) / kpis.spend.prevMonthUsd : null;
  return (
    <>
      <div className="stats-row stats-row--4">
        <Stat label="Customers" value={`${kpis.customers.active}`} sub={`${kpis.customers.total} total${kpis.customers.suspended ? ` · ${kpis.customers.suspended} suspended` : ''} · ${fmtInt(kpis.users.total)} users`} />
        <Stat
          label="AI spend this month"
          value={money(kpis.spend.monthUsd)}
          sub={[
            delta != null ? `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% vs last month` : 'no spend last month',
            budgetPct != null ? `${Math.round(budgetPct * 100)}% of budgets` : null
          ].filter(Boolean).join(' · ')}
        />
        <Stat label="Generations this month" value={fmtInt(kpis.generations.monthCalls)} sub={`${fmtInt(kpis.generations.images)} images · ${fmtInt(kpis.generations.videos)} videos (customer users)`} />
        <Stat label="Assets this month" value={fmtInt(kpis.posts.month)} sub={`${fmtInt(kpis.posts.inReview)} awaiting approval · ${fmtInt(kpis.posts.published)} published overall`} />
      </div>

      <div className="ag-grid">
        <SpendTrend trend={data.trend} money={money} />
        <TopModels models={data.topModels} money={money} />
      </div>

      <div className="ag-grid">
        <Card>
          <CardHead
            title="Needs attention"
            tag={data.alerts.length ? `${data.alerts.length}` : undefined}
            action={data.alerts.length > 5 ? <button type="button" className="btn btn-ghost" onClick={() => goTab('alerts')}>View all →</button> : undefined}
          />
          <AlertList alerts={data.alerts} limit={5} />
        </Card>
        <Card>
          <CardHead title="Latest activity" action={<button type="button" className="btn btn-ghost" onClick={() => goTab('activity')}>View all →</button>} />
          <ActivityFeed items={data.activity} limit={6} />
        </Card>
      </div>

      {data.pendingApprovals.length > 0 && (
        <Card>
          <CardHead title="Waiting for approval" tag={`${data.pendingApprovals.length}`} />
          <div className="table-scroll">
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr><th style={TH}>Customer</th><th style={TH}>Asset</th><th style={TH}>Created by</th><th style={TH}>Approver</th><th style={THR}>Waiting</th></tr>
              </thead>
              <tbody>
                {data.pendingApprovals.map((p) => (
                  <tr key={p.id}>
                    <td style={TD}>{p.customerName || '-'}</td>
                    <td style={TD}>{p.purpose || 'Asset'}</td>
                    <td style={TD}>{p.who || '-'}</td>
                    <td style={TD}>{p.approver || '-'}</td>
                    <td style={TDR}>{timeAgo(p.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function CustomersTab({ customers }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const rows = customers.filter((c) => (filter === 'all' ? true : c.status === filter) && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Card>
      <CardHead title="Customers" tag={`${rows.length} of ${customers.length}`} action={<Link to="/admin/customers" className="btn btn-ghost">Manage customers →</Link>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <div className="chip-row">
          {['all', 'active', 'suspended', 'archived'].map((s) => (
            <Chip key={s} selected={filter === s} onClick={() => setFilter(s)}>{s[0].toUpperCase() + s.slice(1)}</Chip>
          ))}
        </div>
        <input type="search" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} />
      </div>
      {rows.length === 0 && <div className="empty-state">No customers match.</div>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={TH}>Customer</th>
                <th style={TH}>Status</th>
                <th style={THR}>Users</th>
                <th style={THR}>Assets</th>
                <th style={THR}>In review</th>
                <th style={THR}>This month</th>
                <th style={TH}>Last activity</th>
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={TD}>
                    <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                    <div className="hint">{c.industry} · since {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</div>
                  </td>
                  <td style={TD}><span className={`badge ${STATUS_BADGE[c.status] || 'badge--draft'}`}>{c.status}</span></td>
                  <td style={TDR}>{c.activeUsers}{c.users !== c.activeUsers ? <span className="hint"> / {c.users}</span> : null}</td>
                  <td style={TDR}>{fmtInt(c.posts)}</td>
                  <td style={TDR}>{fmtInt(c.inReview)}</td>
                  <td style={TDR}>{fmtInt(c.monthPosts)} assets</td>
                  <td style={TD}>{timeAgo(c.lastActivityAt)}</td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link to={`/admin/customers/${c.id}/brand`} className="link-btn">Brand assets</Link>{' · '}
                    <Link to={`/admin/customers/${c.id}/gallery`} className="link-btn">Gallery</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UsageTab({ customers, money }) {
  const [sort, setSort] = useState('month');
  const rows = useMemo(() => {
    const list = customers.filter((c) => c.status !== 'archived' || c.totalCostUsd > 0);
    const keys = { month: (c) => c.monthCostUsd, total: (c) => c.totalCostUsd, budget: (c) => c.budget.used ?? -1, calls: (c) => c.monthCalls };
    return [...list].sort((a, b) => keys[sort](b) - keys[sort](a));
  }, [customers, sort]);
  const totalMonth = rows.reduce((s, c) => s + c.monthCostUsd, 0);
  return (
    <Card>
      <CardHead title="Customer usage" tag={`${money(totalMonth)} this month`} action={<Link to="/admin/ai-usage" className="btn btn-ghost">Detailed spend log →</Link>} />
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {[['month', 'Spend this month'], ['total', 'All-time spend'], ['budget', 'Budget used'], ['calls', 'Calls this month']].map(([k, l]) => (
          <Chip key={k} selected={sort === k} onClick={() => setSort(k)}>{l}</Chip>
        ))}
      </div>
      {rows.length === 0 && <div className="empty-state">No usage recorded yet.</div>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={TH}>Customer</th>
                <th style={THR}>Spend this month</th>
                <th style={TH}>Monthly budget</th>
                <th style={TH}>Images (cycle)</th>
                <th style={TH}>Videos (cycle)</th>
                <th style={THR}>Text / Img / Vid calls</th>
                <th style={THR}>All-time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={TD}>
                    <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                    {c.status !== 'active' ? <span className={`badge ${STATUS_BADGE[c.status]}`} style={{ marginLeft: 8 }}>{c.status}</span> : null}
                  </td>
                  <td style={TDR}>{money(c.monthCostUsd)}</td>
                  <td style={{ ...TD, minWidth: 170 }}>
                    <Meter value={c.budget.used} />
                    {c.budget.monthlyUsd != null && <div className="hint">of {money(c.budget.monthlyUsd)}{c.budget.enforce ? ' · enforced' : ''}</div>}
                  </td>
                  <td style={TD}><CapCell used={c.generation?.images.used} limit={c.generation?.images.limit} /></td>
                  <td style={TD}><CapCell used={c.generation?.videos.used} limit={c.generation?.videos.limit} /></td>
                  <td style={TDR}>{fmtInt(c.textCalls)} / {fmtInt(c.imageCalls)} / {fmtInt(c.videoCalls)}</td>
                  <td style={TDR}>{money(c.totalCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Image and video counts are this customer&apos;s own users in their current billing cycle (agency admins are never counted). Spend is the estimated provider cost.
      </p>
    </Card>
  );
}

function ActivityTab({ activity, customers }) {
  const [kind, setKind] = useState('all');
  const [customerId, setCustomerId] = useState('');
  const items = activity.filter((a) => (kind === 'all' || a.kind === kind) && (!customerId || a.customerId === customerId));
  return (
    <Card>
      <CardHead title="Recent activity" tag="assets and AI generations" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <div className="chip-row">
          {[['all', 'Everything'], ['post', 'Assets'], ['ai', 'AI generations']].map(([k, l]) => (
            <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>{l}</Chip>
          ))}
        </div>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} aria-label="Filter by customer">
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <ActivityFeed items={items} />
    </Card>
  );
}

function AlertsTab({ alerts }) {
  const [sev, setSev] = useState('all');
  const list = alerts.filter((a) => sev === 'all' || a.severity === sev);
  return (
    <Card>
      <CardHead title="Needs attention" tag={`${alerts.length}`} />
      <div className="chip-row" style={{ marginBottom: 6 }}>
        {['all', 'high', 'medium', 'low'].map((s) => (
          <Chip key={s} selected={sev === s} onClick={() => setSev(s)}>{s[0].toUpperCase() + s.slice(1)}</Chip>
        ))}
      </div>
      <AlertList alerts={list} />
    </Card>
  );
}

// ---- latest creations gallery ----------------------------------------------------------------

function LatestGallery() {
  const [items, setItems] = useState(null);
  const [shown, setShown] = useState(12);
  const [open, setOpen] = useState(-1); // index of the item in the lightbox, -1 = closed

  useEffect(() => {
    let alive = true;
    adminApi.getAgencyGallery().then((r) => { if (alive) setItems(r.items || []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (open < 0 || !items) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(-1);
      else if (e.key === 'ArrowRight') setOpen((i) => Math.min(items.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setOpen((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items]);

  // Loading: hold the space with a quiet skeleton so the page does not jump when the gallery arrives.
  if (!items) {
    return (
      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Latest creations" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ aspectRatio: '1 / 1', borderRadius: 10, background: '#EEF0F6' }} />)}
        </div>
      </Card>
    );
  }
  if (items.length === 0) return null; // nothing generated yet
  const cur = open >= 0 ? items[open] : null;
  const navBtn = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: 22, border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 22, cursor: 'pointer' };

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead title="Latest creations" tag={`${items.length} newest across all customers`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {items.slice(0, shown).map((it, idx) => (
          <button key={it.id} type="button" onClick={() => setOpen(idx)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }} aria-label={`Preview ${it.title}`}>
            <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', background: '#0F1220' }}>
              {it.type === 'video'
                ? <video src={`${resolveAssetUrl(it.url)}#t=0.1`} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={resolveAssetUrl(it.url)} alt={it.title} loading="lazy" decoding="async" onLoad={(e) => { e.currentTarget.style.opacity = 1; }} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0, transition: 'opacity .25s ease' }} />}
              {it.type === 'video' && <span style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>▶ VIDEO</span>}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.customerName || 'Customer'}</p>
            <p className="hint" style={{ margin: 0 }}>{it.title} · {timeAgo(it.at)}</p>
          </button>
        ))}
      </div>
      {items.length > shown && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setShown((n) => n + 12)}>Show more</button>
        </div>
      )}

      {cur && (
        <div role="dialog" aria-modal="true" aria-label={cur.title} onClick={() => setOpen(-1)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(8,10,18,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: 'min(92vw, 1100px)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {cur.type === 'video'
              ? <video key={cur.id} src={resolveAssetUrl(cur.url)} controls autoPlay style={{ maxWidth: '100%', maxHeight: '76vh', borderRadius: 8, background: '#000' }} />
              : <img key={cur.id} src={resolveAssetUrl(cur.url)} alt={cur.title} style={{ maxWidth: '100%', maxHeight: '76vh', borderRadius: 8, objectFit: 'contain' }} />}
            <div style={{ color: '#fff', textAlign: 'center' }}>
              <div style={{ fontWeight: 600 }}>{cur.customerName || 'Customer'} · {cur.title}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>{cur.source} · {timeAgo(cur.at)} · {open + 1} of {items.length}</div>
              <a href={resolveAssetUrl(cur.url)} target="_blank" rel="noopener noreferrer" style={{ color: '#9DB8FF', fontSize: 13 }}>Open in new tab</a>
            </div>
            {open > 0 && <button type="button" aria-label="Previous" onClick={() => setOpen(open - 1)} style={{ ...navBtn, left: -8 }}>‹</button>}
            {open < items.length - 1 && <button type="button" aria-label="Next" onClick={() => setOpen(open + 1)} style={{ ...navBtn, right: -8 }}>›</button>}
          </div>
          <button type="button" aria-label="Close preview" onClick={() => setOpen(-1)} style={{ position: 'absolute', top: 16, right: 20, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </Card>
  );
}

// ---- page ------------------------------------------------------------------------------------

export default function AgencyDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(0);
  const [tab, setTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setError('');
    try {
      setData(await adminApi.getAgencyDashboard());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    adminApi
      .getEstimator()
      .then((c) => {
        const r = Number(c?.fx?.usdToInr);
        if (Number.isFinite(r) && r > 0) setRate(r);
      })
      .catch(() => {});
  }, []);

  const money = useMemo(() => makeMoney(rate), [rate]);
  const alertCount = data?.alerts.length || 0;
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'customers', label: 'Customers' },
    { key: 'usage', label: 'Customer usage' },
    { key: 'activity', label: 'Recent activity' },
    { key: 'alerts', label: alertCount ? `Alerts (${alertCount})` : 'Alerts' }
  ];

  return (
    <Layout eyebrow="Agency" title="Dashboard">
      <div className="page-lede" style={{ maxWidth: 'none', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ maxWidth: 640 }}>
          <p className="topbar__eyebrow">Good day, {user?.name}</p>
          <h1>Every customer, at a glance.</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/admin/customers" className="btn btn-secondary">Add or manage customers</Link>
          <button type="button" className="btn btn-secondary" disabled={refreshing} onClick={load}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      {!data && !error && <LoadingSpinner label="Loading the agency overview…" />}

      {data && (
        <>
          <div className="chip-row ag-tabs">
            {tabs.map((t) => <Chip key={t.key} selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</Chip>)}
          </div>

          {tab === 'overview' && <Overview data={data} money={money} goTab={setTab} />}
          {tab === 'customers' && <CustomersTab customers={data.customers} />}
          {tab === 'usage' && <UsageTab customers={data.customers} money={money} />}
          {tab === 'activity' && <ActivityTab activity={data.activity} customers={data.customers} />}
          {tab === 'alerts' && <AlertsTab alerts={data.alerts} />}
        </>
      )}

      {data && (
        <div style={{ marginTop: 20 }}>
          <LatestGallery />
        </div>
      )}
    </Layout>
  );
}
