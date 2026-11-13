import React, { useEffect, useMemo, useRef, useState } from 'react';
import AutomatrFonts from '../../constants/brandFonts.js';
import { LANGUAGES, SCRIPTS, findLanguage, languageInfo } from '../../constants/brandLanguages.js';
import { brandAssetsApi } from '../../api/resources.js';
import { apiErrorMessage } from '../../api/client.js';
import { FONT_ROLES, CASES, SPEC, LSPEC, SAMPLE, normHex, normUrl, primaryText } from './brandSpec.js';

const fontWt = (role) => (/^(headline|primary)$/i.test(role || '') ? 700 : /sub/i.test(role || '') ? 500 : 400);
export const fontScript = (lang) => (findLanguage(lang)?.script || 'latin');
export const scriptLabel = (lang) => languageInfo(lang)?.script || 'Latin';
const sampleFor = (lang) => { const l = findLanguage(lang); return (l && LSPEC[l.code]) || SPEC[fontScript(lang)] || ''; };

/** CSS for text set in one of the brand's fonts (used by the font rows and the live preview). */
export function fontStyle(o, plain) {
  let w = o.weight || fontWt(o.role);
  const fam = String(o.family || '').replace(/["\\]/g, '');
  w = AutomatrFonts.load(fam, w, o.ital) || w;
  const gen = AutomatrFonts.generic(fam);
  const st = { fontFamily: fam ? `"${fam}", ${gen ? `${gen}, ` : ''}var(--font-body)` : 'var(--font-body)', fontWeight: w, fontStyle: o.ital ? 'italic' : 'normal' };
  if (plain) return st;
  const c = o.tcase;
  st.textTransform = c === 'Title case' ? 'capitalize' : c === 'All caps' ? 'uppercase' : c === 'Lowercase' ? 'lowercase' : 'none';
  st.lineHeight = String(((Number(o.lh) || 100) / 100) * 1.2);
  st.letterSpacing = `${(Number(o.ls) || 0) / 100}em`;
  return st;
}

function fieldsFor(b) {
  const k = b.kind;
  if (k === 'text') { const f = [{ k: 'text', l: b.fl || 'Instruction', t: 'area', req: 1, max: 400, ph: b.ph || 'Write it as a clear instruction' }]; if (b.tags) f.push({ k: 'tag', l: 'Type', t: 'select', opts: b.tags }); return f; }
  if (k === 'fact') return [{ k: 'label', l: 'Label', t: 'text', req: 1, max: 40, ph: 'e.g. Vision' }, { k: 'value', l: 'What it says', t: 'area', req: 1, max: 300, ph: 'Write it in a sentence' }];
  if (k === 'url') return [{ k: 'url', l: 'Website URL', t: 'url', req: 1, max: 200, ph: 'https://www.example.com' }, { k: 'name', l: 'What it is for', t: 'text', max: 80, ph: 'e.g. Main website' }];
  if (k === 'lang') return [{ k: 'name', l: 'Language', t: 'lsel', req: 1 }, { k: 'def', l: 'Default', t: 'defl' }, { k: 'note', l: 'More instructions', t: 'area', max: 300, ph: 'e.g. Use for regional campaigns.' }];
  if (k === 'named') return [{ k: 'name', l: 'Name', t: 'text', req: 1, max: 80, ph: b.ph || 'Name' }, { k: 'note', l: 'Details', t: 'area', max: 300, ph: b.nph || 'Details' }];
  if (k === 'font') return [{ k: 'family', l: 'Font name', t: 'gfont', req: 1, max: 60, ph: 'Start typing, e.g. Albert Sans' }, { k: 'role', l: 'Use for', t: 'select', opts: FONT_ROLES }, { k: 'weight', l: 'Weight', t: 'wsel' }, { k: 'ital', l: 'Style', t: 'ital' }, { k: 'tcase', l: 'Letter case', t: 'select', opts: CASES }, { k: 'lh', l: 'Line height', t: 'pct', def: 100, min: 50, max: 300 }, { k: 'ls', l: 'Letter spacing', t: 'pct', def: 0, min: -20, max: 100 }, { k: 'note', l: 'More instructions', t: 'area', max: 300, ph: 'e.g. Print, social and digital' }];
  return [];
}

/** A popup list under a text box (fonts, @mentions). */
function Pop({ opts, act, none, onPick }) {
  return (
    <ul className="bp-pop" role="listbox">
      {opts.length === 0 && none && <li className="bp-pop__none">{none}</li>}
      {opts.map((o, i) => (
        <li key={o.key} role="option" aria-selected={i === act} className={`bp-pop__opt${i === act ? ' is-act' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(o); }}>
          {o.node}
          {o.tag && <span className="bp-pop__tag">{o.tag}</span>}
        </li>
      ))}
    </ul>
  );
}

const MentionDot = ({ f }) => (f.swatch ? <span className="bp-dot" style={{ background: f.swatch }} /> : <img src={f.src} alt="" />);

/** Textarea where typing @ offers the box's logo / graphic / colour names. */
function MentionArea({ id, value, onChange, noun, items, ...rest }) {
  const ta = useRef(null);
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const tok = () => { const el = ta.current; const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, el ? el.selectionStart : value.length)); return m ? { q: m[2], start: (el ? el.selectionStart : value.length) - m[2].length - 1 } : null; };
  const t = open ? tok() : null;
  const opts = t ? items.filter((f) => f.caption.toLowerCase().includes(t.q.toLowerCase())).slice(0, 8) : [];
  const pick = (f) => {
    const tk = tok(); const el = ta.current; if (!tk || !el) return setOpen(false);
    const c = el.selectionStart; const next = `${value.slice(0, tk.start)}@${f.caption} ${value.slice(c)}`;
    onChange(next); setOpen(false);
    const pos = tk.start + f.caption.length + 2; requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };
  const none = !items.length ? (noun === 'color' ? 'No colors yet. Add a color first.' : noun === 'image' ? 'No images yet. Upload an image first.' : 'No files yet. Upload a file first.') : `No ${noun} called “${t?.q || ''}”.`;
  return (
    <>
      <textarea
        {...rest} id={id} ref={ta} className="bp-field" rows={3} value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setAct(0); }}
        onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open || !t) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!opts.length) return; e.preventDefault(); setAct((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length); }
          else if ((e.key === 'Enter' || e.key === 'Tab') && opts[act]) { e.preventDefault(); e.stopPropagation(); pick(opts[act]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      <p className="bp-form__hint">{noun === 'color' ? 'Type @ to mention a color.' : noun === 'image' ? 'Type @ to mention an image.' : 'Type @ to mention a file.'}</p>
      {open && t && <Pop opts={opts.map((f) => ({ key: f.caption, node: <><MentionDot f={f} /><span>{f.caption}</span></>, f }))} act={act} none={none} onPick={(o) => pick(o.f)} />}
    </>
  );
}

/** Font name box that suggests every Google font as you type. */
function FontInput({ id, value, onChange, script, placeholder }) {
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const opts = open ? AutomatrFonts.suggest(value.trim(), 8, script) : [];
  const pick = (n) => { onChange(n); AutomatrFonts.load(n, 700); setOpen(false); setAct(-1); };
  return (
    <>
      <input
        id={id} className="bp-field" type="text" autoComplete="off" maxLength={60} placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); if (AutomatrFonts.find(e.target.value)) AutomatrFonts.load(e.target.value, 700); setOpen(true); setAct(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!opts.length) return; e.preventDefault(); setAct((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length); }
          else if (e.key === 'Enter' && act >= 0 && opts[act]) { e.preventDefault(); e.stopPropagation(); pick(opts[act]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      />
      {open && <Pop opts={opts.map((n) => ({ key: n, node: n, tag: AutomatrFonts.isSafe(n) ? 'System font' : '' }))} act={act} none={`No ${script && script !== 'latin' ? 'listed font covering this script called ' : 'font called '}“${value.trim()}”. You can still use this name.`} onPick={(o) => pick(o.key)} />}
    </>
  );
}


/** For a font that is not on Google Fonts: upload the .ttf / .otf file and use its family name. */
function FontFileButton({ onFamily, onError }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setNote(''); onError('');
    try { const r = await brandAssetsApi.uploadFontFile(file); onFamily(r.family); setNote(`Uploaded ${r.family}.`); } catch (err) { onError(apiErrorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={ref} type="file" accept=".ttf,.otf" hidden onChange={pick} />
      <button type="button" className="bp-act" disabled={busy} onClick={() => ref.current && ref.current.click()}>{busy ? 'Uploading…' : 'Or upload a font file (.ttf, .otf)'}</button>
      {note ? <p className="bp-form__hint">{note}</p> : null}
    </>
  );
}

function FontPreview({ box, v }) {
  const o = { family: v.family.trim(), role: v.role, weight: parseInt(v.weight, 10) || 0, ital: v.ital, tcase: v.tcase, lh: parseFloat(v.lh), ls: parseFloat(v.ls) };
  if (Number.isNaN(o.lh)) o.lh = 100;
  if (Number.isNaN(o.ls)) o.ls = 0;
  const sub = /sub/i.test(o.role);
  const known = AutomatrFonts.find(o.family);
  const script = fontScript(box.lang);
  const spc = sampleFor(box.lang);
  const note = !o.family ? 'Type a font name to see how it looks.' : known && AutomatrFonts.supports(o.family, script) === false ? `${o.family} doesn't cover ${scriptLabel(box.lang)} text.` : AutomatrFonts.isSafe(o.family) ? 'A common system font. It shows when it is installed on the device.' : known ? '' : "This name isn't a Google font or a common system font, so the preview uses a fallback font.";
  const meta = [o.family || 'No font chosen', o.role, o.weight ? o.weight + (o.ital ? ' italic' : '') : '', o.tcase !== 'As written' ? o.tcase : '', `Line height ${o.lh}%`, `Letter spacing ${o.ls}%`].filter(Boolean).join(' · ');
  return (
    <aside className="bp-fprev" aria-label="Font preview">
      <p className="bp-fprev__lab">Preview</p>
      <p className="bp-fprev__text" dir={findLanguage(box.lang)?.rtl ? 'rtl' : 'ltr'} style={{ fontSize: sub ? 22 : 32, ...fontStyle(o) }}>{spc || (sub ? SAMPLE['Sub headline'] : SAMPLE.def)}</p>
      <p className="bp-fprev__meta">{meta}</p>
      <p className="bp-fprev__note">{note}</p>
    </aside>
  );
}

/**
 * One add / edit form, shaped by the box kind (text, fact, url, lang, font, named).
 * existing = the box's other items (for duplicate checks); mentionItems = names offered after typing @.
 */
export default function ItemForm({ box, item, existing = [], onSave, onCancel, saveLabel = 'Save', cancelLabel = 'Cancel', mentionItems = [], isNew = false }) {
  const fs = useMemo(() => fieldsFor(box), [box]);
  const used = useMemo(() => new Set(existing.filter((x) => x !== item && x.id !== item?.id).map((x) => String(x.name || '').toLowerCase())), [existing, item]);
  const init = () => {
    const v = {};
    fs.forEach((d) => {
      const cur = item ? item[d.k] : undefined;
      if (d.t === 'ital' || d.t === 'defl') v[d.k] = Boolean(cur);
      else if (d.t === 'pct') v[d.k] = cur != null ? cur : d.def;
      else if (d.t === 'wsel') v[d.k] = cur || fontWt(item?.role || 'Headline');
      else if (d.t === 'select' && d.k !== 'tag') v[d.k] = cur != null ? cur : d.opts[0];
      else v[d.k] = cur != null ? cur : '';
    });
    return v;
  };
  const [v, setV] = useState(init);
  const [err, setErr] = useState('');
  const [wTouched, setWTouched] = useState(Boolean(item?.weight));
  const formRef = useRef(null);
  const set = (k, val) => { setV((p) => ({ ...p, [k]: val })); setErr(''); };
  const isFont = box.kind === 'font';

  // keep the weight list and italic switch in step with the chosen font
  const weights = isFont ? AutomatrFonts.weights(v.family.trim()) : [];
  useEffect(() => {
    if (!isFont) return;
    const want = wTouched ? parseInt(v.weight, 10) || 400 : fontWt(v.role);
    const best = weights.reduce((b, x) => (Math.abs(x - want) < Math.abs(b - want) ? x : b), weights[0]);
    if (String(best) !== String(v.weight)) setV((p) => ({ ...p, weight: best }));
    if (!AutomatrFonts.hasItalic(v.family.trim()) && v.ital) setV((p) => ({ ...p, ital: false }));
  }, [v.family, v.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const canItalic = !isFont || AutomatrFonts.hasItalic(v.family.trim());

  function submit(e) {
    e.preventDefault();
    const out = {};
    let bad = '';
    for (const d of fs) {
      if (bad) break;
      if (d.t === 'ital' || d.t === 'defl') { out[d.k] = Boolean(v[d.k]); continue; }
      if (d.t === 'wsel') { out[d.k] = parseInt(v[d.k], 10) || 400; continue; }
      if (d.t === 'pct') { const nv = parseFloat(v[d.k]); if (Number.isNaN(nv) || nv < d.min || nv > d.max) { bad = `${d.l} must be between ${d.min}% and ${d.max}%.`; break; } out[d.k] = nv; continue; }
      let val = String(v[d.k] ?? '').replace(/\s+/g, ' ').trim();
      if (d.t === 'url' && val) { const u = normUrl(val); if (!u) { bad = "That doesn't look like a website address. Use something like https://www.example.com."; break; } val = u; }
      else if (d.req && !val) { bad = `Add the ${d.l.toLowerCase()} first.`; break; }
      else if (d.k === 'text' && val.length < 6 && !box.short) { bad = "That's very short. Say what should happen."; break; }
      if (!bad && d.t === 'gfont' && box.lang && AutomatrFonts.find(val) && !AutomatrFonts.supports(val, fontScript(box.lang))) { bad = `“${val}” doesn't cover ${scriptLabel(box.lang)} text. Pick a font from the list.`; break; }
      out[d.k] = val;
    }
    if (!bad) {
      const key = primaryText(box, out).toLowerCase();
      if (key && existing.some((x) => x !== item && x.id !== item?.id && primaryText(box, x).toLowerCase() === key && (box.kind !== 'font' || (x.role || '') === (out.role || '')))) bad = "That's already in this box.";
    }
    if (bad) { setErr(bad); return; }
    onSave(out);
  }

  const rows = fs.map((d, i) => {
    const id = `f-${box.id}-${d.k}-${item?.id || 'new'}`;
    let ctl;
    let hint = null;
    if (d.t === 'area') ctl = box.mention && d.k === 'text' ? <MentionArea id={id} value={v[d.k]} onChange={(x) => set(d.k, x)} noun={box.mentionNoun || 'file'} items={mentionItems} maxLength={d.max} placeholder={d.ph} autoFocus={isNew && i === 0} /> : <textarea id={id} className="bp-field" rows={3} maxLength={d.max} placeholder={d.ph} value={v[d.k]} onChange={(e) => set(d.k, e.target.value)} autoFocus={isNew && i === 0} />;
    else if (d.t === 'select') ctl = (
      <select id={id} className="bp-field" value={v[d.k]} onChange={(e) => set(d.k, e.target.value)}>
        {d.k === 'tag' && <option value="">None</option>}
        {d.opts.map((o) => <option key={o} value={o}>{o}</option>)}
        {item && d.k === 'role' && item[d.k] && !d.opts.includes(item[d.k]) && <option value={item[d.k]}>{item[d.k]}</option>}
      </select>
    );
    else if (d.t === 'wsel') ctl = <select id={id} className="bp-field" value={v[d.k]} onChange={(e) => { setWTouched(true); set(d.k, e.target.value); }}>{weights.map((w) => <option key={w} value={w}>{`${AutomatrFonts.names[w]} ${w}`}</option>)}</select>;
    else if (d.t === 'lsel') {
      const list = LANGUAGES.filter((l) => !used.has(l.name.toLowerCase()));
      ctl = (
        <select id={id} className="bp-field" value={v[d.k]} onChange={(e) => set(d.k, e.target.value)}>
          <option value="">Choose a language</option>
          {list.map((l) => <option key={l.code} value={l.name}>{l.name + (l.native !== l.name ? ` (${l.native})` : '')}</option>)}
          {item?.name && !findLanguage(item.name) && <option value={item.name}>{item.name}</option>}
        </select>
      );
    }
    else if (d.t === 'ital' || d.t === 'defl') {
      const isDef = d.t === 'defl';
      const disabled = isDef ? Boolean(item?.def) : !canItalic;
      ctl = <label className="bp-check"><input type="checkbox" checked={Boolean(v[d.k])} disabled={disabled} onChange={(e) => set(d.k, e.target.checked)} /><span>{isDef ? 'Make this the default language' : 'Italic'}</span></label>;
      hint = isDef ? (item?.def ? 'Make another language the default to change this.' : '') : (canItalic ? '' : 'This font has no italic style.');
    }
    else if (d.t === 'gfont') ctl = <><FontInput id={id} value={v[d.k]} onChange={(x) => set(d.k, x)} script={fontScript(box.lang)} placeholder={d.ph} /><FontFileButton onFamily={(x) => set(d.k, x)} onError={setErr} /></>;
    else if (d.t === 'pct') {
      ctl = (
        <div className="bp-pct">
          <input className="bp-pct__r" type="range" min={d.min} max={d.max} step={1} aria-label={d.l} value={v[d.k] === '' ? d.def : v[d.k]} onChange={(e) => set(d.k, e.target.value)} />
          <input id={id} className="bp-field bp-pct__n" type="number" min={d.min} max={d.max} step={1} value={v[d.k]} onChange={(e) => set(d.k, e.target.value)} />
          <span className="bp-pct__u">%</span>
        </div>
      );
      hint = d.k === 'lh' ? '100% is normal line height.' : '0% is normal letter spacing.';
    }
    else ctl = <input id={id} className="bp-field" type={d.t === 'url' ? 'url' : 'text'} autoComplete="off" maxLength={d.max} placeholder={d.ph} value={v[d.k]} onChange={(e) => set(d.k, e.target.value)} autoFocus={isNew && i === 0} />;
    const popWrap = d.t === 'gfont' || (d.t === 'area' && box.mention && d.k === 'text');
    return (
      <div key={d.k} className={`bp-form__row${popWrap ? ' bp-mentionwrap' : ''}`}>
        <label className="bp-form__lab" htmlFor={id}>{d.l}</label>
        {ctl}
        {hint ? <p className="bp-form__hint">{hint}</p> : null}
      </div>
    );
  });

  const buttons = (
    <div className="bp-form__btns">
      <button className="bp-btn bp-btn--outline bp-btn--sm" type="button" onClick={onCancel}>{cancelLabel}</button>
      <button className="bp-btn bp-btn--primary bp-btn--sm" type="submit"><span>{saveLabel}</span></button>
    </div>
  );
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA') { e.preventDefault(); formRef.current?.requestSubmit(); }
  };
  if (isFont) {
    return (
      <form ref={formRef} className="bp-form bp-fontform" noValidate onSubmit={submit} onKeyDown={onKey}>
        <div className="bp-form bp-fontform__fields">{rows}<p className="bp-err" role="alert">{err}</p>{buttons}</div>
        <FontPreview box={box} v={v} />
      </form>
    );
  }
  return (
    <form ref={formRef} className={`bp-form${isNew ? ' bp-form--new' : ''}`} noValidate onSubmit={submit} onKeyDown={onKey}>
      {rows}
      <p className="bp-err" role="alert">{err}</p>
      {buttons}
    </form>
  );
}

/** Text with @file / @color mentions turned into chips. */
export function MentionText({ text, items }) {
  const files = items.filter((f) => f.caption).sort((a, b) => b.caption.length - a.caption.length);
  if (!files.length || !text.includes('@')) return <p className="bp-item__text">{text}</p>;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@(${files.map((f) => esc(f.caption)).join('|')})(?![A-Za-z0-9])`, 'gi');
  const parts = [];
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const f = files.find((x) => x.caption.toLowerCase() === m[1].toLowerCase());
    parts.push(<span key={m.index} className="bp-mention"><MentionDot f={f} />{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="bp-item__text">{parts}</p>;
}

export { SCRIPTS };
