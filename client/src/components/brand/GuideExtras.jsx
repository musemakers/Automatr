import React, { useCallback, useEffect, useRef, useState } from 'react';
import PastAssetsLearner from '../PastPostsLearner.jsx';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage as errMsg } from '../../api/client.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';

// What the older Brand guide screen had that the five tabs do not already cover: what was learned from past assets, the
// "what the AI is told" review, the photography guide (.md) and the brand-package ZIP. They keep using the guide API.

function useGuide() {
  const brand = useBrand();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => brandAssetsApi.getGuide().then((p) => { setData(p); setError(''); }).catch((e) => setError(errMsg(e))), []);
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [brand.tick, load]);
  return { data, setData, error };
}

const Head = ({ eyebrow, children }) => (
  <div className="bk-card__head"><div><p className="bk-eyebrow">{eyebrow}</p></div>{children ? <div className="bk-card__actions">{children}</div> : null}</div>
);

/** Rules the AI worked out from the brand's best past assets. Editable. */
export function LearnedCard() {
  const { toast } = useBrandUi();
  const { data, setData, error } = useGuide();
  const [rules, setRules] = useState([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setRules((data.guide.learned || []).map((r) => ({ scope: r.scope, text: r.text }))); }, [data]);

  async function save(next) {
    setRules(next);
    setSaving(true);
    try { setData(await brandAssetsApi.updateGuide({ learned: next.filter((r) => r.text.trim()) })); } catch (e) { toast(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <section className="bk-card" id="learned-card" aria-label="Learned from past assets">
      <Head eyebrow="Learned from past assets">
        <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={() => setOpen(true)}>{rules.length ? 'Learn from more assets' : 'Learn from past assets'}</button>
      </Head>
      <p className="bp-box__desc">Upload the brand’s best published assets (even just one) and the AI works out its visual and writing style. Review the rules it proposes, then they are used on every creative.</p>
      {error && <p className="bp-err" role="alert">{error}</p>}
      {data && rules.length === 0 && <p className="bp-empty">Nothing learned yet.</p>}
      {['design', 'copy'].map((scope) => {
        const rows = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.scope === scope);
        if (!rows.length) return null;
        return (
          <div key={scope}>
            <p className="bp-box__desc" style={{ fontWeight: 600, margin: '14px 0 6px' }}>{scope === 'design' ? 'Visual style' : 'Writing style'}</p>
            <ul className="bp-list bp-list--text">
              {rows.map(({ r, i }) => (
                <li key={i} className="bp-item">
                  <div className="bp-item__main">
                    <textarea
                      className="bp-field bp-textarea" rows={2} maxLength={220} value={r.text} aria-label="Learned rule"
                      onChange={(e) => setRules((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      onBlur={() => { if (data && JSON.stringify(rules.filter((x) => x.text.trim())) !== JSON.stringify((data.guide.learned || []).map((x) => ({ scope: x.scope, text: x.text })))) save(rules); }}
                    />
                  </div>
                  <div className="bp-item__side">
                    <p className="bp-item__meta">Learned from assets</p>
                    <div className="bp-item__act"><button type="button" className="bp-act bp-act--del" aria-label="Remove rule" onClick={() => save(rules.filter((_, j) => j !== i))}>Delete</button></div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {saving && <p className="bp-empty">Saving…</p>}
      {open && <PastAssetsLearner onClose={() => setOpen(false)} onAdd={(added) => save([...rules, ...added])} />}
    </section>
  );
}

/** Plain-language review of what the AI understood and exactly what it is told, with a "mark as reviewed" stamp. */
export function ReviewCard() {
  const { toast } = useBrandUi();
  const { data, setData, error } = useGuide();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  async function markReviewed() {
    setBusy(true);
    try { setData(await brandAssetsApi.updateGuide({ reviewed: true })); toast('Marked as reviewed'); } catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  }
  const p = data && data.preview;
  const g = data && data.guide;
  return (
    <section className="bk-card" id="review-card" aria-label="What the AI understands">
      <Head eyebrow="What the AI understands">
        <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" disabled={busy || !data} onClick={markReviewed}>Mark as reviewed</button>
      </Head>
      {error && <p className="bp-err" role="alert">{error}</p>}
      {!data && !error && <p className="bp-empty">Loading…</p>}
      {data && (
        <>
          <p className="bp-box__desc">
            {`${data.counts.references} reference image${data.counts.references === 1 ? '' : 's'} · ${data.counts.layouts} preferred layout${data.counts.layouts === 1 ? '' : 's'} · ${data.counts.logos} logo${data.counts.logos === 1 ? '' : 's'}.`}
            {g.reviewedAt ? ` Last reviewed ${new Date(g.reviewedAt).toLocaleDateString()}${g.reviewedByName ? ` by ${g.reviewedByName}` : ''}.` : ' Not reviewed yet.'}
          </p>
          {p.understanding.length === 0 && <p className="bp-empty">Nothing yet. Upload a logo, brand image or guideline PDF.</p>}
          {p.understanding.map((r) => <p key={r.label} className="bp-item__text" style={{ margin: '0 0 6px' }}><strong>{r.label}:</strong> {r.value}</p>)}
          <button type="button" className="bp-add" onClick={() => setShow((v) => !v)}>{show ? 'Hide what the AI is told' : 'Show what the AI is told'}</button>
          {show && (
            <div style={{ marginTop: 8 }}>
              <p className="bp-box__desc" style={{ fontWeight: 600 }}>Added to every caption request</p>
              {p.copy.length === 0 ? <p className="bp-empty">Nothing yet.</p> : <ul className="bp-item__text" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{p.copy.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              <p className="bp-box__desc" style={{ fontWeight: 600, marginTop: 14 }}>Added to every image request</p>
              {p.design.length === 0 ? <p className="bp-empty">Nothing yet.</p> : <ul className="bp-item__text" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{p.design.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              <p className="bp-box__desc" style={{ marginTop: 10 }}>Reference images and preferred layouts are attached to image requests automatically. All of this except the photography guide is left out when a creative does not follow the brand (no brand assets selected, or its brand-style tick is off).</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const PHOTO_FIELDS = ['look', 'people', 'product', 'avoid', 'modelSuffix', 'productSuffix'];
const PHOTO_MAX = { look: 800, people: 7000, product: 7000, avoid: 1200, modelSuffix: 800, productSuffix: 800 };
const MAX_MD_BYTES = 200 * 1024;
const photoFrom = (p = {}) => {
  const o = { fileName: p.fileName || '', uploadedAt: p.uploadedAt || null, hasSource: Boolean(p.hasSource), newSource: null };
  PHOTO_FIELDS.forEach((k) => { o[k] = p[k] || ''; });
  return o;
};

/** A photography guide (.md): the AI sorts the file's own wording into boxes to review, then it is saved. Used for photographs only. */
export function PhotographyCard() {
  const { toast, confirmDlg } = useBrandUi();
  const { data, setData, error } = useGuide();
  const [form, setForm] = useState(photoFrom());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [omitted, setOmitted] = useState([]);
  const md = useRef(null);
  useEffect(() => { if (data && !dirty) setForm(photoFrom(data.guide.photography)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const on = PHOTO_FIELDS.some((k) => (form[k] || '').trim());

  async function read(file, reuse = false) {
    setBusy('read'); setNote(''); setOmitted([]);
    try {
      let text = '';
      if (!reuse) {
        if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Choose a .md (Markdown) file.');
        if (file.size > MAX_MD_BYTES) throw new Error('That file is over 200 KB. A photography guide should be much shorter.');
        text = await file.text();
      }
      const r = await brandAssetsApi.readPhotographyGuide(reuse ? '' : file.name, text, reuse);
      setForm((f) => ({ ...f, ...Object.fromEntries(PHOTO_FIELDS.map((k) => [k, r.brief?.[k] || ''])), fileName: r.fileName || f.fileName, newSource: reuse ? null : text, hasSource: reuse ? f.hasSource : true }));
      setDirty(true);
      setOmitted(r.omitted || []);
      setNote(`Read. The text below is your file's own wording, sorted into the boxes (nothing was rewritten).${r.omitted?.length ? ` ${r.omitted.length} line${r.omitted.length === 1 ? ' was' : 's were'} left out because they are not about how photographs look.` : ''}${r.trimmed ? ' A long box was cut at a sentence end to fit its limit.' : ''} Review, then save.`);
    } catch (e) { toast(errMsg(e)); } finally { setBusy(''); if (md.current) md.current.value = ''; }
  }
  async function save(photo) {
    setBusy('save');
    try {
      const out = Object.fromEntries(PHOTO_FIELDS.map((k) => [k, photo[k] || '']));
      out.fileName = photo.fileName || '';
      if (photo.newSource !== null && photo.newSource !== undefined) out.source = photo.newSource;
      const p = await brandAssetsApi.updateGuide({ photography: out });
      setData(p); setForm(photoFrom(p.guide.photography)); setDirty(false); setNote('');
      toast('Photography guide saved');
    } catch (e) { toast(errMsg(e)); } finally { setBusy(''); }
  }
  const remove = () => confirmDlg('Remove the photography guide?', 'The AI will go back to following only the rest of the brand guidelines for photos.', 'Remove', () => save({ ...photoFrom({}), newSource: '' }));
  const area = (k, label, rows, hint) => (
    <div className="bp-form__row" key={k}>
      <label className="bp-form__lab" htmlFor={`ph-${k}`}>{label}</label>
      <textarea id={`ph-${k}`} className="bp-field bp-textarea" rows={rows} maxLength={PHOTO_MAX[k]} value={form[k]} onChange={(e) => set(k)(e.target.value)} />
      <p className="bp-form__hint">{hint ? `${hint} ` : ''}{`${form[k].length} / ${PHOTO_MAX[k]}`}</p>
    </div>
  );

  return (
    <section className="bk-card" id="photo-guide-card" aria-label="Photography guide">
      <Head eyebrow="Photography guide">
        <input ref={md} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
        <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" disabled={Boolean(busy)} onClick={() => md.current?.click()}>{busy === 'read' ? 'Reading…' : on ? 'Replace .md file' : 'Upload .md file'}</button>
      </Head>
      <p className="bp-box__desc">Upload a Markdown (.md) file on how photographs should look: people, skin, styling, products, ingredients, light. Your wording is kept as written, only sorted into the boxes below. Used for photographs only, never for fonts, text or layout.</p>
      {error && <p className="bp-err" role="alert">{error}</p>}
      {!on && <p className="bp-empty">No photography guide yet.</p>}
      {note && <p className="bp-ok">{note}</p>}
      {omitted.length > 0 && (
        <details className="bk-skipped">
          <summary>{`See what was left out (${omitted.length})`}</summary>
          <ul>{omitted.map((o, i) => <li key={i}>{o.text} ({o.why})</li>)}</ul>
        </details>
      )}
      {on && (
        <div className="bp-form" style={{ marginTop: 12 }}>
          <p className="bp-form__hint">{`${form.fileName ? `From ${form.fileName}` : 'Photography guide'}${form.uploadedAt ? ` · uploaded ${new Date(form.uploadedAt).toLocaleDateString()}` : ''}. Edit anything you like. This is what image requests receive.`}</p>
          {area('look', 'Overall look', 2)}
          {area('people', 'Photographs with people', 5, 'Casting, skin, hair, styling, expression, lens, light. The People options chosen in a brief always win over this.')}
          {area('product', 'Photographs of products and ingredients', 5, "The pack's own label, packaging and colors are never changed.")}
          {area('avoid', 'Photography to avoid', 2)}
          <details>
            <summary className="bp-add" style={{ display: 'inline-block' }}>Finishing lines (advanced)</summary>
            {area('modelSuffix', 'Finish for people photographs', 2)}
            {area('productSuffix', 'Finish for product photographs', 2)}
          </details>
          <div className="bp-form__btns">
            {form.hasSource && form.newSource === null && <button type="button" className="bp-act" disabled={Boolean(busy)} onClick={() => read(null, true)}>Read the file again</button>}
            <button type="button" className="bp-act bp-act--del" disabled={Boolean(busy)} onClick={remove}>Remove photography guide</button>
            <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" disabled={!dirty || Boolean(busy)} onClick={() => { setForm(photoFrom(data.guide.photography)); setDirty(false); setNote(''); setOmitted([]); }}>Discard changes</button>
            <button type="button" className="bp-btn bp-btn--primary bp-btn--sm" disabled={!dirty || Boolean(busy)} onClick={() => save(form)}><span>{busy === 'save' ? 'Saving…' : 'Save photography guide'}</span></button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A brand design-system ZIP (or a folder of logos and photos): unpacked and read, then every tab picks up what was found. */
export function PackageCard() {
  const brand = useBrand();
  const { toast } = useBrandUi();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef(null);

  async function go(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    if (!files.every((f) => /\.zip$/i.test(f.name) || /zip/.test(f.type))) { toast('Choose a .zip file.'); return; }
    setBusy(true); setNote('');
    try {
      const r = await brandAssetsApi.upload(files);
      if (r.brandKit && brand.setUser) brand.setUser((prev) => (prev ? { ...prev, brandKit: r.brandKit } : prev));
      setNote(r.analysis?.note || `Unpacked ${r.assets?.length || 0} file${(r.assets?.length || 0) === 1 ? '' : 's'}.`);
      await brand.reloadAll();
      toast('Brand package read');
    } catch (e) { toast(errMsg(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <section className="bk-card" id="package-card" aria-label="Brand package ZIP">
      <Head eyebrow="Brand package (ZIP)" />
      <div
        className={`bk-drop${over ? ' is-over' : ''}`} tabIndex={0} role="button" aria-label="Upload a brand package ZIP. Press Enter to choose a file."
        onClick={() => !busy && input.current?.click()} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); input.current?.click(); } }}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) go(e.dataTransfer.files); }}
      >
        <h3>{busy ? 'Reading your package…' : 'Drop a brand package ZIP here'}</h3>
        <p>A brand design-system export, or a folder of logos and photos. We unpack it, file each asset, and fill in the guidelines, colors and fonts it contains. Only boxes that are still empty are filled.</p>
        <button type="button" className="bp-btn bp-btn--outline" disabled={busy} onClick={(e) => { e.stopPropagation(); input.current?.click(); }}><span>{busy ? 'Reading…' : 'Choose ZIP'}</span></button>
        <input ref={input} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(e) => go(e.target.files)} />
      </div>
      {note && <p className="bp-ok">{note}</p>}
    </section>
  );
}
