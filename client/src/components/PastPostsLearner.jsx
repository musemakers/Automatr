import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { Btn } from './ui.jsx';
import { brandAssetsApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';

// Super admin: drop a hand-picked set of the brand's published assets; the AI reads them and proposes style rules.
// Nothing is stored here - accepted rules are handed back to the brand guide, which saves them with "Save brand guide".

const CSS = `
.pl-drop{border:1.5px dashed #C9CEDC;border-radius:14px;padding:22px;text-align:center;background:#FAFBFD;cursor:pointer;transition:border-color .15s,background .15s}
.pl-drop:hover,.pl-drop.on{border-color:#4F46E5;background:#F4F3FF}
.pl-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px;margin-top:14px}
.pl-th{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:#EEF0F6}
.pl-th img{width:100%;height:100%;object-fit:cover;display:block}
.pl-th button{position:absolute;top:4px;right:4px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(17,24,39,.72);color:#fff;font-size:12px;line-height:20px;cursor:pointer;padding:0}
.pl-rule{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}
.pl-rule textarea{flex:1;min-height:40px;resize:vertical;font:inherit;font-size:13.5px;line-height:19px;padding:8px 10px;border:1px solid #DCDFE8;border-radius:10px;box-sizing:border-box}
.pl-x{border:0;background:none;color:#8A90A2;font-size:18px;cursor:pointer;padding:6px 4px}
.pl-h{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B7186;margin:16px 0 8px}
`;

const MAX = 24;

export default function PastAssetsLearner({ onClose, onAdd }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { rules:[{scope,text}], analyzed, failed }
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0); // assets read so far; -1 while summarising
  const input = useRef(null);

  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  function addFiles(list) {
    const imgs = [...list].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    setFiles((cur) => [...cur, ...imgs].slice(0, MAX));
    if (imgs.length < list.length) setError('Only PNG, JPG and WebP images can be read. Others were skipped.');
    else setError('');
  }

  // A smaller copy is enough to read the style, and keeps every request small and quick.
  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }

  async function run() {
    setBusy(true); setError(''); setProgress(0);
    try {
      const notes = [];
      let failed = 0;
      let firstError = '';
      const BATCH = 4;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = await Promise.all(files.slice(i, i + BATCH).map(shrink));
        const r = await brandAssetsApi.readPastAssets(batch);
        notes.push(...(r.notes || []));
        failed += r.failed || 0;
        firstError = firstError || r.firstError || '';
        setProgress(Math.min(files.length, i + BATCH));
      }
      if (!notes.length) throw new Error(firstError ? `The AI could not read these images: ${firstError}` : 'The AI could not read any of these images.');
      setProgress(-1); // summarising
      const r = await brandAssetsApi.synthesizePastAssets(notes);
      if (!r.rules?.length) throw new Error('The AI could not find a consistent pattern. Try a more similar set of assets.');
      setResult({ rules: r.rules, analyzed: notes.length, failed });
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(false); setProgress(0); }
  }

  const setRule = (i, text) => setResult((r) => ({ ...r, rules: r.rules.map((x, j) => (j === i ? { ...x, text } : x)) }));
  const dropRule = (i) => setResult((r) => ({ ...r, rules: r.rules.filter((_, j) => j !== i) }));
  const kept = result ? result.rules.filter((r) => r.text.trim()) : [];

  const group = (scope, title) => {
    const rows = result.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.scope === scope);
    if (!rows.length) return null;
    return (
      <div>
        <div className="pl-h">{title}</div>
        {rows.map(({ r, i }) => (
          <div className="pl-rule" key={i}>
            <textarea value={r.text} maxLength={220} onChange={(e) => setRule(i, e.target.value)} />
            <button type="button" className="pl-x" aria-label="Remove rule" onClick={() => dropRule(i)}>×</button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal title="Learn from past assets" onClose={() => { if (!busy) onClose(); }} width={720}>
      <style>{CSS}</style>
      {!result ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Add the brand’s best published assets: one is enough, 8 to 24 gives the most reliable pattern. The AI reads each one, finds what they have in common and proposes style rules for you to review. The images are not stored.
          </p>
          <div
            className={`pl-drop${drag ? ' on' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          >
            <strong style={{ fontSize: 14 }}>Drop images here or click to choose</strong>
            <p className="hint" style={{ margin: '4px 0 0' }}>PNG, JPG or WebP · up to {MAX} images</p>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {files.length > 0 && (
            <div className="pl-thumbs">
              {files.map((f, i) => (
                <div className="pl-th" key={`${f.name}-${i}`}>
                  <img src={urls[i]} alt="" />
                  <button type="button" aria-label="Remove" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          {error && <p className="hint" style={{ color: '#C62828', marginTop: 10 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, alignItems: 'center' }}>
            {busy && <span className="hint" style={{ margin: 0, marginRight: 'auto' }}>{progress < 0 ? 'Working out the style…' : `Reading assets… ${progress} of ${files.length}`}</span>}
            <Btn variant="secondary" type="button" disabled={busy} onClick={onClose}>Cancel</Btn>
            <Btn type="button" loading={busy} disabled={files.length < 1} onClick={run}>{files.length < 1 ? 'Add an asset to start' : `Read ${files.length} asset${files.length === 1 ? '' : 's'}`}</Btn>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Read {result.analyzed} asset{result.analyzed === 1 ? '' : 's'}{result.failed ? ` (${result.failed} could not be read)` : ''}. Edit or remove anything that is not right, then add the rest to the brand guide.
          </p>
          {group('design', 'Visual style')}
          {group('copy', 'Writing style')}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Btn variant="secondary" type="button" onClick={() => setResult(null)}>Back</Btn>
            <Btn type="button" disabled={!kept.length} onClick={() => { onAdd(kept); onClose(); }}>Add {kept.length} rule{kept.length === 1 ? '' : 's'} to guide</Btn>
          </div>
        </>
      )}
    </Modal>
  );
}
