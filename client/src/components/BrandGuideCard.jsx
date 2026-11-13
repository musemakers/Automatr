import React, { useEffect, useRef, useState } from 'react';
import { Card, CardHead, Btn } from './ui.jsx';
import PastAssetsLearner from './PastPostsLearner.jsx';
import { brandAssetsApi } from '../api/resources.js';
import { apiErrorMessage } from '../api/client.js';

// Super-admin only. The customer-specific instructions and rules the AI follows for every caption and image in this
// workspace, plus a plain-language review of what it has understood about the brand and exactly what it is told.

const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14, lineHeight: '20px', border: '1px solid #DCDFE8', borderRadius: 10, background: '#fff', fontFamily: 'inherit' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, margin: '16px 0 6px' };

const toLines = (arr) => (Array.isArray(arr) ? arr.join('\n') : '');
const fromLines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const toWords = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
const fromWords = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function Area({ id, label, hint, value, onChange, max, rows = 3, placeholder, full = false }) {
  return (
    <div className={full ? 'full' : undefined}>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <textarea id={id} style={{ ...inputStyle, minHeight: rows * 22 + 18, resize: 'vertical' }} maxLength={max || undefined} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <p className="hint" style={{ marginTop: 4 }}>{hint ? `${hint} ` : ''}{max ? `${value.length} / ${max}` : ''}</p>
    </div>
  );
}

const LAYOUT_CSS = `
.bg-wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
.bg-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}
.bg-fields .full{grid-column:1/-1}
.bg-side{position:sticky;top:12px;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:#FAFBFD}
.bg-bar{position:sticky;top:0;z-index:3;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 0;margin-bottom:4px;background:#fff;border-bottom:1px solid var(--line)}
@media(max-width:1180px){.bg-wrap{grid-template-columns:minmax(0,1fr)}.bg-side{position:static}}
@media(max-width:720px){.bg-fields{grid-template-columns:minmax(0,1fr)}}
`;

const PHOTO_FIELDS = ['look', 'people', 'product', 'avoid', 'modelSuffix', 'productSuffix'];
const PHOTO_MAX = { look: 800, people: 7000, product: 7000, avoid: 1200, modelSuffix: 800, productSuffix: 800 };
const MAX_MD_BYTES = 200 * 1024;

function photoFrom(p = {}) {
  const o = { fileName: p.fileName || '', uploadedAt: p.uploadedAt || null, hasSource: Boolean(p.hasSource), newSource: null };
  for (const k of PHOTO_FIELDS) o[k] = p[k] || '';
  return o;
}

function formFrom(guide = {}) {
  return {
    photo: photoFrom(guide.photography),
    instructions: guide.instructions || '',
    copyInstructions: guide.copyInstructions || '',
    designInstructions: guide.designInstructions || '',
    audience: guide.audience || '',
    positioning: guide.positioning || '',
    logoRules: guide.logoRules || '',
    mandatoryText: guide.mandatoryText || '',
    doList: toLines(guide.doList),
    dontList: toLines(guide.dontList),
    taglines: toLines(guide.taglines),
    preferredWords: toWords(guide.preferredWords),
    avoidWords: toWords(guide.avoidWords),
    learned: Array.isArray(guide.learned) ? guide.learned.map((r) => ({ scope: r.scope, text: r.text })) : []
  };
}

export default function BrandGuideCard({ customerName, onUnderstandingChanged }) {
  const [data, setData] = useState(null); // { guide, preview, counts }
  const [form, setForm] = useState(formFrom());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [photoNote, setPhotoNote] = useState('');
  const [photoOmitted, setPhotoOmitted] = useState([]); // lines of the uploaded file that were not put in any field
  const mdInput = useRef(null);

  function apply(payload) {
    setData(payload);
    setForm(formFrom(payload.guide));
    setDirty(false);
  }

  useEffect(() => {
    let alive = true;
    setData(null);
    brandAssetsApi.getGuide().then((p) => { if (alive) apply(p); }).catch((e) => { if (alive) setError(apiErrorMessage(e)); });
    return () => { alive = false; };
  }, [customerName]);

  // Refresh the "what the AI understood" half when the design language above/below was edited.
  useEffect(() => {
    if (onUnderstandingChanged === undefined || !data) return;
    brandAssetsApi.getGuide().then((p) => setData((d) => (d ? { ...d, preview: p.preview, counts: p.counts } : p))).catch(() => {});
  }, [onUnderstandingChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  const addLearned = (rules) => { setForm((f) => ({ ...f, learned: [...f.learned, ...rules] })); setDirty(true); setSaved(false); };
  const editLearned = (i, text) => { setForm((f) => ({ ...f, learned: f.learned.map((r, j) => (j === i ? { ...r, text } : r)) })); setDirty(true); setSaved(false); };
  const removeLearned = (i) => { setForm((f) => ({ ...f, learned: f.learned.filter((_, j) => j !== i) })); setDirty(true); setSaved(false); };

  const setPhoto = (k) => (v) => { setForm((f) => ({ ...f, photo: { ...f.photo, [k]: v } })); setDirty(true); setSaved(false); };

  // Reads a photography guide (.md) in the browser, then the AI condenses it into photography-only fields for review.
  // Nothing is stored until "Save brand guide".
  async function readPhotoFile(file, reuse = false) {
    setBusy('photo'); setError(''); setPhotoNote(''); setPhotoOmitted([]);
    try {
      let text = '';
      if (!reuse) {
        if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Choose a .md (Markdown) file.');
        if (file.size > MAX_MD_BYTES) throw new Error('That file is over 200 KB. A photography guide should be much shorter.');
        text = await file.text();
      }
      const r = await brandAssetsApi.readPhotographyGuide(reuse ? '' : file.name, text, reuse);
      setForm((f) => ({
        ...f,
        photo: { ...f.photo, ...Object.fromEntries(PHOTO_FIELDS.map((k) => [k, r.brief?.[k] || ''])), fileName: r.fileName || f.photo.fileName, newSource: reuse ? null : text, hasSource: reuse ? f.photo.hasSource : true }
      }));
      setDirty(true); setSaved(false);
      setPhotoOmitted(r.omitted || []);
      setPhotoNote(`Read. The text below is your file's own wording, sorted into the boxes (nothing was rewritten).${r.omitted?.length ? ` ${r.omitted.length} line${r.omitted.length === 1 ? ' was' : 's were'} left out because they are not about how photographs look.` : ''}${r.trimmed ? ' A long box was cut at a sentence end to fit its limit.' : ''} Review, then save.`);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); if (mdInput.current) mdInput.current.value = ''; }
  }

  function removePhoto() {
    if (!window.confirm('Remove the photography guide? The AI will go back to following only the rest of the brand guide for photos.')) return;
    setForm((f) => ({ ...f, photo: { ...photoFrom({}), newSource: '' } }));
    setDirty(true); setSaved(false); setPhotoNote(''); setPhotoOmitted([]);
  }

  function payloadFromForm() {
    const ph = form.photo || photoFrom({});
    const photography = Object.fromEntries(PHOTO_FIELDS.map((k) => [k, ph[k] || '']));
    photography.fileName = ph.fileName || '';
    if (ph.newSource !== null && ph.newSource !== undefined) photography.source = ph.newSource;
    return {
      photography,
      instructions: form.instructions,
      copyInstructions: form.copyInstructions,
      designInstructions: form.designInstructions,
      audience: form.audience,
      positioning: form.positioning,
      logoRules: form.logoRules,
      mandatoryText: form.mandatoryText,
      doList: fromLines(form.doList),
      dontList: fromLines(form.dontList),
      taglines: fromLines(form.taglines),
      preferredWords: fromWords(form.preferredWords),
      avoidWords: fromWords(form.avoidWords),
      learned: form.learned.filter((r) => r.text.trim())
    };
  }

  async function save(extra = {}) {
    setBusy('save'); setError(''); setSaved(false);
    try {
      apply(await brandAssetsApi.updateGuide({ ...payloadFromForm(), ...extra }));
      setSaved(true);
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); }
  }

  // Throw away what has been typed since the last save.
  function discardChanges() {
    setForm(formFrom(data.guide));
    setDirty(false);
    setSaved(false);
    setError('');
  }

  // Empty every field of this customer's brand guide (the files and design language are not touched).
  async function resetGuide() {
    if (!window.confirm(`Reset the brand guide for ${customerName || 'this customer'}? Every instruction, rule, word list, tagline, logo rule and the photography guide is cleared. Uploaded files and the design language stay.`)) return;
    setBusy('reset'); setError(''); setSaved(false);
    try {
      apply(await brandAssetsApi.updateGuide({
        instructions: '', copyInstructions: '', designInstructions: '', audience: '', positioning: '', logoRules: '', mandatoryText: '',
        doList: [], dontList: [], taglines: [], preferredWords: [], avoidWords: [], learned: [],
        photography: { look: '', people: '', product: '', avoid: '', modelSuffix: '', productSuffix: '', fileName: '', source: '' }
      }));
    } catch (e) { setError(apiErrorMessage(e)); } finally { setBusy(''); }
  }

  if (!data) {
    return (
      <Card>
        <CardHead title="Brand guide" tag="Super admin" />
        {error ? <p className="hint" style={{ color: '#C62828' }}>{error}</p> : <p className="hint">Loading…</p>}
      </Card>
    );
  }

  const { preview, counts } = data;
  const photoOn = PHOTO_FIELDS.some((k) => (form.photo?.[k] || '').trim());

  return (
    <Card>
      <style>{LAYOUT_CSS}</style>
      <div className="bg-wrap">
        <div>
          <div className="bg-bar">
            <strong style={{ fontSize: 15, marginRight: 'auto' }}>Brand guide{customerName ? ` · ${customerName}` : ''}</strong>
            {dirty && <span className="hint" style={{ margin: 0 }}>Unsaved changes</span>}
            {saved && !dirty && <span className="hint" style={{ margin: 0 }}>Saved</span>}
            <Btn variant="secondary" type="button" disabled={!dirty || Boolean(busy)} onClick={discardChanges}>Discard changes</Btn>
            <Btn variant="secondary" type="button" loading={busy === 'reset'} disabled={Boolean(busy) && busy !== 'reset'} style={{ color: '#C62828' }} onClick={resetGuide}>Reset guide</Btn>
            <Btn type="button" loading={busy === 'save'} disabled={!dirty || Boolean(busy)} onClick={() => save()}>Save brand guide</Btn>
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            The AI follows these for every caption, headline and image it makes in this workspace, on top of the files you upload. Customers never see this.
          </p>
          {error && <p className="hint" style={{ color: '#C62828', marginTop: 8 }}>{error}</p>}

          <div className="bg-fields">
            <Area full id="bg-instr" label="Instructions for everything" max={3000} rows={4} value={form.instructions} onChange={set('instructions')}
              placeholder="e.g. Always show prices in rupees. Keep the product front and centre. Never show competitors. Speak to first-time buyers."
              hint="Applied to every caption and every image." />
            <Area id="bg-copy" label="Writing instructions" max={2000} rows={4} value={form.copyInstructions} onChange={set('copyInstructions')}
              placeholder="e.g. Short sentences. One idea per post. Emojis only on Instagram." hint="Captions and headlines only." />
            <Area id="bg-design" label="Design instructions" max={2000} rows={4} value={form.designInstructions} onChange={set('designInstructions')}
              placeholder="e.g. Generous white space. Warm natural light. Real Indian homes, never studio-white." hint="Images only." />

            <div>
              <label style={labelStyle} htmlFor="bg-pos">What the brand stands for</label>
              <input id="bg-pos" style={inputStyle} maxLength={500} value={form.positioning} onChange={(e) => set('positioning')(e.target.value)} placeholder="e.g. Honest everyday nutrition for busy families" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="bg-aud">Who it speaks to</label>
              <input id="bg-aud" style={inputStyle} maxLength={500} value={form.audience} onChange={(e) => set('audience')(e.target.value)} placeholder="e.g. Working parents, 28 to 40, metro cities" />
            </div>

            <Area id="bg-do" label="Always do" max={0} rows={4} value={form.doList} onChange={set('doList')} placeholder={'One per line\nMention free delivery\nUse the rupee sign'} hint="One rule per line, up to 15." />
            <Area id="bg-dont" label="Never do" max={0} rows={4} value={form.dontList} onChange={set('dontList')} placeholder={'One per line\nNo exclamation marks\nNo stock-photo smiles'} hint="One rule per line, up to 15." />

            <div>
              <label style={labelStyle} htmlFor="bg-pref">Preferred words</label>
              <textarea id="bg-pref" style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.preferredWords} onChange={(e) => set('preferredWords')(e.target.value)} placeholder="fresh, handmade, everyday" />
              <p className="hint" style={{ marginTop: 4 }}>Separate with commas.</p>
            </div>
            <div>
              <label style={labelStyle} htmlFor="bg-avoid">Words to avoid</label>
              <textarea id="bg-avoid" style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} value={form.avoidWords} onChange={(e) => set('avoidWords')(e.target.value)} placeholder="cheap, discount, best-ever" />
              <p className="hint" style={{ marginTop: 4 }}>Separate with commas.</p>
            </div>

            <Area id="bg-tag" label="Approved taglines" max={0} rows={3} value={form.taglines} onChange={set('taglines')} placeholder={'One per line\nMade for everyday'} hint="Used only when one fits, and never reworded." />
            <div>
              <label style={labelStyle} htmlFor="bg-logo">Logo rules</label>
              <textarea id="bg-logo" style={{ ...inputStyle, minHeight: 84, resize: 'vertical' }} maxLength={600} value={form.logoRules} onChange={(e) => set('logoRules')(e.target.value)} placeholder="e.g. White logo on dark backgrounds, colour logo on light ones. Keep clear space equal to the height of the logo's letter 'A'." />
              <p className="hint" style={{ marginTop: 4 }}>Upload each version from the Assets tab, then say here when to use which. {counts.logos} logo{counts.logos === 1 ? '' : 's'} uploaded.</p>
            </div>

            <div className="full" style={{ marginTop: 18, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 6px' }}>
                <div style={{ marginRight: 'auto' }}>
                  <strong style={{ fontSize: 14 }}>Photography guide</strong>
                  <p className="hint" style={{ margin: '2px 0 0' }}>Upload a Markdown (.md) file on how photographs should look: people, skin, styling, products, ingredients, light. Your wording is kept as written, only sorted into the boxes below. Used for photographs only, never for fonts, text or layout.</p>
                </div>
                <input ref={mdInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) readPhotoFile(f); }} />
                <Btn variant="secondary" type="button" loading={busy === 'photo'} disabled={Boolean(busy) && busy !== 'photo'} onClick={() => mdInput.current?.click()}>{photoOn ? 'Replace .md file' : 'Upload .md file'}</Btn>
              </div>
              {!photoOn && <p className="hint" style={{ margin: '6px 0 0' }}>No photography guide yet.</p>}
              {photoNote && <p className="hint" style={{ margin: '6px 0 0', color: '#1B6E3C' }}>{photoNote}</p>}
              {photoOmitted.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>See what was left out ({photoOmitted.length})</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: '18px' }}>
                    {photoOmitted.map((o, i) => <li key={i}>{o.text} <span className="hint" style={{ margin: 0 }}>({o.why})</span></li>)}
                  </ul>
                  <p className="hint" style={{ marginTop: 6 }}>To keep any of these, type it into the matching box below.</p>
                </details>
              )}
              {photoOn && (
                <div>
                  <p className="hint" style={{ margin: '6px 0 0' }}>
                    {form.photo.fileName ? `From ${form.photo.fileName}` : 'Photography guide'}{form.photo.uploadedAt ? ` · uploaded ${new Date(form.photo.uploadedAt).toLocaleDateString()}` : ''}. Edit anything you like. This is what image requests receive.
                  </p>
                  <Area full id="ph-look" label="Overall look" max={PHOTO_MAX.look} rows={2} value={form.photo.look} onChange={setPhoto('look')} />
                  <Area full id="ph-people" label="Photographs with people" max={PHOTO_MAX.people} rows={5} value={form.photo.people} onChange={setPhoto('people')} hint="Casting, skin, hair, styling, expression, lens, light. The People options chosen in a brief always win over this." />
                  <Area full id="ph-product" label="Photographs of products and ingredients" max={PHOTO_MAX.product} rows={5} value={form.photo.product} onChange={setPhoto('product')} hint="The pack's own label, packaging and colours are never changed." />
                  <Area full id="ph-avoid" label="Photography to avoid" max={PHOTO_MAX.avoid} rows={2} value={form.photo.avoid} onChange={setPhoto('avoid')} />
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Finishing lines (advanced)</summary>
                    <Area full id="ph-msuf" label="Finish for people photographs" max={PHOTO_MAX.modelSuffix} rows={2} value={form.photo.modelSuffix} onChange={setPhoto('modelSuffix')} />
                    <Area full id="ph-psuf" label="Finish for product photographs" max={PHOTO_MAX.productSuffix} rows={2} value={form.photo.productSuffix} onChange={setPhoto('productSuffix')} />
                  </details>
                  <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                    {form.photo.hasSource && form.photo.newSource === null && <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={() => readPhotoFile(null, true)}>Read the file again</button>}
                    <button type="button" className="link-btn" style={{ color: '#C62828' }} disabled={Boolean(busy)} onClick={removePhoto}>Remove photography guide</button>
                  </div>
                </div>
              )}
            </div>

            <div className="full" style={{ marginTop: 18, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 6px' }}>
                <div style={{ marginRight: 'auto' }}>
                  <strong style={{ fontSize: 14 }}>Learned from past assets</strong>
                  <p className="hint" style={{ margin: '2px 0 0' }}>Upload the brand’s best published assets (even just one) and the AI works out its visual style. Review the rules, then save.</p>
                </div>
                <Btn variant="secondary" type="button" onClick={() => setLearnOpen(true)}>{form.learned.length ? 'Learn from more assets' : 'Learn from past assets'}</Btn>
              </div>
              {form.learned.length === 0 && <p className="hint" style={{ margin: '6px 0 0' }}>Nothing learned yet.</p>}
              {['design', 'copy'].map((scope) => {
                const rows = form.learned.map((r, i) => ({ r, i })).filter(({ r }) => r.scope === scope);
                if (!rows.length) return null;
                return (
                  <div key={scope}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6B7186', margin: '12px 0 6px' }}>{scope === 'design' ? 'Visual style' : 'Writing style'}</div>
                    {rows.map(({ r, i }) => (
                      <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
                        <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} maxLength={220} value={r.text} onChange={(e) => editLearned(i, e.target.value)} />
                        <button type="button" aria-label="Remove rule" onClick={() => removeLearned(i)} style={{ border: 0, background: 'none', color: '#8A90A2', fontSize: 18, cursor: 'pointer', padding: '6px 4px' }}>×</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="full">
              <label style={labelStyle} htmlFor="bg-legal">Mandatory line (disclaimer or legal text)</label>
              <input id="bg-legal" style={inputStyle} maxLength={400} value={form.mandatoryText} onChange={(e) => set('mandatoryText')(e.target.value)} placeholder="e.g. T&C apply. Offer valid till stocks last." />
              <p className="hint" style={{ marginTop: 4 }}>Added to captions where it fits, word for word.</p>
            </div>
          </div>
        </div>

        <aside className="bg-side">
          <strong style={{ fontSize: 14 }}>What the AI understands</strong>
          <p className="hint" style={{ marginTop: 4 }}>
            {counts.references} reference image{counts.references === 1 ? '' : 's'} · {counts.layouts} preferred layout{counts.layouts === 1 ? '' : 's'} · {counts.logos} logo{counts.logos === 1 ? '' : 's'}.
          </p>
          {dirty && <p className="hint" style={{ color: '#B26A00', marginBottom: 8 }}>Unsaved changes. Save to see them here.</p>}
          {preview.understanding.length === 0 && <p className="hint">Nothing yet. Upload a logo, brand image or guideline PDF.</p>}
          {preview.understanding.map((r) => (
            <p key={r.label} style={{ fontSize: 13, lineHeight: '19px', margin: '0 0 6px' }}><strong>{r.label}:</strong> {r.value}</p>
          ))}
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            <button type="button" className="link-btn" onClick={() => setShowReview((v) => !v)}>{showReview ? 'Hide what the AI is told' : 'Show what the AI is told'}</button>
          </div>
          {showReview && (
            <div style={{ marginTop: 8 }}>
              <p className="hint" style={{ margin: '6px 0' }}>Added to every caption request:</p>
              {preview.copy.length === 0 ? <p className="hint">Nothing yet.</p> : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: '18px' }}>{preview.copy.map((l, i) => <li key={i}>{l}</li>)}</ul>
              )}
              <p className="hint" style={{ margin: '12px 0 6px' }}>Added to every image request:</p>
              {preview.design.length === 0 ? <p className="hint">Nothing yet.</p> : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: '18px' }}>{preview.design.map((l, i) => <li key={i}>{l}</li>)}</ul>
              )}
              <p className="hint" style={{ marginTop: 10 }}>Reference images and layouts are attached to image requests automatically. All of this except the photography guide is left out when a creative does not follow the brand (no brand assets selected, or its brand-style tick is off).</p>
            </div>
          )}
        </aside>
      </div>
      {learnOpen && <PastAssetsLearner onClose={() => setLearnOpen(false)} onAdd={addLearned} />}
    </Card>
  );
}
