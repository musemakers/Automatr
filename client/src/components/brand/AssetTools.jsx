import React, { useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { Btn, ErrorText } from '../ui.jsx';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage as errMsg, resolveAssetUrl, downloadFile } from '../../api/client.js';
import { LOGO_VERSIONS } from './brandSpec.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';

// The older screen's file tools, kept inside the new tabs: details for any file (type, version, sub-brand, notes, read again),
// the files that are not logos / images / graphics, sub-brands with their own files, and the AI file search.

const KIND_OPTIONS = [
  ['logo', 'Logo'], ['product', 'Product photo or image'], ['texture', 'Graphic, texture or pattern'], ['template', 'Template or brand guideline'],
  ['reference', 'Brand reference (look and feel only)'], ['layout', 'Preferred layout (starting point)'], ['other', 'Other']
];
const KIND_LABEL = { logo: 'Logo', product: 'Image', texture: 'Graphic', template: 'Template', reference: 'Reference', layout: 'Layout', other: 'Other' };
const KIND_HELP = {
  logo: 'Upload as many versions as the brand has. Customers pick the right one when they create, and the logo rules say when to use which.',
  reference: 'Used only to understand the brand’s design language and style. Never placed in a design or copied, and hidden from the customer.',
  layout: 'The AI starts from this composition when it makes a new design. Hidden from the customer.',
  template: 'A brand guideline PDF is read for colors, fonts and tone of voice.'
};
const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,application/zip,application/x-zip-compressed,.zip';

const DETAILS_CSS = `
.ad-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 18px}
.ad-full{grid-column:1/-1}
.ad-label{display:block;margin:0 0 6px;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ad-field{display:block;width:100%;box-sizing:border-box;height:44px;padding:0 14px;font:inherit;font-size:14.5px;color:var(--ink);background:#fff;border:1px solid #DCDFE8;border-radius:10px;outline:none;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.ad-field:focus{border-color:#2E5EFF;box-shadow:0 0 0 3px rgba(46,94,255,.15)}
.ad-select{appearance:none;-webkit-appearance:none;padding-right:38px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7186' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center}
.ad-help{margin:16px 0 0;padding:11px 14px;font-size:12.5px;line-height:18px;color:var(--muted);background:#F6F8FC;border:1px solid #E9ECF4;border-radius:10px}
.ad-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}
@media(max-width:560px){.ad-grid{grid-template-columns:minmax(0,1fr)}}
`;

function AssetDetails({ asset, onSaved, setError, extraActions }) {
  const brand = useBrand();
  const { subBrands } = brand;
  const [label, setLabel] = useState(asset.label || '');
  const [notes, setNotes] = useState(asset.notes || '');
  const [kind, setKind] = useState(asset.kind || 'other');
  const [variant, setVariant] = useState(asset.logoVariant || '');
  const [group, setGroup] = useState(asset.styleGroup || 'photo');
  const [dark, setDark] = useState(Boolean(asset.onDark));
  const [bk, setBk] = useState(asset.subBrand ? String(asset.subBrand) : 'main');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const analyzable = asset.mimeType === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(asset.mimeType || '');
  const dirty = label !== (asset.label || '') || notes !== (asset.notes || '') || kind !== (asset.kind || 'other') || variant !== (asset.logoVariant || '')
    || bk !== (asset.subBrand ? String(asset.subBrand) : 'main') || dark !== Boolean(asset.onDark) || (kind === 'reference' && group !== (asset.styleGroup || 'photo'));

  async function save() {
    setBusy('save'); setMsg(''); setError('');
    try {
      const { asset: a } = await brandAssetsApi.updateAsset(asset._id, { label, notes, kind, logoVariant: kind === 'logo' ? variant : '', subBrandId: bk, onDark: dark, ...(kind === 'reference' ? { styleGroup: group } : {}) });
      onSaved(a);
      setMsg('Saved.');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(''); }
  }
  async function reread() {
    setBusy('read'); setMsg(''); setError('');
    try {
      const r = await brandAssetsApi.reanalyzeAsset(asset._id);
      if (r.user && brand.setUser) brand.setUser(r.user);
      if (r.subBrands) brand.setSubBrands(r.subBrands);
      brand.reloadProfile().catch(() => {});
      setMsg(r.analysis?.ranAI ? 'Read again. The design language is up to date.' : r.analysis?.note || 'Nothing to read from this file.');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(''); }
  }
  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
      <style>{DETAILS_CSS}</style>
      <div className="ad-grid">
        <div>
          <label className="ad-label" htmlFor="ad-label">Name</label>
          <input id="ad-label" className="ad-field" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={asset.originalName} />
        </div>
        <div>
          <label className="ad-label" htmlFor="ad-kind">Type</label>
          <select id="ad-kind" className="ad-field ad-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {kind === 'logo' && (
          <div>
            <label className="ad-label" htmlFor="ad-variant">Logo version</label>
            <select id="ad-variant" className="ad-field ad-select" value={variant} onChange={(e) => setVariant(e.target.value)}>
              {LOGO_VERSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
        {kind === 'reference' && (
          <div>
            <label className="ad-label" htmlFor="ad-group">Reference for</label>
            <select id="ad-group" className="ad-field ad-select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="photo">Photography styling</option><option value="illustration">Illustration styling</option>
            </select>
          </div>
        )}
        {(kind === 'logo' || kind === 'texture') && (
          <div>
            <label className="ad-label" htmlFor="ad-dark">Shown on</label>
            <select id="ad-dark" className="ad-field ad-select" value={dark ? 'dark' : 'light'} onChange={(e) => setDark(e.target.value === 'dark')}>
              <option value="light">Light background</option><option value="dark">Dark background</option>
            </select>
          </div>
        )}
        {subBrands.length > 0 && (
          <div>
            <label className="ad-label" htmlFor="ad-brand">Belongs to</label>
            <select id="ad-brand" className="ad-field ad-select" value={bk} onChange={(e) => setBk(e.target.value)}>
              <option value="main">Main brand</option>
              {subBrands.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="ad-full">
          <label className="ad-label" htmlFor="ad-notes">When to use it</label>
          <input id="ad-notes" className="ad-field" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. On dark backgrounds only" />
        </div>
      </div>
      {KIND_HELP[kind] && <p className="ad-help">{KIND_HELP[kind]}</p>}
      <div className="ad-actions">
        <Btn type="button" loading={busy === 'save'} disabled={!dirty} onClick={save}>Save details</Btn>
        {analyzable && kind !== 'layout' && <Btn variant="secondary" type="button" loading={busy === 'read'} disabled={dirty} onClick={reread}>Read again</Btn>}
        {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
        <span style={{ flex: 1 }} />
        {extraActions}
      </div>
    </div>
  );
}

/** Look at one file and change anything about it (type, logo version, which brand, notes), or have the AI read it again. */
export function AssetDetailsModal({ asset, onClose }) {
  const brand = useBrand();
  const [cur, setCur] = useState(asset);
  const [error, setError] = useState('');
  const [dl, setDl] = useState(false);
  const pdf = cur.mimeType === 'application/pdf';
  async function download() {
    setDl(true); setError('');
    try { await downloadFile(resolveAssetUrl(cur.url), cur.originalName); } catch { setError('Could not download this file. Try "Open in new tab" instead.'); } finally { setDl(false); }
  }
  return (
    <Modal title={cur.originalName} onClose={onClose} width={pdf ? 780 : 620}>
      <ErrorText>{error}</ErrorText>
      <div className="asset-preview">
        {pdf ? <iframe className="asset-preview__pdf" src={resolveAssetUrl(cur.url)} title={cur.originalName} /> : <img className="asset-preview__image" src={resolveAssetUrl(cur.url)} alt={cur.originalName} />}
      </div>
      <AssetDetails
        key={cur._id} asset={cur} setError={setError}
        onSaved={(a) => { setCur(a); brand.patchAsset(a); }}
        extraActions={(
          <>
            <a className="btn btn-secondary" href={resolveAssetUrl(cur.url)} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            <Btn variant="secondary" loading={dl} onClick={download}>Download</Btn>
          </>
        )}
      />
    </Modal>
  );
}

const Thumb = ({ a }) => (a.mimeType?.startsWith('image/') ? <img src={resolveAssetUrl(a.url)} alt="" loading="lazy" /> : <span className="bp-pdfpill">{a.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}</span>);

/** Files that are not logos, images or graphics (templates, other), plus a way to add any file and let the AI sort it. */
export function OtherFilesCard({ onOpen }) {
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const input = useRef(null);
  const docId = brand.profile.doc && String(brand.profile.doc.assetId || '');
  const rows = brand.assets.filter((a) => !a.subBrand && ['template', 'other'].includes(a.kind) && String(a._id) !== docId);

  async function upload(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusy(true); setNote('');
    try {
      const r = await brandAssetsApi.upload(files);
      if (r.brandKit && brand.setUser) brand.setUser((prev) => (prev ? { ...prev, brandKit: r.brandKit } : prev));
      if (r.subBrands) brand.setSubBrands(r.subBrands);
      setNote(r.analysis?.note || `Added ${r.assets?.length || 0} file${(r.assets?.length || 0) === 1 ? '' : 's'}. The AI named and filed each one.`);
      await Promise.all([brand.reloadAssets(), brand.reloadProfile()]);
    } catch (e) { toast(errMsg(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <section className="bk-card" id="other-files" aria-label="Other files">
      <div className="bk-card__head">
        <div><p className="bk-eyebrow">Other files</p></div>
        <div className="bk-card__actions">
          <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading your files…' : 'Add files and let the AI sort them'}</button>
        </div>
      </div>
      <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
      <p className="bp-box__desc">Templates, guideline PDFs and anything else. Drop any file and the AI works out what it is, names it, and files it in the right list above.</p>
      {note && <p className="bp-ok">{note}</p>}
      {rows.length === 0 ? <p className="bp-empty">No other files.</p> : (
        <ul className="bp-list bp-list--files">
          {rows.map((a) => (
            <li key={a._id} className="bp-file-row">
              <div className="bp-file-row__thumb"><Thumb a={a} /></div>
              <div className="bp-file-row__main">
                <p className="bp-item__name">{a.label || a.originalName}</p>
                <p className="bp-item__meta bp-item__meta--l">{KIND_LABEL[a.kind] || 'Other'}{a.notes ? ` · ${a.notes}` : ''}</p>
              </div>
              <div className="bp-item__act">
                <button type="button" className="bp-act" onClick={() => onOpen(a)}>Details</button>
                <button type="button" className="bp-act bp-act--del" onClick={() => confirmDlg('Delete this file?', `“${a.label || a.originalName}” will be removed from your brand assets.`, 'Delete', () => brand.deleteFile('other', { id: String(a._id) }))}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Product lines or divisions with their own look and their own files. */
export function SubBrandsSection({ onOpen }) {
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const { subBrands } = brand;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');
  const inputs = useRef({});

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the sub-brand a name.'); return; }
    try { const r = await brandAssetsApi.createSubBrand({ name }); brand.setSubBrands(r.subBrands); setAdding(false); setName(''); setErr(''); toast('Sub-brand added'); } catch (x) { setErr(errMsg(x)); }
  }
  async function rename(b, e) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the sub-brand a name.'); return; }
    try { const r = await brandAssetsApi.updateSubBrand(b._id, { name }); brand.setSubBrands(r.subBrands); setEditing(null); setName(''); setErr(''); toast('Changes saved'); } catch (x) { setErr(errMsg(x)); }
  }
  async function remove(b) {
    try { const r = await brandAssetsApi.deleteSubBrand(b._id, false); brand.setSubBrands(r.subBrands); await brand.reloadAssets(); toast('Sub-brand deleted'); } catch (x) { toast(errMsg(x)); }
  }
  async function upload(b, list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusyId(String(b._id));
    try {
      const r = await brandAssetsApi.upload(files, undefined, String(b._id));
      if (r.subBrands) brand.setSubBrands(r.subBrands);
      await brand.reloadAssets();
      toast(`Added ${r.assets?.length || files.length} file${(r.assets?.length || files.length) === 1 ? '' : 's'} to ${b.name}`);
    } catch (x) { toast(errMsg(x)); } finally { setBusyId(''); const i = inputs.current[b._id]; if (i) i.value = ''; }
  }

  const form = (onSubmit, onCancel, label) => (
    <form className="bp-form bp-form--new" noValidate onSubmit={onSubmit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      <div className="bp-form__row">
        <label className="bp-form__lab" htmlFor="sb-name">Sub-brand name</label>
        <input id="sb-name" className="bp-field" type="text" autoFocus autoComplete="off" maxLength={80} placeholder="Enter name" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} />
      </div>
      <p className="bp-err" role="alert">{err}</p>
      <div className="bp-form__btns">
        <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="bp-btn bp-btn--primary bp-btn--sm"><span>{label}</span></button>
      </div>
    </form>
  );

  return (
    <section className="bk-card bp-box" id="box-subbrands" aria-label="Sub-brands">
      <div className="bp-box__head">
        <div>
          <h3 className="bp-box__title">Sub-brands</h3>
          <p className="bp-box__desc">Product lines or divisions with their own look. Upload files to a sub-brand and a New Creative about it uses that guideline instead of the main brand’s. The brief is matched on the sub-brand name.</p>
        </div>
        <span className="bp-count">{subBrands.length ? String(subBrands.length) : ''}</span>
      </div>
      {subBrands.length > 0 && (
        <ul className="bp-list bp-list--named">
          {subBrands.map((b) => {
            const files = brand.assets.filter((a) => String(a.subBrand) === String(b._id));
            if (editing === b._id) return <li key={b._id} className="bp-item is-editing">{form((e) => rename(b, e), () => { setEditing(null); setName(''); setErr(''); }, 'Save')}</li>;
            return (
              <li key={b._id} className="bp-item" data-id={b._id}>
                <div className="bp-item__main">
                  <p className="bp-item__name">{b.name}</p>
                  {(b.brandKit?.colors || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>{b.brandKit.colors.map((c, i) => <span key={i} className="bp-dot" style={{ background: c, width: 18, height: 18, borderRadius: 4, border: '1px solid rgba(0,0,0,.14)' }} title={c} />)}</div>
                  )}
                  <p className="bp-item__text">{b.brandKit?.designLanguage?.summary || 'No guideline yet. Upload this sub-brand’s logo or brand guide. Until then the main brand’s look is used.'}</p>
                  {files.length > 0 && (
                    <ul className="bp-libgrid bp-sub-files">
                      {files.map((a) => (
                        <li key={a._id} className="bp-libitem">
                          <button type="button" className="bp-libitem__img bp-libitem__img--photo" aria-label={`Details for ${a.label || a.originalName}`} onClick={() => onOpen(a)}><Thumb a={a} /></button>
                          <p className="bp-libitem__name">{a.label || a.originalName}</p>
                          <p className="bp-libitem__grp">{KIND_LABEL[a.kind] || 'Other'}</p>
                          <button type="button" className="bp-act bp-act--del" onClick={() => confirmDlg('Delete this file?', `“${a.label || a.originalName}” will be removed from ${b.name}.`, 'Delete', () => brand.deleteFile('other', { id: String(a._id) }))}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="bp-item__side">
                  <p className="bp-item__meta">{`${files.length} file${files.length === 1 ? '' : 's'}`}</p>
                  <div className="bp-item__act">
                    <input ref={(el) => { inputs.current[b._id] = el; }} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => upload(b, e.target.files)} />
                    <button type="button" className="bp-act" disabled={busyId === String(b._id)} onClick={() => inputs.current[b._id]?.click()}>{busyId === String(b._id) ? 'Uploading…' : 'Upload files'}</button>
                    <button type="button" className="bp-act" onClick={() => { setEditing(b._id); setName(b.name); setErr(''); setAdding(false); }}>Edit</button>
                    <button type="button" className="bp-act bp-act--del" onClick={() => confirmDlg(`Delete “${b.name}”?`, 'Its uploaded files stay and move to the main brand.', 'Delete', () => remove(b))}>Delete</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="bp-box__foot">
        {adding ? form(create, () => { setAdding(false); setName(''); setErr(''); }, 'Add sub-brand') : <button type="button" className="bp-add" onClick={() => { setAdding(true); setEditing(null); setName(''); setErr(''); }}>+ Add a sub-brand</button>}
      </div>
    </section>
  );
}

/** Describe what you need in plain words; the AI picks the matching files. */
export function AiSearch({ customerName, onOpen }) {
  const brand = useBrand();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null); // { query, ids, explanation, usedAI }
  const [error, setError] = useState('');
  async function run(e) {
    e.preventDefault();
    const query = q.trim();
    if (!query) { setFound(null); return; }
    setBusy(true); setError('');
    try {
      const r = await brandAssetsApi.search(query);
      setFound({ query, ids: r.ids || [], explanation: r.explanation || '', usedAI: Boolean(r.usedAI) });
    } catch (x) { setError(errMsg(x)); } finally { setBusy(false); }
  }
  const clear = () => { setQ(''); setFound(null); setError(''); };
  const hits = found ? found.ids.map((id) => brand.assets.find((a) => String(a._id) === String(id))).filter(Boolean) : [];
  return (
    <>
      <div className="bp-search">
        <form onSubmit={run}>
          <input aria-label="Search brand files with AI" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder={`Search ${customerName || 'this brand'}’s files with AI, e.g. “white logo for dark banners”`} />
          {(q || found) && <button type="button" className="bp-act" onClick={clear} aria-label="Clear search" title="Clear search">✕</button>}
          <button type="submit" disabled={!q.trim() || busy}>{busy ? 'Searching…' : '✦ Search'}</button>
        </form>
      </div>
      {error && <p className="bp-err" role="alert">{error}</p>}
      {found && (
        <section className="bk-card" style={{ marginBottom: 16 }} aria-label="Search results">
          <div className="bk-card__head"><div><p className="bk-eyebrow">{found.usedAI ? 'AI search' : 'Search'}</p></div><div className="bk-card__actions"><button type="button" className="bk-link" onClick={clear}>Clear</button></div></div>
          <p className="bp-box__desc">{`“${found.query}” — ${hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'no matches'}.${found.explanation ? ` ${found.explanation}` : ''}`}</p>
          {hits.length === 0 ? <p className="bp-empty">Nothing matched. Try different words.</p> : (
            <ul className="bp-libgrid">
              {hits.map((a) => (
                <li key={a._id} className="bp-libitem">
                  <button type="button" className="bp-libitem__img bp-libitem__img--photo" aria-label={`Details for ${a.label || a.originalName}`} onClick={() => onOpen(a)}><Thumb a={a} /></button>
                  <p className="bp-libitem__name">{a.label || a.originalName}</p>
                  <p className="bp-libitem__grp">{KIND_LABEL[a.kind] || 'Other'}{a.kind === 'logo' && a.logoVariant ? ` · ${a.logoVariant}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

/** Danger zone at the bottom of Brand Assets: wipes every tab back to a brand-new customer. Needs the word RESET typed in. */
export function ResetCard({ customerName }) {
  const brand = useBrand();
  const { toast } = useBrandUi();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = word.trim().toUpperCase() === 'RESET';
  const close = () => { setOpen(false); setWord(''); setErr(''); };

  async function run() {
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await brand.resetAll();
      close();
      toast(`Brand assets reset${r.assetsDeleted ? `: ${r.assetsDeleted} file${r.assetsDeleted === 1 ? '' : 's'} removed` : ''}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <section className="bk-card bp-reset" aria-label="Reset all brand assets">
      <div className="bk-card__head bk-card__head--tight">
        <div>
          <p className="bk-eyebrow">Reset</p>
          <h3 className="bp-box__title">Reset everything in Brand Assets</h3>
          <p className="bp-box__desc">{`Start ${customerName ? `${customerName}'s` : 'this'} brand again from nothing. Designs and videos already made are not touched.`}</p>
        </div>
        {!open && <button type="button" className="bp-btn bp-btn--outline bp-btn--sm bp-btn--danger" onClick={() => setOpen(true)}>Reset everything</button>}
      </div>
      {open && (
        <div className="bp-reset__panel" role="group" aria-label="Confirm reset">
          <p className="bp-reset__list">This permanently removes: the guidelines PDF and everything read from it, every instruction and color, all uploaded files (logos, images, graphics, references, layouts, templates), both style summaries, the photography guide, learned rules, the design language, fonts, added languages and every sub-brand. It cannot be undone.</p>
          <label className="bp-form__lab" htmlFor="bp-reset-word">Type RESET to confirm</label>
          <input
            id="bp-reset-word" className="bp-field bp-reset__in" autoComplete="off" autoFocus value={word} disabled={busy}
            onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } if (e.key === 'Escape') close(); }}
          />
          {err && <p className="bp-err" role="alert">{err}</p>}
          <div className="bp-reset__row">
            <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="bp-btn bp-btn--danger-solid bp-btn--sm" onClick={run} disabled={!ok || busy}><span>{busy ? 'Resetting…' : 'Reset everything'}</span></button>
          </div>
        </div>
      )}
    </section>
  );
}
