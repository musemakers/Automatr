import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { billboardApi } from '../api/resources.js';
import { api, resolveAssetUrl } from '../api/client.js';
import { billboardPresetId } from '../constants/postFormats.js';
import '../styles/billboard.css';

const OUTPUTS = [
  { id: 'tiff', label: 'Print TIFF (CMYK)', hint: '150 PPI at reduced scale, with bleed' },
  { id: 'pdf', label: 'Print PDF (CMYK)', hint: 'Reduced-scale page, trim and bleed marked' },
  { id: 'preview', label: 'Preview with guides', hint: 'RGB image showing trim, bleed and safe area' },
  { id: 'dooh', label: 'Digital billboard image', hint: 'RGB, pixel-exact for LED screens' }
];

const fmtMb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/**
 * "Billboard print files": scale a finished creative to a billboard size and download print-ready files.
 * props: src (the creative, "/uploads/..." path or URL), title (file-name base), formatId (preselects the size when it is a billboard size), onClose
 */
export default function BillboardExportDialog({ src, title, formatId, onClose }) {
  const [cfg, setCfg] = useState(null);
  const [presetId, setPresetId] = useState(() => billboardPresetId(formatId) || '20x10');
  const [customOn, setCustomOn] = useState(false);
  const [cw, setCw] = useState('24');
  const [ch, setCh] = useState('12');
  const [outs, setOuts] = useState(() => new Set(['tiff', 'pdf', 'preview', 'dooh']));
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    billboardApi.config().then((c) => alive.current && setCfg(c)).catch(() => alive.current && setError('Could not load the billboard options.'));
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { alive.current = false; clearTimeout(timer.current); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const preset = cfg?.presets.find((p) => p.id === presetId);
  const wFt = customOn ? Number(cw) : preset?.widthFt;
  const hFt = customOn ? Number(ch) : preset?.heightFt;
  const customOk = !customOn || Boolean(cfg && wFt >= cfg.custom.min && wFt <= cfg.custom.max && hFt >= cfg.custom.min && hFt <= cfg.custom.max);

  const spec = useMemo(() => {
    if (!cfg || !wFt || !hFt) return null;
    // same rule as the server: the smallest reduction (1:10, then 1:20...) whose file stays within the pixel limit
    for (const scale of cfg.print.scales) {
      const k = (12 / scale) * cfg.print.ppi;
      const tw = Math.round(wFt * k);
      const th = Math.round(hFt * k);
      if (tw * th <= cfg.print.maxPixels) {
        return { scale, tw, th, inW: +(wFt * 12 / scale).toFixed(1), inH: +(hFt * 12 / scale).toFixed(1), bleedIn: +(cfg.print.bleedRealIn / scale).toFixed(2) };
      }
    }
    return null;
  }, [cfg, wFt, hFt]);

  function poll(id) {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { job: j } = await billboardApi.get(id);
        if (!alive.current) return;
        setJob(j);
        if (j.status === 'running') poll(id);
      } catch (err) {
        if (!alive.current) return;
        setError(err?.response?.data?.error || 'Lost track of the files. Please try again.');
        setJob(null);
      }
    }, 2500);
  }

  async function start() {
    setError('');
    setBusy(true);
    try {
      const { job: j } = await billboardApi.start({
        sourceUrl: src, title,
        ...(customOn ? { widthFt: wFt, heightFt: hFt } : { presetId }),
        outputs: [...outs], doohWidth: cfg?.doohWidth
      });
      setJob(j);
      poll(j.id);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not start. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function download(f) {
    setDl(f.name);
    setError('');
    try {
      // Ask the server for a short-lived link, then let the browser download it itself (big files stream straight to disk).
      const { url } = await api.get(`/billboard/export/${job.id}/file/${encodeURIComponent(f.name)}/link`).then((r) => r.data);
      const a = document.createElement('a');
      a.href = resolveAssetUrl(url);
      a.download = f.name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      const status = err?.response?.status;
      let msg = err?.response?.data?.error || 'Download failed. Please try again.';
      if (status === 404 && !err?.response?.data?.error) msg = 'The server does not know this download yet. Restart the server so it picks up the latest update, then make the files again.';
      else if (!status) msg = 'Could not reach the server. Check that it is running, then try again.';
      setError(`${msg}${status ? ` (code ${status})` : ''}`);
    } finally {
      setTimeout(() => setDl(''), 1500);
    }
  }

  const preview = job?.files?.find((f) => f.kind === 'preview');
  const [previewSrc, setPreviewSrc] = useState('');
  useEffect(() => {
    if (job?.status !== 'done' || !preview) { setPreviewSrc(''); return undefined; }
    let url = '';
    let cancelled = false;
    api.get(`/billboard/export/${job.id}/file/${encodeURIComponent(preview.name)}`, { responseType: 'blob' })
      .then((res) => { if (!cancelled) { url = URL.createObjectURL(res.data); setPreviewSrc(url); } })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [job?.id, job?.status, preview?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const rd = job?.readability;

  return createPortal(
    <div className="bb-overlay" role="dialog" aria-modal="true" aria-label="Billboard print files" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bb-card">
        <div className="bb-head">
          <h2>Billboard print files</h2>
          <button type="button" className="bb-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="bb-sub">Scale this creative up for a roadside billboard and download print-ready files.</p>

        {!job && (
          <>
            <span className="bb-label">Board size</span>
            <div className="bb-sizes">
              {(cfg?.presets || []).map((p) => (
                <label key={p.id} className={`bb-opt ${!customOn && presetId === p.id ? 'is-on' : ''}`}>
                  <input type="radio" name="bb-size" checked={!customOn && presetId === p.id} onChange={() => { setCustomOn(false); setPresetId(p.id); }} />
                  <span><strong>{p.label}</strong><small>{p.note}</small></span>
                </label>
              ))}
              <label className={`bb-opt ${customOn ? 'is-on' : ''}`}>
                <input type="radio" name="bb-size" checked={customOn} onChange={() => setCustomOn(true)} />
                <span><strong>Custom</strong><small>Your own size in feet</small></span>
              </label>
            </div>
            {customOn && cfg && (
              <div className="bb-custom">
                <input type="number" min={cfg.custom.min} max={cfg.custom.max} value={cw} onChange={(e) => setCw(e.target.value)} aria-label="Width in feet" />
                <span>×</span>
                <input type="number" min={cfg.custom.min} max={cfg.custom.max} value={ch} onChange={(e) => setCh(e.target.value)} aria-label="Height in feet" />
                <span>ft ({cfg.custom.min} to {cfg.custom.max} each)</span>
              </div>
            )}
            {spec && customOk && (
              <div className="bb-spec">
                Built at 1:{spec.scale} scale: a {spec.inW} × {spec.inH} in file, {spec.tw} × {spec.th} px at {cfg.print.ppi} PPI, plus {spec.bleedIn} in bleed on every side. Your printer enlarges it {spec.scale}× to the real board. Keep key content {cfg.print.safePercent}% in from every edge.
              </div>
            )}

            <span className="bb-label">Files to make</span>
            <div className="bb-sizes">
              {OUTPUTS.map((o) => (
                <label key={o.id} className={`bb-opt ${outs.has(o.id) ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={outs.has(o.id)} onChange={(e) => setOuts((prev) => { const n = new Set(prev); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />
                  <span><strong>{o.label}</strong><small>{o.hint}</small></span>
                </label>
              ))}
            </div>
            {cfg && !cfg.smartUpscale && <p className="bb-sub" style={{ marginTop: 12 }}>Smart upscaling is not switched on for this workspace, so a high-quality resize will be used. Ask your admin to enable it for the sharpest large prints.</p>}
            {error && <p className="bb-error" role="alert">{error}</p>}
            <div className="bb-actions">
              <button type="button" className="btn btn-primary" onClick={start} disabled={busy || !cfg || !spec || !customOk || outs.size === 0}>{busy ? 'Starting…' : 'Make billboard files'}</button>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {job?.status === 'running' && (
          <div className="bb-progress" role="status">
            <span className="spinner" />
            <span>{job.stage || 'Working'}… This can take a minute or two for large boards, and you can leave this open.</span>
          </div>
        )}

        {job?.status === 'failed' && (
          <>
            <p className="bb-error" role="alert">{job.error || 'Something went wrong.'}</p>
            <div className="bb-actions"><button type="button" className="btn btn-primary" onClick={() => { setJob(null); setError(''); }}>Try again</button></div>
          </>
        )}

        {job?.status === 'done' && (
          <>
            <span className="bb-label">Your files ({job.spec.widthFt} × {job.spec.heightFt} ft)</span>
            <div className="bb-files">
              {job.files.map((f) => (
                <div key={f.name} className="bb-file">
                  <span><strong>{f.label}</strong><small>{f.detail} · {fmtMb(f.bytes)}</small></span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={() => download(f)} disabled={dl === f.name}>{dl === f.name ? 'Preparing…' : 'Download'}</button>
                  </span>
                </div>
              ))}
            </div>
            {previewSrc && <img className="bb-preview" src={previewSrc} alt="Preview of the billboard with trim, bleed and safe area marked" />}
            {rd && (
              <div className={`bb-note ${rd.issues.length ? 'bb-note--warn' : 'bb-note--ok'}`}>
                <strong>Distance check{rd.score ? `: ${rd.score}/10` : ''}</strong>
                {rd.issues.length > 0 ? <ul>{rd.issues.map((t, i) => <li key={i}>{t}</li>)}</ul> : <div>Reads clearly at a glance.</div>}
                {rd.advice && <div style={{ marginTop: 6 }}>{rd.advice}</div>}
              </div>
            )}
            {job.notes.map((n, i) => <div key={i} className="bb-note">{n}</div>)}
            <p className="bb-sub" style={{ marginTop: 12 }}>These files are kept for 24 hours. Download what you need.</p>
            {error && <p className="bb-error" role="alert">{error}</p>}
            <div className="bb-actions">
              <button type="button" className="btn" onClick={() => { setJob(null); setError(''); }}>Make another size</button>
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
