import React, { useEffect, useRef, useState } from 'react';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage as errMsg } from '../../api/client.js';
import { ago } from './brandSpec.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';

const CFG = {
  photo: { store: 'refFiles', notes: 'refs', field: 'styleSummary', title: 'Style summary for AI image creation', note: 'Colors are measured from the pixels. Everything else comes from our reading of your reference images and your written instructions.' },
  illustration: { store: 'illustrationFiles', notes: 'illustration', field: 'illSummary', title: 'Style summary for AI illustration creation', note: 'Colors are measured from the pixels. Everything else comes from our reading of your reference illustrations and your written instructions.' }
};
const textOf = (r) => r.sections.map((sc) => `${sc.title}: ${(r.edits && r.edits[sc.id]) || sc.text}`).join('\n\n');

/** Reads the reference images into a short style brief for AI image creation. Re-reads when the images or notes change. Every section can be edited. */
export default function StyleSummary({ kind }) {
  const c = CFG[kind];
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const imgs = brand.items(c.store);
  const notes = brand.items(c.notes).map((i) => i.text);
  const r = brand.profile[c.field];
  const n = imgs.length;
  const sig = `${imgs.map((i) => `${i.id}:${i.caption}`).join('|')}#${notes.join('|')}`;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(0);
  const [fail, setFail] = useState('');
  const run = useRef(0);
  const hasSummary = Boolean(r);

  async function read(force) {
    const mine = ++run.current;
    setFail('');
    setBusy(n);
    try {
      const out = await brandAssetsApi.styleSummary(kind, force);
      if (mine !== run.current) return;
      brand.setProfile((p) => ({ ...p, [c.field]: out.summary || null }));
    } catch (e) {
      if (mine === run.current) setFail(errMsg(e));
    } finally { if (mine === run.current) setBusy(0); }
  }

  // read once the list of images or the notes settle (the server answers straight away when nothing changed)
  useEffect(() => {
    if (!brand.ready) return undefined;
    if (!n && !hasSummary) return undefined;
    const t = setTimeout(() => { read(false); }, 700);
    return () => clearTimeout(t);
  }, [sig, brand.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveEdits(edits) {
    try {
      brand.setProfile(await brandAssetsApi.updateProfile({ items: {}, styleEdits: { [kind]: edits } }));
    } catch (e) { toast(errMsg(e)); }
  }
  function rerun() {
    const has = r && r.edits && Object.keys(r.edits).length;
    const go = () => { setEditing(null); read(true); toast('Analysis rerun'); };
    if (has) confirmDlg('Rerun the analysis?', 'This reads your images again and replaces the summary, including any changes you made to it.', 'Rerun', go); else go();
  }
  function copy() {
    const done = () => toast('Summary copied');
    const bad = () => toast("Couldn't copy. Select the text and copy it.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textOf(r)).then(done, bad); else bad();
  }

  if (!n) return null;
  const edits = (r && r.edits) || {};
  return (
    <div className={`bp-style${busy ? ' is-busy' : ''}`}>
      <div className="bp-style__head">
        <div>
          <h4 className="bp-style__title">{c.title}</h4>
          <p className="bp-style__status" aria-live="polite">
            {busy ? `Analysing ${n} image${n > 1 ? 's' : ''}…` : r ? `Based on ${r.count} image${r.count > 1 ? 's' : ''}, read ${ago(r.at)}` : fail}
          </p>
        </div>
        <button type="button" className="bp-add" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((o) => !o)}>{open ? 'Hide summary' : 'View summary'}</button>
      </div>
      {fail && r && <p className="bp-err" role="alert">{fail}</p>}
      {open && r && (
        <>
          <div className="bp-style__bar">
            <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={copy}>Copy summary</button>
            <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={rerun}>Rerun analysis</button>
          </div>
          {r.sections.map((sc) => {
            const edited = edits[sc.id] != null;
            const cur = edited ? edits[sc.id] : sc.text;
            const isEdit = editing === sc.id;
            return (
              <div className="bp-style__sec" key={sc.id}>
                <div className="bp-style__sh">
                  <h5 className="bp-style__h">{sc.title}</h5>
                  {edited ? <span className="bp-tag">Edited by you</span> : null}
                  <div className="bp-style__act">
                    {!isEdit && <button type="button" className="bp-act" aria-label={`Edit ${sc.title}`} onClick={() => { setEditing(sc.id); setDraft(cur); }}>Edit</button>}
                    {!isEdit && edited && (
                      <button type="button" className="bp-add" aria-label={`Reset ${sc.title} to the analysis`} onClick={() => { const next = { ...edits }; delete next[sc.id]; saveEdits(next); }}>Reset</button>
                    )}
                  </div>
                </div>
                {isEdit ? (
                  <div className="bp-style__edit">
                    <button type="button" className="bp-x" aria-label="Close" onClick={() => setEditing(null)}>&times;</button>
                    <textarea
                      className="bp-field bp-style__ta" aria-label={sc.title} autoFocus rows={Math.max(4, Math.min(12, Math.ceil(draft.length / 90)))} maxLength={1200} value={draft}
                      onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }}
                    />
                    <button
                      type="button" className="bp-btn bp-btn--primary bp-btn--sm"
                      onClick={() => {
                        const v = draft.replace(/[ \t]+\n/g, '\n').trim();
                        if (!v) { toast('Write something, or use Reset to go back to the analysis.'); return; }
                        const next = { ...edits };
                        if (v === sc.text) delete next[sc.id]; else next[sc.id] = v;
                        setEditing(null); saveEdits(next);
                      }}
                    ><span>Save</span></button>
                  </div>
                ) : <p className="bp-style__p">{cur}</p>}
                {sc.palette && sc.palette.length > 0 && (
                  <div className="bp-style__pal">{sc.palette.map((h) => <span key={h} className="bp-style__sw" style={{ background: h }} title={h} aria-label={h} />)}</div>
                )}
              </div>
            );
          })}
          <p className="bp-style__note">{`${c.note} Your edits are kept when new images are added. Use Rerun analysis to start again.`}</p>
        </>
      )}
    </div>
  );
}
