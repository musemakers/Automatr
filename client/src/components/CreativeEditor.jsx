import React, { useEffect, useMemo, useRef, useState } from 'react';
import BloomLoader from './BloomLoader.jsx';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import { whenImageReady, FlowStepBar, ImageStage, ResultTile, ChooseSizePanel, GenerationError, readImageDims, sizePxOf } from './flow/FlowParts.jsx';
import { ElementCard, EditBox } from './flow/ElementCards.jsx';
import { Rail, RailStage, RailPanel, RailBottom } from './flow/Rail.jsx';
import '../styles/rail-edit-adapt.css';
import NextStepCards from './flow/NextStepCards.jsx';
import { useLeaveGuard } from './LeaveGuard.jsx';
import { AiErrorNotice } from './ui.jsx';
import SuggestLink, { UndoLink, useSuggestUndo } from './SuggestLink.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';
import { describeBox } from '../utils/boxes.js';
import { takeHandoffFile } from '../utils/handoff.js';

import iconAdapt from '../assets/generate-home/creative-adapt.svg';
import iconUpload from '../assets/size-adapt/icon-upload.svg';
import iconSwap from '../assets/size-adapt/icon-swap.svg';
import iconPlus from '../assets/size-adapt/icon-plus.svg';
import iconDownWhite from '../assets/size-adapt/icon-download-white.svg';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';

// Creative Edit: Upload -> Review -> Choose size -> Download.
// The app lists what it finds in the creative (logo, headline, sub-headline, subject, background, small print,
// graphics). For each the person chooses Keep, Edit (Rewrite for text, Redesign for imagery - optionally with a
// reference picture) or Remove. A missed element can be added by drawing a box. Only edited / removed elements
// change; everything kept stays exactly as it is. See editCreativeElements in posts.controller.js.
const STEPS = [['01', 'Upload'], ['02', 'Review'], ['03', 'Choose size'], ['04', 'Download']];
const SCAN_MESSAGES = ['Analyzing your creative…', 'Finding the logo, text and imagery…', 'Describing each element…'];

// Region key -> how the element is shown.
function elementsFrom(found) {
  const r = found?.regions || {};
  const box = (k) => (Array.isArray(r[k]) ? { x: r[k][0], y: r[k][1], w: r[k][2], h: r[k][3] } : null);
  const out = [];
  const add = (id, label, kind, detail, b, extra = {}) => out.push({ id, label, kind, detail: detail || '', box: b, action: 'keep', prompt: '', ref: null, rewrite: kind === 'text' || kind === 'small-print', ...extra });
  if (found?.hasLogo) add('logo', 'Logo', 'logo', found.logoDescription, box('logo'));
  if (found?.hasPrimaryHeadline) add('headline', 'Headline', 'text', found.primaryHeadlineText, box('primaryHeadline'), { text: found.primaryHeadlineText });
  if (found?.hasSecondaryText) add('sub', 'Sub-headline', 'text', found.secondaryTextContent || found.secondaryTextDescription, box('secondaryText'), found.secondaryTextContent ? { text: found.secondaryTextContent } : {});
  // Other text lines the detector found (a small kicker line, tagline, offer line ...), each with its own box.
  const others = Array.isArray(found?.otherText) ? found.otherText : [];
  others.forEach((o, i) => add(`text${i + 1}`, others.length === 1 ? 'Text line' : `Text line ${i + 1}`, 'text', o.text || o.description, box(`other${i}`), { text: o.text }));
  if (found?.hasKeyVisual) add('subject', 'Subject', 'subject', found.keyVisualDescription, box('keyVisual'));
  if (found?.hasBackground) add('background', 'Background', 'background', found.backgroundDescription, null);
  if (found?.hasComplianceText) add('small', 'Small print', 'small-print', found.complianceTextDescription, box('complianceText'));
  if (found?.hasDecorativeGraphics) add('graphics', 'Graphics', 'graphics', found.decorativeDescription, box('decorative'));
  return out;
}

export default function CreativeEditor({ onBack }) {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  const { open: openLightbox } = useLightbox();
  const fileInputRef = useRef(null);
  const nextId = useRef(1);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false); // the picked image is being read; shown blurred behind the loader
  const uploadToken = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanMsg, setScanMsg] = useState(0);
  const [scanNote, setScanNote] = useState('');
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [ideas, setIdeas] = useState({});
  const [mode, setMode] = useState('elements'); // 'elements' = edit each element, 'describe' = one instruction for the whole creative
  const [whole, setWhole] = useState('');
  const [wholeIdeas, setWholeIdeas] = useState({ list: [], loading: false, error: null });
  const undoWhole = useSuggestUndo();
  const undoExtra = useSuggestUndo();
  const [extra, setExtra] = useState(''); // "Additional instructions" at the end of Edit elements
  const [extraIdeas, setExtraIdeas] = useState({ list: [], loading: false, error: null });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [size, setSize] = useState(null);
  const [origDims, setOrigDims] = useState(null);
  const [costs, setCosts] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [postId, setPostId] = useState(null);

  useEffect(() => { aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null)); }, []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    if (!drawing) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawing(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawing]);

  const edits = useMemo(() => items.filter((s) => s.action === 'edit'), [items]);
  const removes = useMemo(() => items.filter((s) => s.action === 'remove'), [items]);
  const editReady = (s) => (s.prompt || '').trim().length > 1 || (!s.rewrite && Boolean(s.ref));
  const incomplete = edits.some((s) => !editReady(s));
  const wholeText = whole.trim();
  const describing = mode === 'describe';
  const extraText = extra.trim();
  const canContinue = describing ? Boolean(wholeText) : !scanning && (edits.length + removes.length > 0 || Boolean(extraText)) && !incomplete;

  const selectedDesign = post?.designs?.find((d) => d.label === post.selectedVariantLabel) || post?.designs?.[0];
  const resultUrl = result && selectedDesign?.imageUrl ? resolveAssetUrl(selectedDesign.imageUrl) : '';
  const resultAr = size?.w && size?.h ? size.w / size.h : origDims?.w && origDims?.h ? origDims.w / origDims.h : 0.8;
  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');
  const reachable = [true, Boolean(file), Boolean(file) && scanned && canContinue, Boolean(result)];
  // Nothing to protect on the first step, nor once the creative is made and shown on the last one.
  useLeaveGuard(step > 0 && !(step === 3 && resultUrl && !generating));

  // Handed over from New Creative ("Fine-tune this image"): take the image as if it had been uploaded, then go straight to Review.
  const handoffTried = useRef(false);
  useEffect(() => {
    if (handoffTried.current) return;
    handoffTried.current = true;
    takeHandoffFile('edit').then((f) => { if (f) { handleFile({ target: { files: [f] } }); setStep(1); } }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFile(e) {
    const f = e.target.files?.[0];
    if (e.target.value !== undefined) e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setUploadError('Please choose an image file (PNG, JPG or WebP).'); return; }
    setUploadError('');
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    const token = ++uploadToken.current;
    setUploading(true);
    whenImageReady(f).finally(() => { if (uploadToken.current === token) setUploading(false); });
    setSize(null); setOrigDims(null);
    readImageDims(f).then(setOrigDims);
    items.forEach((s) => s.ref && URL.revokeObjectURL(s.ref.url));
    setItems([]); setScanned(false); setScanNote(''); setActiveId(null); setDrawing(false);
    setIdeas({}); setResult(null); setError(null);
    setWhole(''); setWholeIdeas({ list: [], loading: false, error: null });
    setExtra(''); setExtraIdeas({ list: [], loading: false, error: null });
  }

  useEffect(() => {
    if (step !== 1 || !file || scanned || scanning) return undefined;
    let cancelled = false;
    setScanning(true);
    setScanMsg(0);
    const tick = setInterval(() => setScanMsg((m) => Math.min(m + 1, SCAN_MESSAGES.length - 1)), 1500);
    aiApi.analyzeTemplate(file).then((res) => {
      if (cancelled) return;
      const list = res.detected ? elementsFrom(res.elements) : [];
      if (!list.length) setScanNote('We couldn’t find elements automatically. Draw a box around what you’d like to change, or upload the file again.');
      setItems(list);
    }).catch(() => {
      if (!cancelled) setScanNote('We couldn’t find elements automatically. Draw a box around what you’d like to change, or upload the file again.');
    }).finally(() => {
      clearInterval(tick);
      if (!cancelled) { setScanning(false); setScanned(true); }
    });
    return () => { cancelled = true; clearInterval(tick); setScanning(false); };
  }, [step, file, scanned]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(id, p) { setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s))); }
  function setAction(s, action) {
    // Opening Edit on a text element starts from the text we read, so the person only has to change it.
    const seed = action === 'edit' && s.rewrite && !(s.prompt || '').length && s.text ? { prompt: s.text } : {};
    patch(s.id, { action, ...seed });
    setActiveId(s.id);
  }
  function deleteItem(id) { setItems((prev) => prev.filter((s) => s.id !== id)); if (activeId === id) setActiveId(null); }
  function addDrawn(box) {
    const id = `u${nextId.current++}`;
    const n = items.filter((s) => s.drawn).length + 1;
    setItems((prev) => [...prev, { id, label: `Marked area ${n}`, kind: 'area', detail: describeBox(box), box, action: 'edit', prompt: '', ref: null, rewrite: false, drawn: true }]);
    setActiveId(id);
    setDrawing(false);
  }
  function setRef(s, f) {
    if (s.ref) URL.revokeObjectURL(s.ref.url);
    patch(s.id, { ref: { file: f, url: URL.createObjectURL(f), name: f.name } });
  }
  function clearRef(s) { if (s.ref) URL.revokeObjectURL(s.ref.url); patch(s.id, { ref: null }); }

  async function suggest(s) {
    const cur = ideas[s.id] || { list: [], seen: [] };
    setIdeas((p) => ({ ...p, [s.id]: { ...cur, loading: true, error: null } }));
    try {
      let fresh = [];
      const typed = (s.prompt || '').trim();
      if (typed) {
        // Improve: three better versions of what the marketer typed (never the same text back), shown as cards to pick from
        ({ options: fresh = [] } = await aiApi.improveText({ text: typed, kind: s.rewrite ? `replacement wording for the "${s.label}" text on a creative` : `instruction for changing the "${s.label}" on a creative`, context: s.text || s.detail || '' }));
        if (!fresh.length) throw new Error('Could not find a better version this time. Please try again.');
        setIdeas((p) => ({ ...p, [s.id]: { list: fresh, seen: [...cur.seen, ...fresh], loading: false, error: null } }));
        return;
      }
      if (s.rewrite) {
        const { variations = [] } = await aiApi.generateHeadlineVariations({ originalHeadline: (s.prompt || s.text || s.label).trim() });
        fresh = variations.map((v) => (typeof v === 'string' ? v : v.text || v.headline || '')).filter(Boolean);
      } else {
        ({ ideas: fresh = [] } = await aiApi.heroIdeas({ file, current: `${s.label}${s.detail ? `: ${s.detail}` : ''}`, position: describeBox(s.box), background: '', direction: s.prompt || '', exclude: cur.seen }));
      }
      // exactly one suggestion goes straight into the box; several are offered as cards to pick from
      if (fresh.length === 1) { patch(s.id, { prompt: fresh[0] }); fresh = []; }
      setIdeas((p) => ({ ...p, [s.id]: { list: fresh, seen: [...cur.seen, ...fresh], loading: false, error: null } }));
    } catch (err) {
      setIdeas((p) => ({ ...p, [s.id]: { ...cur, loading: false, error: apiErrorInfo(err) } }));
    }
  }

  async function suggestWhole() {
    setWholeIdeas((w) => ({ ...w, loading: true, error: null }));
    try {
      if (whole.trim()) {
        const { options = [] } = await aiApi.improveText({ text: whole, kind: 'instruction for changing a whole creative' });
        if (!options.length) throw new Error('Could not find a better version this time. Please try again.');
        setWholeIdeas({ list: options, loading: false, error: null });
        return;
      }
      const { ideas: fresh = [] } = await aiApi.heroIdeas({ file, current: 'the whole creative', position: '', background: '', direction: whole, exclude: wholeIdeas.list });
      if (fresh.length === 1) { const prev = whole; undoWhole.remember(() => setWhole(prev)); setWhole(fresh[0]); setWholeIdeas({ list: [], loading: false, error: null }); return; }
      setWholeIdeas({ list: fresh, loading: false, error: null });
    } catch (err) {
      setWholeIdeas((w) => ({ ...w, loading: false, error: apiErrorInfo(err) }));
    }
  }

  // One reworked suggestion for the additional instructions (Suggest when empty, Improve when there is text).
  async function suggestExtra() {
    setExtraIdeas((w) => ({ ...w, loading: true, error: null }));
    try {
      if (extra.trim()) {
        const { options = [] } = await aiApi.improveText({ text: extra, kind: 'additional requirements for editing a creative' });
        if (!options.length) throw new Error('Could not find a better version this time. Please try again.');
        setExtraIdeas({ list: options, loading: false, error: null });
        return;
      }
      const { ideas: fresh = [] } = await aiApi.heroIdeas({ file, current: 'additional requirements for editing the creative', position: '', background: '', direction: extra, exclude: extraIdeas.list });
      if (fresh[0]) { const prev = extra; undoExtra.remember(() => setExtra(prev)); setExtra(fresh[0]); }
      setExtraIdeas({ list: [], loading: false, error: null });
    } catch (err) {
      setExtraIdeas((w) => ({ ...w, loading: false, error: apiErrorInfo(err) }));
    }
  }

  async function generate() {
    setError(null);
    setStep(3);
    setGenerating(true);
    setResult(null);
    const payload = [];
    const files = [];
    (describing ? [] : [...edits, ...removes]).forEach((s) => {
      const base = { label: s.label, kind: s.kind, current: s.text || s.detail, where: s.box ? describeBox(s.box) : '' };
      if (s.action === 'remove') payload.push({ ...base, action: 'remove' });
      else {
        const it = { ...base, action: s.rewrite ? 'rewrite' : 'redesign', prompt: (s.prompt || '').trim() };
        if (!s.rewrite && s.ref) { it.refIndex = files.length; files.push(s.ref.file); }
        payload.push(it);
      }
    });
    if (describing && wholeText) payload.unshift({ label: 'Whole creative', kind: 'overall', current: 'the entire creative', where: '', action: 'redesign', prompt: wholeText });
    if (!describing && extraText) payload.push({ label: 'Additional instructions', kind: 'extra', current: '', where: '', action: 'redesign', prompt: extraText });
    try {
      let id = postId;
      if (!id) {
        const { post: created } = await postsApi.create({ creativeType: 'adaptation', purpose: 'Creative edit', mediums: ['instagram_feed'], briefNote: '', selectedAssets: [], exactAssetIds: [], creativeBrief: {} });
        id = created._id;
        setPostId(id);
      }
      const keep = describing ? [] : items.filter((s) => s.action === 'keep').map((s) => `${s.label}${s.text || s.detail ? ` (${s.text || s.detail})` : ''}`);
      const { post: updated, meta } = await postsApi.editCreative(id, file, files, { items: payload, keep }, sizePxOf(size));
      setPost(updated);
      setResult({ width: meta?.width, height: meta?.height });
      window.dispatchEvent(new Event('automatr:allowance-refresh'));
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setGenerating(false);
    }
  }

  async function download() {
    if (!selectedDesign?.imageUrl) return;
    setDownloading(true);
    try {
      const ext = (/\.(png|jpe?g|webp)(\?|$)/i.exec(selectedDesign.imageUrl)?.[1] || 'png').toLowerCase();
      await downloadFile(resolveAssetUrl(selectedDesign.imageUrl), `${baseName}-creative-edit.${ext}`);
    } catch {
      setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' });
    } finally {
      setDownloading(false);
    }
  }

  const stageBoxes = describing ? [] : items.map((s) => ({ id: s.id, box: s.box, selected: s.action === 'keep', remove: s.action === 'remove', label: `${s.label}${s.action === 'remove' ? ' (will be removed)' : ''}` }));
  const countText = describing ? (wholeText ? 'Your change will be applied to the whole creative.' : 'Describe the change you want to continue.')
    : scanning || !scanned ? 'Analyzing your creative…'
    : incomplete ? 'Say what to change for each element you’re editing.'
    : edits.length + removes.length === 0 && !extraText ? 'Nothing selected yet. Choose Edit or Remove on at least one element.'
    : `${[edits.length && `${edits.length} to edit`, removes.length && `${removes.length} to remove`, extraText && 'additional instructions added'].filter(Boolean).join(', ')}. Everything else stays as it is.`;

  return (
    <Layout rail pageClass={step === 3 ? 'page-result page-creative-edit-download' : ''} flowBar={<FlowStepBar icon={iconAdapt} name="Creative Edit" steps={STEPS} step={step} reachable={reachable} onStep={setStep} />}>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />
      {!(step === 3 && error && !resultUrl && !generating) && <AiErrorNotice error={error} />}

      {step === 0 && (
        <Rail>
          <RailStage
            id="dropzone"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('is-dragover')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('is-dragover'); const f = e.dataTransfer?.files?.[0]; if (f) handleFile({ target: { files: [f] } }); }}
          >
            <div className={`sa-preview ${previewUrl ? 'sa-preview--filled' : 'sa-preview--empty'} ${uploading ? 'sa-preview--loading' : ''}`.trim()}>
              {previewUrl && <img src={previewUrl} alt="Your uploaded creative" />}
              {uploading && <div className="sa-preview__busy"><BloomLoader bare label="Getting your creative ready" /></div>}
              {previewUrl && !uploading && (
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-preview__action" onClick={() => fileInputRef.current?.click()}>
                  <span>Replace file</span><img className="sa-icon-swap" src={iconSwap} alt="" />
                </button>
              )}
            </div>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">01 / Upload</p>
            <h2 className="sa-heading">Edit your creative</h2>
            <div className="sa-copy">
              <p>Upload the creative you want to refine.</p>
              <p>We’ll find the elements in your creative: logo, headline, subject, product and more. You choose what to keep, edit or remove, then pick a size.</p>
            </div>
            {!file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => fileInputRef.current?.click()}><span>Upload creative</span><img src={iconUpload} alt="" /></button>}
            {file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={uploading} onClick={() => setStep(1)}><span>Continue</span><img src={iconArrowWhite} alt="" /></button>}
            {uploadError && <p className="fx-err" role="alert">{uploadError}</p>}
          </RailPanel>
        </Rail>
      )}

      {step === 1 && file && (
        <Rail>
          <RailStage>
            <ImageStage src={previewUrl} alt="Your creative with the detected elements outlined" boxes={stageBoxes} activeId={activeId} scanning={scanning && !describing} scanText={SCAN_MESSAGES[scanMsg]} drawing={drawing && !describing} tip="Draw a box around the area you want to keep, edit or remove." onSelect={setActiveId} onDraw={addDrawn} minW={0.03} minH={0.03}>
              {!describing && (
                <button type="button" className={`sa-btn sa-btn--white sa-btn--sm sa-preview__action ${drawing ? 'is-on' : ''}`.trim()} disabled={scanning} onClick={() => setDrawing((d) => !d)}>
                  <span>{drawing ? 'Cancel marking' : 'Add missing element'}</span><img src={iconPlus} alt="" />
                </button>
              )}
            </ImageStage>
            <p className="rail__stage-count" aria-live="polite">{countText}</p>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">02 / Review</p>
            <h2 className="sa-heading">What would you like to change?</h2>
            <div className="ce-seg" role="tablist" aria-label="How do you want to make the change?">
              {[['elements', 'Edit elements'], ['describe', 'Describe the change']].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`ce-seg-${key}`}
                  aria-selected={mode === key}
                  tabIndex={mode === key ? 0 : -1}
                  className={`ce-seg__btn ${mode === key ? 'is-on' : ''}`.trim()}
                  onClick={() => { setMode(key); setDrawing(false); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const other = key === 'elements' ? 'describe' : 'elements'; setMode(other); setDrawing(false); document.getElementById(`ce-seg-${other}`)?.focus(); } }}
                >{label}</button>
              ))}
            </div>
            {!describing && <p>We found the elements below. Keep each one, edit it, or remove it. Anything you keep stays exactly as it is.</p>}
            {describing && <p>Tell us what you would like changed and we will update the whole creative.</p>}
            {describing && (
              <section className="ce-whole" aria-labelledby="ce-whole-label">
                <div className="ce-whole__head">
                  <label className="ce-whole__label" id="ce-whole-label" htmlFor="ce-whole-text">Describe the change you want</label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                    <SuggestLink onClick={suggestWhole} loading={wholeIdeas.loading} improve={Boolean(whole.trim())} label="Suggest changes for the whole creative" />
                    {undoWhole.can && <UndoLink onClick={undoWhole.run} />}
                  </span>
                </div>
                <textarea id="ce-whole-text" className="fx-field" rows={3} maxLength={400} placeholder="For example: make it warmer and more premium, with a soft blue background" value={whole} onChange={(e) => setWhole(e.target.value)} />
                {wholeIdeas.error && <AiErrorNotice error={wholeIdeas.error} />}
                {wholeIdeas.list.length > 0 && (
                  <div className="fx-ideas">
                    {wholeIdeas.list.map((t) => <button key={t} type="button" className="fx-idea" onClick={() => { const prev = whole; undoWhole.remember(() => setWhole(prev)); setWhole(t); setWholeIdeas((w) => ({ ...w, list: [] })); }}>{t}</button>)}
                  </div>
                )}
              </section>
            )}
            {!describing && scanning && <div className="fx-list" aria-hidden="true"><div className="fx-skel fx-skel-row" /><div className="fx-skel fx-skel-row" /><div className="fx-skel fx-skel-row" /></div>}
            {!describing && !scanning && (
              <div className="fx-list">
                {items.map((s, i) => {
                  const idea = ideas[s.id] || { list: [], seen: [] };
                  return (
                    <ElementCard key={s.id} item={s} index={i} active={s.id === activeId} onActive={() => setActiveId(s.id)} onAction={(a) => setAction(s, a)} onDelete={() => deleteItem(s.id)} detail={s.action === 'edit' ? '' : s.detail} actions={undefined}>
                      {!describing && (
                        <EditBox
                          value={s.prompt || ''}
                          onChange={(v) => patch(s.id, { prompt: v })}
                          placeholder={s.rewrite ? `Enter the new ${s.label.toLowerCase()}` : `Describe what should replace the ${s.label.toLowerCase()}`}
                          ariaLabel={s.rewrite ? `New ${s.label.toLowerCase()} text` : `How to redesign the ${s.label.toLowerCase()}`}
                          onSuggest={() => suggest(s)}
                          ideas={idea}
                          onPickIdea={(t) => { patch(s.id, { prompt: t }); setIdeas((p) => ({ ...p, [s.id]: { ...idea, list: [] } })); }}
                          allowReference={!s.rewrite}
                          reference={s.ref}
                          onReference={(f) => setRef(s, f)}
                          onClearReference={() => clearRef(s)}
                        />
                      )}
                    </ElementCard>
                  );
                })}
                {!items.length && <p className="sa-note">{scanNote ? `${scanNote} ` : ''}Use “Add missing element” and draw a box around what you’d like to change.</p>}
              </div>
            )}
            {!describing && !scanning && (
              <section className="ce-whole" aria-labelledby="ce-extra-label">
                <div className="ce-whole__head">
                  <label className="ce-whole__label" id="ce-extra-label" htmlFor="ce-extra-text">Additional instructions</label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                    <SuggestLink onClick={suggestExtra} loading={extraIdeas.loading} improve={Boolean(extra.trim())} label="Suggest additional instructions" />
                    {undoExtra.can && <UndoLink onClick={undoExtra.run} />}
                  </span>
                </div>
                <textarea id="ce-extra-text" className="fx-field" rows={3} maxLength={400} placeholder="Anything else we should keep in mind? For example: keep the same colour palette, or make the lighting a little warmer" value={extra} onChange={(e) => setExtra(e.target.value)} />
                {extraIdeas.error && <AiErrorNotice error={extraIdeas.error} />}
                {extraIdeas.list.length > 0 && (
                  <div className="fx-ideas">
                    {extraIdeas.list.map((t) => <button key={t} type="button" className="fx-idea" onClick={() => { const prev = extra; undoExtra.remember(() => setExtra(prev)); setExtra(t); setExtraIdeas((w) => ({ ...w, list: [] })); }}>{t}</button>)}
                  </div>
                )}
              </section>
            )}
            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!canContinue} onClick={() => setStep(2)}>
              <span>Continue</span><img src={iconArrowWhite} alt="" />
            </button>
          </RailPanel>
        </Rail>
      )}

      {step === 2 && (
        <ChooseSizePanel kicker="03 / Choose size" heading="Which size do you need?" previewUrl={previewUrl} size={size} onSize={setSize} originalDims={origDims} costs={costs} hint="" onGenerate={generate} />
      )}

      {step === 3 && (
        <Rail bottom>
          <RailStage scroll>
            <div className="rail__stage-inner">
              <div className="sa-tiles sa-tiles--single" style={{ '--ar': resultAr }}>
                <ResultTile
                  url={resultUrl} alt="Your edited creative" downloadName="the edited creative"
                  working={generating} workingLabel="Applying your edits…" downloading={downloading} onDownload={download}
                  onPreview={() => openLightbox({ src: selectedDesign.imageUrl, title: 'Your creative', formatId: size?.formatId && size.formatId !== 'original' ? size.formatId : undefined, downloadName: `${baseName}-creative-edit.png` })}
                >
                  <span>{selectedDesign?.imageNote || 'Nothing was made.'}</span>
                </ResultTile>
              </div>
            </div>
          </RailStage>
          <RailBottom
            text={(
              <>
                <p className="sa-kicker">04 / Download</p>
                {error && !resultUrl && !generating
                  ? <GenerationError error={error} onRetry={generate} />
                  : <p>{generating ? 'Generating your creative. This can take a minute or two - everything else stays untouched.' : 'Your edits have been applied. Preview the result, then download it.'}</p>}
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!resultUrl || generating || downloading} onClick={download}>
                  <span>Download</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
                </button>
                <div className="sa-links">
                  <button type="button" className="sa-link" onClick={() => setStep(1)}>← Change the edits</button>
                  {resultUrl && <button type="button" className="sa-link" onClick={() => navigate('/modify')}>Fine tune →</button>}
                </div>
              </>
            )}
            actions={<NextStepCards adapt convert imageUrl={resultUrl && !generating ? selectedDesign.imageUrl : ''} />}
          />
        </Rail>
      )}
    </Layout>
  );
}
