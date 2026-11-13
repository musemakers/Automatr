import React, { useEffect, useRef, useState } from 'react';
import iconSparkle from '../../assets/generate-home/sparkle.svg';
import { brandAssetsApi } from '../../api/resources.js';
import { resolveAssetUrl } from '../../api/client.js';
import { AiErrorNotice } from '../ui.jsx';
import MentionTextarea from './MentionTextarea.jsx';

// The Keep / Edit / Remove cards used by Subject Swap and Creative Edit (same pattern as the reference design):
// one card per thing found on the creative, three choices on the right, and a box that opens under Edit.

const ICONS = {
  keep: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  remove: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />,
  edit: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>),
  add: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  rewrite: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
};
export function Ico({ name }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}

const CHOICES = [['keep', 'Keep'], ['edit', 'Edit'], ['remove', 'Remove']];

/**
 * item: { id, label, action: 'keep'|'edit'|'remove', drawn? }
 * `children` is the Edit box (an <EditBox/>), shown only while action is 'edit'.
 */
export function ElementCard({ item, index, active, onActive, onAction, onDelete, detail, children, actions }) {
  // `actions` limits the choices (the "Describe the change" view only offers Keep and Remove)
  const choices = CHOICES.filter(([c]) => !actions || actions.includes(c));
  return (
    <div className={`el-card ${active ? 'is-active' : ''} ${item.action === 'remove' ? 'is-off' : ''}`.trim()} data-id={item.id} onFocus={onActive}>
      <div className="el-card__body">
        <div className="el-card__top">
          <span className="el-card__num">{String(index + 1).padStart(2, '0')}</span>
          <p className="el-card__role">{item.label}</p>
          <div className="el-pills" role="radiogroup" aria-label={`What to do with ${item.label}`}>
            {choices.map(([c, label], ci) => {
              const on = item.action === c || (c === 'keep' && actions && !actions.includes(item.action));
              const rm = c === 'remove';
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  aria-label={rm ? `Remove ${item.label}` : undefined}
                  title={rm ? (item.drawn ? 'Remove from the creative' : 'Remove') : undefined}
                  className={rm ? `el-rm ${on ? 'is-on' : ''}`.trim() : `el-pill ${on ? 'is-on' : ''}`.trim()}
                  onClick={() => onAction(c)}
                  onKeyDown={(e) => {
                    const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
                    if (!d) return;
                    e.preventDefault();
                    e.currentTarget.parentElement.children[(ci + d + choices.length) % choices.length].click();
                  }}
                >
                  <Ico name={c === 'edit' && item.rewrite ? 'rewrite' : c} />{!rm && <span>{label}</span>}
                </button>
              );
            })}
          </div>
          {item.drawn && <button type="button" className="el-x" aria-label={`Discard ${item.label}`} title="Discard this box" onClick={onDelete}>×</button>}
        </div>
        {detail ? <p className="el-card__detail">{detail}</p> : null}
        {item.action === 'edit' && children}
      </div>
    </div>
  );
}

/**
 * The box under Edit: what should it become (textarea), a Suggest link with AI ideas, and an optional reference
 * picture (from Brand Assets or uploaded). `ideas` = { list, loading, error }.
 */
export function EditBox({ value, onChange, placeholder, ariaLabel, onSuggest, ideas, onPickIdea, reference, onReference, onClearReference, allowReference = true }) {
  const fileRef = useRef(null);
  const [lib, setLib] = useState(false);
  return (
    <div className="el-edit">
      {allowReference ? (
        <MentionTextarea rows={2} value={value} maxLength={400} placeholder={placeholder} aria-label={ariaLabel} onChange={onChange} assets={reference ? [{ name: reference.name, src: reference.url }] : []} />
      ) : (
        <textarea className="fx-field" rows={2} value={value} maxLength={400} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
      )}
      {(allowReference || (value.trim().length >= 2 && onSuggest)) && (
        <div className="el-edit__row">
          {value.trim().length >= 2 && onSuggest && (
            <button type="button" className="sa-link" disabled={ideas?.loading} onClick={onSuggest}>
              <img src={iconSparkle} alt="" width="14" height="14" style={{ verticalAlign: '-2px', marginRight: 6 }} />{ideas?.loading ? 'Thinking…' : 'Improve'}
            </button>
          )}
          {allowReference && <p className="sa-note mention-hint">Type @ to tag a reference</p>}
        </div>
      )}
      <AiErrorNotice error={ideas?.error} />
      {ideas?.list?.length > 0 && (
        <div className="fx-ideas">{ideas.list.map((t) => <button key={t} type="button" className="fx-idea" onClick={() => onPickIdea(t)}>{t}</button>)}</div>
      )}
      {allowReference && (
        <div className="el-edit__ref">
          <p className="sa-note">Add a reference (optional)</p>
          {reference && (
            <div className="el-chip">
              <img src={reference.url} alt="" /><span>{reference.name}</span>
              <button type="button" className="el-x" aria-label="Remove reference" onClick={onClearReference}>×</button>
            </div>
          )}
          <div className="fx-row">
            <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-btn--soft" onClick={() => setLib(true)}><Ico name="add" /><span>From Brand Assets</span></button>
            <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-btn--soft" onClick={() => fileRef.current?.click()}><Ico name="upload" /><span>Upload</span></button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && /^image\//.test(f.type)) onReference(f); }} />
          </div>
          {lib && <BrandLibrary onClose={() => setLib(false)} onPick={(f) => { setLib(false); onReference(f); }} />}
        </div>
      )}
    </div>
  );
}

function BrandLibrary({ onClose, onPick }) {
  const ref = useRef(null);
  const [assets, setAssets] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); brandAssetsApi.list().then(({ assets: a }) => setAssets((a || []).filter((x) => x.mimeType?.startsWith('image/')))).catch(() => setAssets([])); }, []);
  async function pick(a) {
    setBusy(true);
    try {
      const blob = await fetch(resolveAssetUrl(a.url)).then((r) => r.blob());
      const type = /^image\/(png|jpe?g|webp)$/.test(blob.type) ? blob.type : 'image/png';
      onPick(new File([blob], a.originalName || a.name || 'brand-asset.png', { type }));
    } catch { setBusy(false); onClose(); }
  }
  return (
    <dialog ref={ref} className="lib" aria-labelledby="lib-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="lib__bar"><p id="lib-title">Choose a brand asset as reference</p><button type="button" className="sa-btn sa-btn--sm sa-btn--outline" onClick={onClose}><span>Cancel</span></button></div>
      {assets === null ? <p className="lib__empty">Loading…</p> : assets.length === 0 ? <p className="lib__empty">No brand assets yet. Upload an image instead.</p> : (
        <div className="lib__grid">
          {assets.map((a) => (
            <button key={a._id || a.url} type="button" className="lib__asset" disabled={busy} aria-label={a.originalName || a.name || 'Asset'} onClick={() => pick(a)}>
              <span style={{ backgroundImage: `url(${resolveAssetUrl(a.url)})` }} /><em>{a.originalName || a.name || 'Asset'}</em>
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
