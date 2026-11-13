import React, { useEffect, useRef, useState } from 'react';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage as errMsg, resolveAssetUrl } from '../../api/client.js';
import { TABS, ago, fmtSize } from './brandSpec.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';

const STEPS = [['Reading the guidelines', 'Guidelines'], ['Finding logo and asset rules', 'Assets'], ['Finding colors', 'Colors'], ['Finding imagery rules', 'Imagery'], ['Finding languages and fonts', 'Languages & Fonts']];
const MAX_PDF = 30 * 1048576;

/** The guidelines PDF card: drop a PDF, Automatr's AI reads it and fills every tab. Everything it fills can be edited afterwards. */
export default function GuidelinesPdf({ onGoTab }) {
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const doc = brand.profile.doc;
  const [phase, setPhase] = useState('idle'); // idle | working | error
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState(4);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const busy = useRef(false);

  // The read is one long request, so the bar creeps forward on its own and the step chips tick over while we wait.
  useEffect(() => {
    if (phase !== 'working') return undefined;
    setPct(4);
    const t = setInterval(() => setPct((p) => p + (92 - p) * 0.035), 600);
    return () => clearInterval(t);
  }, [phase]);
  const stepIdx = Math.min(STEPS.length - 1, Math.floor(pct / (92 / STEPS.length)));

  const pick = () => { if (input.current) { input.current.value = ''; input.current.click(); } };

  function fail(text) { busy.current = false; setMsg(text); setPhase('error'); }

  async function go(file) {
    if (busy.current) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { fail('That isn\'t a PDF. Choose your brand guidelines as a PDF file.'); return; }
    if (file.size > MAX_PDF) { fail('That PDF is over 30 MB. Export a smaller copy and try again.'); return; }
    busy.current = true;
    setPhase('working');
    try {
      const res = await brandAssetsApi.readGuidelines(file);
      brand.setProfile(res);
      await brand.reloadAssets().catch(() => {});
      brand.bump();
      busy.current = false;
      setPhase('idle');
      const n = Object.values(res.items || {}).flat().filter((it) => it.from === 'pdf').length;
      toast(`Read your guidelines: ${n} instruction${n === 1 ? '' : 's'} added across ${TABS.length} tabs`);
    } catch (e) { fail(errMsg(e) || 'Something went wrong reading that PDF.'); }
  }
  function onFile(f) {
    if (!f) return;
    if (doc) confirmDlg('Replace the guidelines PDF?', "We'll read the new PDF and replace what came from the old one. Anything you added or edited yourself stays.", 'Replace', () => go(f));
    else go(f);
  }
  function remove() {
    confirmDlg('Remove the guidelines PDF?', 'This removes what we read from it. Anything you added or edited yourself stays.', 'Remove', async () => {
      try {
        brand.setProfile(await brandAssetsApi.removeGuidelines());
        await brand.reloadAssets().catch(() => {});
        brand.bump();
        toast('PDF removed');
      } catch (e) { toast(errMsg(e)); }
    });
  }

  const stored = doc && brand.assets.find((a) => String(a._id) === String(doc.assetId));
  const showReady = doc && phase === 'idle';
  const showEmpty = !doc && phase === 'idle';
  const bits = doc ? [doc.pages ? `${doc.pages} pages` : '', doc.size ? fmtSize(doc.size) : '', `read ${ago(doc.at)}`].filter(Boolean) : [];

  return (
    <section className="bk-card" id="pdf-card" aria-label="Brand guidelines PDF">
      <div className="bk-card__head">
        <div><p className="bk-eyebrow">Brand guidelines PDF</p></div>
        {showReady && (
          <div className="bk-card__actions">
            {stored && <a className="bk-link" href={resolveAssetUrl(stored.url)} target="_blank" rel="noopener noreferrer">View PDF</a>}
            <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={pick}>Replace PDF</button>
            <button type="button" className="bk-link bk-link--danger" onClick={remove}>Remove PDF</button>
          </div>
        )}
      </div>
      <input ref={input} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => onFile(e.target.files && e.target.files[0])} />

      {showEmpty && (
        <div>
          <div
            className={`bk-drop${over ? ' is-over' : ''}`} tabIndex={0} role="button" aria-label="Upload your brand guidelines PDF. Press Enter to choose a file."
            onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
            onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer && e.dataTransfer.files[0]); }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M11 5h13l7 7v21a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" stroke="#2e5eff" strokeWidth="1.8" strokeLinejoin="round" /><path d="M24 5v7h7" stroke="#2e5eff" strokeWidth="1.8" strokeLinejoin="round" /><path d="M14 22h12M14 27h8" stroke="#2e5eff" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <h3>Drop your brand guidelines PDF here</h3>
            <p>We read it and pick out the instructions that matter for Automatr. You can edit everything after.</p>
            <button type="button" className="bp-btn bp-btn--primary" onClick={(e) => { e.stopPropagation(); pick(); }}><span>Choose PDF</span></button>
          </div>
        </div>
      )}

      {phase === 'working' && (
        <div role="status" aria-live="polite">
          <div className="bk-work">
            <p className="bk-work__label">{`${STEPS[stepIdx][0]}…`}</p>
            <div className="bk-bar"><span style={{ width: `${Math.round(pct)}%` }} /></div>
            <ul className="bp-steps" aria-hidden="true">
              {STEPS.map(([, label], i) => <li key={label} className={`bp-step${i < stepIdx ? ' is-done' : ''}`}>{label}</li>)}
            </ul>
            <p className="bk-work__sub">Your PDF is kept with this brand and read by Automatr's AI. A long document can take a minute or two.</p>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div>
          <div className="bk-fail">
            <div className="bk-fail__icon" aria-hidden="true">!</div>
            <h3>We couldn't use that file</h3>
            <p>{msg}</p>
            <div className="bp-form__btns bp-form__btns--center">
              {doc && <button type="button" className="bp-btn bp-btn--outline" onClick={() => { setPhase('idle'); busy.current = false; }}>Keep current guidelines</button>}
              <button type="button" className="bp-btn bp-btn--primary" onClick={() => { setPhase(doc ? 'idle' : 'idle'); busy.current = false; pick(); }}><span>Choose another PDF</span></button>
            </div>
          </div>
        </div>
      )}

      {showReady && (
        <div>
          <div className="bp-doc">
            <div className="bp-doc__icon" aria-hidden="true">PDF</div>
            <div className="bp-doc__meta"><p className="bp-doc__name">{doc.name}</p><p className="bp-doc__sub">{bits.join(' · ')}</p></div>
          </div>
          <p className="bp-found">{`${brand.pdfCount()} instructions found and sorted into your tabs`}</p>
          <div className="bp-chips">
            {TABS.map((t) => <button key={t.id} type="button" className="bp-chip" onClick={() => onGoTab(t.id)}>{`${t.label} · ${brand.pdfCount(t)}`}</button>)}
          </div>
          <p className="bp-note">Read from the full guidelines, with page numbers where we could tell. Only what applies to Automatr is kept. Please check each tab.</p>
          {doc.skipped && doc.skipped.length > 0 && (
            <details className="bk-skipped">
              <summary>{`Left out because Automatr doesn't need it (${doc.skipped.length})`}</summary>
              <ul>{doc.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
