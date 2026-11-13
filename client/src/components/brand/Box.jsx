import React, { useState } from 'react';
import AutomatrFonts from '../../constants/brandFonts.js';
import { fontBoxId, languageInfo } from '../../constants/brandLanguages.js';
import { BOX, SPEC, badge, primaryText } from './brandSpec.js';
import { useBrand } from './BrandData.jsx';
import { useBrandUi } from './BrandUi.jsx';
import ItemForm, { MentionText, fontScript, fontStyle } from './ItemForm.jsx';
import { ColourPanel, ColourRow, FileRow, NamingPanel, pickFiles } from './Files.jsx';
import StyleSummary from './StyleSummary.jsx';

const FONT_LIMIT = 4;

/** What one saved item looks like in its list. */
function ItemView({ box, it }) {
  const brand = useBrand();
  const k = box.kind;
  if (k === 'text') {
    return (
      <div className="bp-item__main">
        {it.tag ? <span className="bp-tag">{it.tag}</span> : null}
        {box.mention ? <MentionText text={it.text} items={brand.mentionItems(box)} /> : <p className="bp-item__text">{it.text}</p>}
      </div>
    );
  }
  if (k === 'fact') return <div className="bp-item__main"><p className="bp-item__label">{it.label}</p><p className="bp-item__text">{it.value}</p></div>;
  if (k === 'url') {
    return (
      <div className="bp-item__main">
        {it.name ? <p className="bp-item__name">{it.name}</p> : null}
        <p className="bp-item__text"><a href={it.url} target="_blank" rel="noopener noreferrer">{it.url.replace(/^https?:\/\//, '')}</a></p>
      </div>
    );
  }
  if (k === 'lang') {
    const inf = languageInfo(it.name);
    return (
      <div className="bp-item__main">
        <p className="bp-item__name">{it.name}{it.def ? <span className="bp-tag bp-tag--inline">Default</span> : null}</p>
        {inf ? <p className="bp-item__meta bp-item__meta--l">{`${inf.lang.native} · ${inf.script} script · ${inf.fonts} Google fonts${inf.rtl ? ' · Right to left' : ''}`}</p> : null}
        {it.note ? <p className="bp-item__text">{it.note}</p> : null}
      </div>
    );
  }
  if (k === 'named') return <div className="bp-item__main"><p className="bp-item__name">{it.name}</p>{it.note ? <p className="bp-item__text">{it.note}</p> : null}</div>;
  if (k === 'font') {
    const sp = SPEC[fontScript(box.lang)];
    const det = [];
    if (it.weight) det.push(`${AutomatrFonts.names[it.weight] || ''} ${it.weight}`.trim());
    if (it.ital) det.push('Italic');
    if (it.tcase && it.tcase !== 'As written') det.push(it.tcase);
    if (it.lh != null && it.lh !== 100) det.push(`Line height ${it.lh}%`);
    if (it.ls) det.push(`Letter spacing ${it.ls}%`);
    return (
      <div className="bp-item__main bp-font">
        <span className="bp-font__aa" style={fontStyle(it, true)}>{sp ? sp.slice(0, 2) : 'Aa'}</span>
        <div>
          <p className="bp-item__name">{it.family}{it.role ? <span className="bp-tag bp-tag--inline">{it.role}</span> : null}</p>
          {det.length ? <p className="bp-item__meta bp-item__meta--l">{det.join(' · ')}</p> : null}
          {it.note ? <p className="bp-item__text">{it.note}</p> : null}
        </div>
      </div>
    );
  }
  return null;
}

function ItemRow({ box, it, mentionItems }) {
  const brand = useBrand();
  const { toast, confirmDlg } = useBrandUi();
  const [editing, setEditing] = useState(false);
  const label = primaryText(box, it);

  if (editing) {
    return (
      <li className="bp-item is-editing" data-id={it.id}>
        <ItemForm
          box={box} item={it} existing={brand.items(box.id)} mentionItems={mentionItems}
          onCancel={() => setEditing(false)}
          onSave={(out) => { setEditing(false); brand.editItem(box, it, out); }}
        />
      </li>
    );
  }

  function ask() {
    if (box.id === 'languages' && it.name === 'English') { toast("English is always available, so it can't be deleted."); return; }
    if (box.id === 'languages' && it.def) { toast('Make another language the default before deleting this one.'); return; }
    const noun = box.kind === 'font' ? 'font' : box.kind === 'lang' ? 'language' : box.kind === 'url' ? 'website' : box.kind === 'fact' || box.kind === 'named' ? 'item' : 'instruction';
    const nf = box.id === 'languages' ? brand.items(fontBoxId(it.name)).length : 0;
    confirmDlg(
      `Delete this ${noun}?`,
      `“${label.slice(0, 90)}${label.length > 90 ? '…' : ''}” will be removed from ${box.title}.${nf ? ` Its ${nf} font${nf > 1 ? 's' : ''} in Languages & Fonts will be removed too.` : ''}`,
      'Delete', () => { brand.deleteItem(box, it); if (box.id !== 'languages') toast('Deleted'); }
    );
  }

  return (
    <li className="bp-item" data-id={it.id}>
      <ItemView box={box} it={it} />
      <div className="bp-item__side">
        <p className="bp-item__meta">{badge(it)}</p>
        <div className="bp-item__act">
          <button type="button" className="bp-act" aria-label={`Edit: ${label}`} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="bp-act bp-act--del" aria-label={`Delete: ${label}`} onClick={ask}>Delete</button>
        </div>
      </div>
    </li>
  );
}

/** The files (or colours) that sit inside a box, above its instructions. Hidden until there is one, or one is being added. */
function SubStore({ sub, pending, setPending }) {
  const brand = useBrand();
  const { toast } = useBrandUi();
  const its = brand.items(sub.id);
  const busy = brand.uploading[sub.id] || 0;
  if (!its.length && !pending && !busy) return null;
  const rows = sub.swatch ? its.slice().sort((a, b) => (a.group === 'Primary' ? 0 : 1) - (b.group === 'Primary' ? 0 : 1)) : its;
  return (
    <div className="bp-sub" id={`box-${sub.id}`}>
      {rows.length > 0 && (
        <ul className="bp-list bp-list--files">
          {rows.map((it) => (sub.swatch ? <ColourRow key={it.id} it={it} /> : <FileRow key={it.id} store={sub} it={it} />))}
        </ul>
      )}
      {busy > 0 && <p className="bp-empty">Uploading {busy} file{busy > 1 ? 's' : ''}…</p>}
      <div className="bp-box__foot">
        {pending && sub.swatch && (
          <ColourPanel draft={pending} onCancel={() => setPending(null)} onSave={(o) => { setPending(null); brand.addSwatch(o); toast(`Added ${o.name}`); }} />
        )}
        {pending && !sub.swatch && (
          <NamingPanel box={sub} drafts={pending} onCancel={() => setPending(null)} onSave={(out) => { setPending(null); brand.addFiles(sub.id, out); }} />
        )}
      </div>
    </div>
  );
}

/** One card of the Brand Assets screen: its title, its list, and the way to add to it. */
export default function Box({ box }) {
  const brand = useBrand();
  const { toast } = useBrandUi();
  const [composer, setComposer] = useState(false);
  const [pending, setPending] = useState(null);
  const sub = box.files ? BOX[box.files] : null;
  const all = brand.items(box.id);
  const rows = box.id === 'languages' ? all.slice().sort((a, b) => (b.def ? 1 : 0) - (a.def ? 1 : 0)) : all;
  const mention = brand.mentionItems(box);

  function openComposer() {
    if (box.kind === 'font' && all.length >= FONT_LIMIT) { toast(`A language can have up to ${FONT_LIMIT} fonts.`); return; }
    setComposer(true);
  }
  const addFile = () => {
    if (sub.swatch) { setPending({ name: '', hex: '', group: 'Primary', role: '', note: '' }); return; }
    pickFiles(toast, setPending, sub.id);
  };

  return (
    <section className="bk-card bp-box" id={`box-${box.id}`} aria-label={box.title}>
      <div className="bp-box__head">
        <div>
          <h3 className="bp-box__title">{box.title}</h3>
          <p className="bp-box__desc">{box.desc}</p>
          {box.note ? <p className="bp-box__desc bp-box__note">{box.note}</p> : null}
        </div>
        {!sub && <span className="bp-count">{all.length ? String(all.length) : ''}</span>}
      </div>
      {sub && <SubStore sub={sub} pending={pending} setPending={setPending} />}
      {rows.length > 0 && (
        <ul className={`bp-list bp-list--${box.kind}`}>
          {rows.map((it) => <ItemRow key={it.id} box={box} it={it} mentionItems={mention} />)}
        </ul>
      )}
      <div className="bp-box__foot">
        {composer && (
          <ItemForm
            box={box} isNew existing={all} mentionItems={mention} saveLabel="Add" cancelLabel="Cancel"
            onCancel={() => setComposer(false)}
            onSave={(out) => { setComposer(false); brand.addItem(box, out); }}
          />
        )}
        {!composer && !sub && <button type="button" className="bp-add" onClick={openComposer}>{`+ ${box.add || 'Add an instruction'}`}</button>}
        {sub && (
          <div className="bp-box__tools">
            {!box.noInstr && <button type="button" className="bp-add" onClick={openComposer}>+ Add an instruction</button>}
            <button type="button" className="bp-add" onClick={addFile}>{`+ ${sub.add}`}</button>
          </div>
        )}
      </div>
      {(box.id === 'refs' || box.id === 'illustration') && <StyleSummary kind={box.id === 'refs' ? 'photo' : 'illustration'} />}
    </section>
  );
}
