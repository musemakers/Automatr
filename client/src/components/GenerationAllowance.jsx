import React, { useCallback, useEffect, useState } from 'react';
import { aiApi } from '../api/resources.js';

// Small "what's left this month" panel shown across the Generate Media flow:
// images / videos left, how many were generated, and when the allowance resets.

function daysUntil(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Meter({ label, data, side }) {
  const { used, limit, agencyOnly, topUp } = data;
  const unlimited = limit === null || limit === undefined;
  const left = unlimited ? null : Math.max(0, limit - used);
  const pct = unlimited || limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const out = !unlimited && left === 0;
  const low = !unlimited && !out && left / limit <= 0.2;
  const color = out ? '#C23B3B' : low ? '#C77A12' : 'var(--blue)';

  return (
    <div style={side ? { width: '100%' } : { minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{used} generated</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: out ? color : 'inherit', margin: '2px 0 6px' }}>
        {agencyOnly ? 'Agency only' : unlimited ? 'Unlimited' : `${left} left`}
        {!agencyOnly && !unlimited && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}> of {limit}{topUp > 0 ? ` (incl. +${topUp} top-up)` : ''}</span>}
      </div>
      {!agencyOnly && !unlimited && (
        <div style={{ height: 5, borderRadius: 3, background: 'var(--fog, #eef0f5)', overflow: 'hidden' }} aria-hidden="true">
          <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .3s' }} />
        </div>
      )}
    </div>
  );
}

export default function GenerationAllowance({ variant = 'bar' }) {
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    aiApi.getGenerationAllowance().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('automatr:allowance-refresh', onRefresh);
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(load, 60000);
    return () => {
      window.removeEventListener('automatr:allowance-refresh', onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [load]);

  if (!data?.available) return null;

  const oneTime = data.plan === 'one_time';
  const days = oneTime ? 0 : daysUntil(data.resetsAt);
  const side = variant === 'side';
  return (
    <div
      className="allowance"
      style={{
        ...(side
          ? { flex: '0 0 260px', maxWidth: '100%', padding: 18, flexDirection: 'column', alignItems: 'stretch', gap: 16, position: 'sticky', top: 16 }
          : { margin: '12px 32px 0', padding: '12px 16px', flexWrap: 'wrap', gap: 20, alignItems: 'center' }),
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--paper)',
        display: 'flex'
      }}
    >
      <div style={{ minWidth: 130 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{oneTime ? 'Package allowance' : 'Monthly allowance'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {oneTime ? 'One-time package · no renewal' : <>Resets {fmtDate(data.resetsAt)} · {days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</>}
        </div>
        {data.isAgency && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{data.customerName} · you&apos;re not limited</div>}
      </div>
      <Meter label="Images" data={data.images} side={side} />
      <Meter label="Videos" data={data.videos} side={side} />
    </div>
  );
}
