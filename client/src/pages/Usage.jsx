import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import { Card, CardHead, Btn, Chip, ErrorText } from '../components/ui.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { aiApi } from '../api/resources.js';
import { apiErrorMessage, resolveAssetUrl } from '../api/client.js';

// Customer-facing usage: the monthly allowance plus a log of every generation in the workspace
// (images, videos, captions, suggestions, adaptations ...). No costs or model names - those are agency-only.

const TYPES = [
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' }
];
const WINDOWS = [
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'all', label: 'All time' }
];

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dayStr = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000); return d.toISOString().slice(0, 10); };

function Meter({ label, data, generated }) {
  // The number and the bar are both in customer generations (completed creative sessions). `data` is the workspace's
  // generations used against the generation limit the agency set - not the AI image / video allowance behind it.
  const { used = 0, limit } = data || {};
  const unlimited = limit === null || limit === undefined;
  const left = unlimited ? null : Math.max(0, limit - used);
  const pct = unlimited || limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const out = !unlimited && left === 0;
  const low = !unlimited && !out && left / limit <= 0.2;
  const color = out ? '#C23B3B' : low ? '#C77A12' : 'var(--blue)';
  return (
    <div style={{ flex: '1 1 220px', minWidth: 200 }}>
      <div className="hint" style={{ margin: 0 }}>{label} this month</div>
      <div style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 6px', color: out ? color : 'inherit' }}>
        {generated ?? 0} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>generated</span>
      </div>
      {!unlimited && (
        <div style={{ height: 5, borderRadius: 3, background: 'var(--fog, #eef0f5)', overflow: 'hidden' }} aria-hidden="true">
          <div style={{ width: `${pct}%`, height: '100%', background: color }} />
        </div>
      )}
    </div>
  );
}

const TH = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD = { padding: '9px 10px', borderBottom: '1px solid var(--line)', fontSize: 13, verticalAlign: 'top' };

export default function Usage() {
  const [type, setType] = useState('image');
  const [win, setWin] = useState('30');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setPage(1); }, [type, win]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = { page, limit: 25, ...(type ? { type } : {}), ...(win !== 'all' ? { from: dayStr(Number(win)) } : {}) };
    aiApi.getUsage(params)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(apiErrorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [type, win, page]);

  const logs = data?.logs || [];
  const mine = data?.scope === 'mine';

  return (
    <Layout eyebrow="Workspace" title="Usage">
      <div className="page-lede">
        <p>
          {mine ? 'The images and videos you have generated' : `The images and videos generated in ${data?.customerName || 'your workspace'}`}, newest first.
        </p>
      </div>

      {data?.allowance && (
        <Card style={{ marginBottom: 18 }}>
          {data.allowance.plan === 'one_time'
            ? <CardHead title="Your package" tag="One-time · no renewal" />
            : <CardHead title="This month" tag={`Resets ${fmtDate(data.allowance.resetsAt)}`} />}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Meter label="Images" data={data.customerGenerations?.images} generated={data.completedCards?.images?.count} />
            <Meter label="Videos" data={data.customerGenerations?.videos} generated={data.completedCards?.videos?.count} />
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="chip-row">
            {TYPES.map((t) => <Chip key={t.key} selected={type === t.key} onClick={() => setType(t.key)}>{t.label}</Chip>)}
          </div>
          <div className="chip-row">
            {WINDOWS.map((w) => <Chip key={w.key} selected={win === w.key} onClick={() => setWin(w.key)}>{w.label}</Chip>)}
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        {loading && <LoadingSpinner label="Loading usage…" />}
        {!loading && !error && logs.length === 0 && <p className="hint">Nothing generated for these filters yet.</p>}
        {logs.length > 0 && (
          <>
            <div style={{ overflowX: 'auto', opacity: loading ? 0.5 : 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={TH}>When</th>
                    {!mine && <th style={TH}>Who</th>}
                    <th style={TH}>What</th>
                    <th style={TH}>Creative</th>
                    <th style={TH}>Size</th>
                    <th style={TH}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>{fmtDateTime(l.at)}</td>
                      {!mine && <td style={TD}>{l.user || '—'}</td>}
                      <td style={TD}>
                        {l.activity}
                        <span className="hint" style={{ display: 'block', margin: 0 }}>{l.typeLabel}{l.videoSeconds ? ` · ${l.videoSeconds}s` : ''}</span>
                      </td>
                      <td style={TD}>
                        {l.post?.title || (l.flow ? '' : '—')}
                        {l.flow && <span className="hint" style={{ display: 'block', margin: 0 }}>{l.flow}</span>}
                      </td>
                      <td style={TD}>{l.size || '—'}</td>
                      <td style={TD}>
                        {l.status === 'failed' ? <span style={{ color: '#C23B3B' }}>Failed (not counted)</span> : 'Done'}
                        {l.type === 'image' && l.imageUrl && <> · <a href={resolveAssetUrl(l.imageUrl)} target="_blank" rel="noreferrer">View</a></>}
                        {l.type === 'video' && l.videoUrl && <> · <a href={resolveAssetUrl(l.videoUrl)} target="_blank" rel="noreferrer">View</a></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.totalPages > 1 && (
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
                <Btn variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>← Newer</Btn>
                <span className="hint" style={{ alignSelf: 'center' }}>Page {page} of {data.totalPages}</span>
                <Btn variant="secondary" disabled={page >= data.totalPages || loading} onClick={() => setPage(page + 1)}>Older →</Btn>
              </div>
            )}
          </>
        )}
      </Card>
    </Layout>
  );
}
