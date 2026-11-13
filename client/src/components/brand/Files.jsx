import React, { useEffect, useId, useRef, useState } from 'react';
import { BOX, COLOUR_ROLES, LIBS, LOGO_VERSIONS, badge, normHex } from './brandSpec.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';

const ASSET_OK = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/;
const MAX_BYTES = 25 * 1048576;
const GROUPS = ['Primary', 'Secondary'];
const versionLabel = (v) => (LOGO_VERSIONS.find(([k]) => k === v) || [])[1] || '';

/** Opens the file window straight away, checks each file, then hands back one draft per good file (each still needs a name). */
export function pickFiles(toast, onDrafts, defGroup) {
  let input = document.getElementById('bp-file-input');
  if (!input) {
    input = document.createElement('input');
    input.id = 'bp-file-input'; input.type = 'file'; input.multiple = true; input.hidden = true;
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    document.body.appendChild(input);
  }
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const bad = [];
    const ok = files.filter((f) => {
      if (!ASSET_OK.test(f.type)) { bad.push(`“${f.name}” isn't a file we can use. Choose PNG, SVG, JPG, WEBP or GIF.`); return false; }
      if (f.size > MAX_BYTES) { bad.push(`“${f.name}” is over 25 MB.`); return false; }
      return true;
    });
    if (bad.length) toast(bad[0] + (bad.length > 1 ? ` (+${bad.length - 1} more skipped)` : ''));
    const drafts = ok.map((file) => {
      const nm = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80);
      return { file, src: URL.createObjectURL(file), name: nm ? nm.charAt(0).toUpperCase() + nm.slice(1) : '', bg: 'Light background', group: defGroup || 'logoFiles', logoVariant: '', notes: '' };
    });
    if (drafts.length) onDrafts(drafts);
  };
  input.click();
}

const CloseX = ({ onClick }) => <button type="button" className="bp-x" aria-label="Close" onClick={onClick}>&times;</button>;

/**
 * Names each file before it is added: name, shown on light or dark, which list, and (logos) the version and when to use it.
 * box = the file list when it is one list; groups = [{id,label}] when it can go in several (the library).
 */
export function NamingPanel({ box, drafts: init, groups, onSave, onCancel, saveLabel, editId }) {
  const { taken } = useBrand();
  const uid0 = useId();
  const [ds, setDs] = useState(init);
  const [err, setErr] = useState('');
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); first.current?.select?.(); }, []);
  const storeOf = (d) => (groups ? BOX[d.group] : box);
  const upd = (i, patch) => { setDs((p) => p.map((d, j) => (j === i ? { ...d, ...patch } : d))); setErr(''); };

  function go() {
    const seen = new Set();
    let msg = '';
    const out = ds.map((d) => ({ ...d, name: d.name.replace(/\s+/g, ' ').trim() }));
    out.forEach((d) => {
      if (msg) return;
      const sid = storeOf(d).id;
      if (!d.name) { msg = 'Give every file a name.'; return; }
      const key = `${sid}|${d.name.toLowerCase()}`;
      if (seen.has(key) || taken(sid, d.name, editId)) msg = `“${d.name}” is already used. Choose a different name.`;
      seen.add(key);
    });
    if (msg) { setErr(msg); return; }
    onSave(out);
  }

  return (
    <div className="bp-name">
      <CloseX onClick={onCancel} />
      <ul className="bp-name__list">
        {ds.map((d, i) => {
          const st = storeOf(d);
          const id = `${uid0}-${i}`;
          return (
            <li key={i} className="bp-name__card">
              <div className={`bp-name__thumb${d.bg === 'Dark background' && !st.noBg ? ' is-dark' : ''}${st.noBg ? ' bp-name__thumb--photo' : ''}`}><img src={d.src} alt="" /></div>
              <div className="bp-name__fields">
                <div className="bp-form__row bp-name__grow">
                  <label className="bp-form__lab" htmlFor={`${id}-n`}>Name</label>
                  <input
                    id={`${id}-n`} ref={i === 0 ? first : null} className="bp-field bp-name__in" type="text" maxLength={80} autoComplete="off"
                    placeholder={st.cap || 'e.g. Primary logo'} value={d.name} onChange={(e) => upd(i, { name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
                  />
                </div>
                {!st.noBg && (
                  <div className="bp-form__row">
                    <label className="bp-form__lab" htmlFor={`${id}-b`}>Shown on</label>
                    <select id={`${id}-b`} className="bp-field" value={d.bg} onChange={(e) => upd(i, { bg: e.target.value })}>
                      <option>Light background</option><option>Dark background</option>
                    </select>
                  </div>
                )}
                {groups && (
                  <div className="bp-form__row">
                    <label className="bp-form__lab" htmlFor={`${id}-g`}>Add to</label>
                    <select id={`${id}-g`} className="bp-field" value={d.group} onChange={(e) => upd(i, { group: e.target.value })}>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  </div>
                )}
                {st.logo && (
                  <div className="bp-form__row">
                    <label className="bp-form__lab" htmlFor={`${id}-v`}>Version</label>
                    <select id={`${id}-v`} className="bp-field" value={d.logoVariant || ''} onChange={(e) => upd(i, { logoVariant: e.target.value })}>
                      {LOGO_VERSIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}
                {!st.styleGroup && (
                  <div className="bp-form__row bp-name__grow">
                    <label className="bp-form__lab" htmlFor={`${id}-w`}>When to use it</label>
                    <input id={`${id}-w`} className="bp-field" type="text" maxLength={300} autoComplete="off" placeholder="e.g. On dark backgrounds only" value={d.notes || ''} onChange={(e) => upd(i, { notes: e.target.value })} />
                  </div>
                )}
                {i === 0 && <button type="button" className="bp-btn bp-btn--primary bp-name__go" onClick={go}><span>{saveLabel || (ds.length > 1 ? `Add ${ds.length} files` : 'Add')}</span></button>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="bp-err" role="alert">{err}</p>
    </div>
  );
}

/** Name, hex code, type, what it is used for. */
export function ColourPanel({ draft, onSave, onCancel, saveLabel, editId }) {
  const { taken } = useBrand();
  const uid0 = useId();
  const [d, setD] = useState({ name: '', hex: '', group: 'Primary', role: '', note: '', ...draft });
  const [err, setErr] = useState('');
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); first.current?.select?.(); }, []);
  const set = (patch) => { setD((p) => ({ ...p, ...patch })); setErr(''); };
  const h = normHex(d.hex);

  function go() {
    const nm = d.name.replace(/\s+/g, ' ').trim();
    let msg = '';
    if (!nm) msg = 'Give the color a name.';
    else if (!h) msg = d.hex.trim() ? 'That isn\'t a valid hex code. Use 3 or 6 characters, like #E52726.' : 'Add a hex code or pick a color.';
    else if (taken('colourSwatches', nm, editId)) msg = `“${nm}” is already used. Choose a different name.`;
    if (msg) { setErr(msg); return; }
    onSave({ name: nm, hex: h, group: d.group, role: d.role || '', note: (d.note || '').trim() });
  }
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };

  return (
    <div className="bp-name">
      <CloseX onClick={onCancel} />
      <ul className="bp-name__list">
        <li>
          <div className="bp-name__card">
            <input className={`bp-cpick${h ? '' : ' is-empty'}`} type="color" aria-label="Pick a color" style={{ '--c': h || '#e5e7eb' }} value={h ? h.toLowerCase() : '#cccccc'} onChange={(e) => set({ hex: e.target.value.toUpperCase() })} />
            <div className="bp-name__fields">
              <div className="bp-form__row bp-name__grow">
                <label className="bp-form__lab" htmlFor={`${uid0}-n`}>Name</label>
                <input id={`${uid0}-n`} ref={first} className="bp-field bp-name__in" type="text" maxLength={40} autoComplete="off" placeholder="e.g. Smart Red" value={d.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={onKey} />
              </div>
              <div className="bp-form__row bp-name__hex">
                <label className="bp-form__lab" htmlFor={`${uid0}-h`}>Hex code</label>
                <input id={`${uid0}-h`} className="bp-field" type="text" maxLength={7} autoComplete="off" placeholder="#E52726" value={d.hex} onChange={(e) => set({ hex: e.target.value })} onKeyDown={onKey} />
              </div>
              <div className="bp-form__row">
                <label className="bp-form__lab" htmlFor={`${uid0}-g`}>Type</label>
                <select id={`${uid0}-g`} className="bp-field" value={d.group} onChange={(e) => set({ group: e.target.value })}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select>
              </div>
              <div className="bp-form__row">
                <label className="bp-form__lab" htmlFor={`${uid0}-r`}>Used for</label>
                <select id={`${uid0}-r`} className="bp-field" value={d.role || ''} onChange={(e) => set({ role: e.target.value })}>
                  {COLOUR_ROLES.map((r) => <option key={r} value={r}>{r || 'Let the AI decide'}</option>)}
                </select>
              </div>
              <div className="bp-form__row bp-name__grow">
                <label className="bp-form__lab" htmlFor={`${uid0}-x`}>Notes</label>
                <input id={`${uid0}-x`} className="bp-field" type="text" maxLength={120} autoComplete="off" placeholder="e.g. Pantone 485C" value={d.note || ''} onChange={(e) => set({ note: e.target.value })} onKeyDown={onKey} />
              </div>
              <button type="button" className="bp-btn bp-btn--primary bp-name__go" onClick={go}><span>{saveLabel || 'Add'}</span></button>
            </div>
          </div>
        </li>
      </ul>
      <p className="bp-err" role="alert">{err}</p>
    </div>
  );
}

/** An uploaded file as a list row. Edit opens the same naming box. */
export function FileRow({ store, it }) {
  const brand = useBrand();
  const { confirmDlg } = useBrandUi();
  const [editing, setEditing] = useState(false);
  const meta = [store.noBg ? '' : it.bg, store.logo ? versionLabel(it.logoVariant) : '', badge(it)].filter(Boolean).join(' · ');
  if (editing) {
    return (
      <li className="bp-file-row is-editing">
        <NamingPanel
          box={store} editId={it.id} saveLabel="Save" onCancel={() => setEditing(false)}
          drafts={[{ src: it.src, name: it.caption, bg: it.bg, logoVariant: it.logoVariant, notes: it.notes }]}
          onSave={(out) => { setEditing(false); brand.editFile(store.id, it, out[0]); }}
        />
      </li>
    );
  }
  return (
    <li className="bp-file-row" data-id={it.id}>
      <div className={`bp-file-row__thumb${it.bg === 'Dark background' && !store.noBg ? ' is-dark' : ''}${store.noBg ? ' bp-file-row__thumb--photo' : ''}`}><img src={it.src} alt="" /></div>
      <div className="bp-file-row__main">
        <p className="bp-item__name">{it.caption}</p>
        <p className="bp-item__meta bp-item__meta--l">{meta}</p>
        {it.notes ? <p className="bp-item__meta bp-item__meta--l">{it.notes}</p> : null}
      </div>
      <div className="bp-item__act">
        <button type="button" className="bp-act" aria-label={`Edit ${it.caption}`} onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="bp-act bp-act--del" aria-label={`Delete ${it.caption}`} onClick={() => confirmDlg('Delete this file?', `“${it.caption}” will be removed from your brand assets. Any instruction that mentions it keeps the name as plain text.`, 'Delete', () => brand.deleteFile(store.id, it))}>Delete</button>
      </div>
    </li>
  );
}

export function ColourRow({ it }) {
  const brand = useBrand();
  const { confirmDlg } = useBrandUi();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="bp-file-row is-editing">
        <ColourPanel draft={it} editId={it.id} saveLabel="Save" onCancel={() => setEditing(false)} onSave={(o) => { setEditing(false); brand.editSwatch(it, o); }} />
      </li>
    );
  }
  return (
    <li className="bp-file-row" data-id={it.id}>
      <div className="bp-file-row__thumb bp-swatch" style={{ background: it.hex }} />
      <div className="bp-file-row__main">
        <p className="bp-item__name">{it.name}</p>
        <p className="bp-item__meta bp-item__meta--l">{`${it.group || 'Primary'} · ${it.hex}${it.role ? ` · Used for ${it.role.toLowerCase()}` : ''}${it.note ? ` · ${it.note}` : ''}`}</p>
        <p className="bp-item__meta bp-item__meta--l">{badge(it)}</p>
      </div>
      <div className="bp-item__act">
        <button type="button" className="bp-act" aria-label={`Edit ${it.name}`} onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="bp-act bp-act--del" aria-label={`Delete ${it.name}`} onClick={() => confirmDlg('Delete this color?', `“${it.name}” will be removed from your brand assets. Any instruction that mentions it keeps the name as plain text.`, 'Delete', () => brand.deleteSwatch(it))}>Delete</button>
      </div>
    </li>
  );
}

/** The full-screen look at one library file, with previous / next. */
function Lightbox({ shown, index, onIndex, onClose, onDetails }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) { try { d.showModal(); } catch { /* already open */ } } }, []);
  const n = shown.length;
  if (!n) return null;
  const i = ((index % n) + n) % n;
  const x = shown[i];
  const dark = x.it.bg === 'Dark background' && !BOX[x.g].noBg;
  return (
    <dialog
      ref={ref} className="bk-prev" aria-label="Asset preview" onClose={onClose}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onIndex(i - 1); else if (e.key === 'ArrowRight') onIndex(i + 1); }}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
    >
      <button className="bk-prev__x" type="button" aria-label="Close preview" onClick={() => ref.current?.close()}>&times;</button>
      <button className="bk-prev__nav bk-prev__nav--l" type="button" aria-label="Previous asset" onClick={() => onIndex(i - 1)}>&#8249;</button>
      <div className="bk-prev__stage" style={dark ? { background: '#11161f' } : undefined}><img src={x.it.src} alt={x.it.caption} /></div>
      <button className="bk-prev__nav bk-prev__nav--r" type="button" aria-label="Next asset" onClick={() => onIndex(i + 1)}>&#8250;</button>
      <p className="bk-prev__cap">{`${x.it.caption} · ${x.label} · ${i + 1} of ${n}`}</p>
      {onDetails && x.it.asset && (
        <button type="button" className="bp-btn bp-btn--white bp-btn--sm" style={{ position: 'absolute', left: 20, top: 20 }} onClick={() => { ref.current?.close(); onDetails(x.it.asset); }}><span>More details</span></button>
      )}
    </dialog>
  );
}

/** Everything uploaded on a tab in one grid, filtered by group. Click a file to look at it, or remove it. */
export function Library({ lib, onDetails }) {
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState(null);
  const [prev, setPrev] = useState(-1);
  const groups = lib.groups.map((id) => ({ id, label: lib.labels[id] }));
  const all = groups.flatMap((g) => brand.items(g.id).map((it) => ({ it, g, label: g.label })));
  const shown = all.filter((x) => filter === 'all' || x.g.id === filter);
  const busy = lib.groups.reduce((n, id) => n + (brand.uploading[id] || 0), 0);

  return (
    <section className="bk-card bp-lib" id={lib.id} aria-label={lib.title}>
      <div className="bk-card__head">
        <div><p className="bk-eyebrow">{lib.title}</p></div>
        <div className="bk-card__actions">
          <button type="button" className="bp-btn bp-btn--outline bp-btn--sm" onClick={() => pickFiles(toast, setPending, lib.groups[0])}>{lib.addLabel}</button>
        </div>
      </div>
      {pending && (
        <div className="bp-lib__add">
          <NamingPanel
            groups={groups} drafts={pending} onCancel={() => setPending(null)}
            onSave={(out) => { setPending(null); brand.addFiles(lib.groups[0], out); }}
          />
        </div>
      )}
      <div className="bp-ftabs" role="group" aria-label="Asset groups">
        {[{ id: 'all', label: 'All' }, ...groups].map((g) => (
          <button key={g.id} type="button" className="bp-ftab" aria-pressed={filter === g.id ? 'true' : 'false'} onClick={() => setFilter(g.id)}>
            {`${g.label} · ${g.id === 'all' ? all.length : brand.items(g.id).length}`}
          </button>
        ))}
      </div>
      {busy > 0 && <p className="bp-empty">Uploading {busy} file{busy > 1 ? 's' : ''}…</p>}
      {!shown.length && all.length > 0 && <p className="bp-empty">Nothing in this group yet.</p>}
      {shown.length > 0 && (
        <ul className="bp-libgrid">
          {shown.map((x, i) => {
            const noBg = Boolean(BOX[x.g.id].noBg);
            return (
              <li key={x.it.id} className="bp-libitem">
                <button type="button" className={`bp-libitem__img${noBg ? ' bp-libitem__img--photo' : x.it.bg === 'Dark background' ? ' is-dark' : ''}`} aria-label={`Preview ${x.it.caption}`} onClick={() => setPrev(i)}><img src={x.it.src} alt="" loading="lazy" /></button>
                <p className="bp-libitem__name">{x.it.caption}</p>
                <p className="bp-libitem__grp">{x.g.label}</p>
                <button type="button" className="bp-act bp-act--del" aria-label={`Remove ${x.it.caption}`} onClick={() => confirmDlg('Delete this file?', `“${x.it.caption}” will be removed from your brand assets. Any instruction that mentions it keeps the name as plain text.`, 'Delete', () => brand.deleteFile(x.g.id, x.it))}>Remove</button>
              </li>
            );
          })}
        </ul>
      )}
      {prev >= 0 && shown.length > 0 && <Lightbox shown={shown} index={prev} onIndex={setPrev} onClose={() => setPrev(-1)} onDetails={onDetails} />}
    </section>
  );
}

export const libsForTab = (tabId) => LIBS.filter((l) => l.tab === tabId);
