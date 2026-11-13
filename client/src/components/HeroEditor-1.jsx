import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import { FlowStepBar, ImageStage, ResultTile, ChooseSizePanel, GenerationError, readImageDims, sizePxOf, sizeSummary } from './flow/FlowParts.jsx';
import { ElementCard, EditBox } from './flow/ElementCards.jsx';
import NextStepCards from './flow/NextStepCards.jsx';
import { Rail, RailStage, RailPanel, RailStageInner, RailBottom } from './flow/Rail.jsx';
import '../styles/rail-subject-headline.css';
import { useLeaveGuard } from './LeaveGuard.jsx';
import { AiErrorNotice } from './ui.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';
import { describeBox } from '../utils/boxes.js';

import iconSwapTool from '../assets/generate-home/replace.webp';
import iconUpload from '../assets/size-adapt/icon-upload.svg';
import iconSwap from '../assets/size-adapt/icon-swap.svg';
import iconPlus from '../assets/size-adapt/icon-plus.svg';
import iconDownWhite from '../assets/size-adapt/icon-download-white.svg';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';

// Subject Swap: Upload -> Review -> Choose size -> Download.
// Review is ONE screen: the app outlines every subject it finds and the person decides per subject - Keep it,
// Edit it (describe what replaces it, optionally with a reference picture) or Remove it. A missed subject can be
// added by drawing a box. Only edited / removed subjects change; text, logos, background and layout stay.
// See editHeroImage / editHeroItems in posts.controller.js.
const STEPS = [['01', 'Upload'], ['02', 'Review'], ['03', 'Choose size'], ['04', 'Download']];
const SCAN_MESSAGES = ['Analyzing your creative…', 'Finding the subjects…', 'Describing what we found…'];

export default function HeroEditor({ onBack }) {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  const { open: openLightbox } = useLightbox();
  const fileInputRef = useRef(null);
  const nextId = useRef(1);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanMsg, setScanMsg] = useState(0);
  const [scanNote, setScanNote] = useState('');
  // [{ id, label, detail, position, background, box, action: 'keep'|'edit'|'remove', prompt, ref: { file, url, name }, drawn }]
  const [subjects, setSubjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [ideas, setIdeas] = useState({}); // id -> { list, seen, loading, error }
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [recap, setRecap] = useState([]);
  const [error, setError] = useState(null);
  const [size, setSize] = useState(null);
  const [origDims, setOrigDims] = useState(null);
  const [costs, setCosts] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [postId, setPostId] = useState(() => (post?.creativeType === 'hero' ? post._id : null));

  useEffect(() => { aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null)); }, []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    if (!drawing) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawing(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawing]);

  const edits = useMemo(() => subjects.filter((s) => s.action === 'edit'), [subjects]);
  const removes = useMemo(() => subjects.filter((s) => s.action === 'remove'), [subjects]);
  const editReady = (s) => (s.prompt || '').trim().length > 2 || Boolean(s.ref);
  const incomplete = edits.some((s) => !editReady(s));
  const canContinue = edits.length + removes.length > 0 && !incomplete && !scanning;

  const selectedDesign = post?.designs?.find((d) => d.label === post.selectedVariantLabel) || post?.designs?.[0];
  const resultUrl = result && selectedDesign?.imageUrl ? resolveAssetUrl(selectedDesign.imageUrl) : '';
  const resultDims = (result?.width && result?.height ? { w: result.width, h: result.height } : null) || (size?.w && size?.h ? size : null) || origDims;
  const resultAr = resultDims?.w && resultDims?.h ? resultDims.w / resultDims.h : 0.8;
  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');
  const reachable = [true, Boolean(file), Boolean(file) && scanned && canContinue, Boolean(result)];
  // Nothing to protect on the first step, nor once the creative is made and shown on the last one.
  useLeaveGuard(step > 0 && !(step === 3 && resultUrl && !generating));

  /* ---------------- 01 Upload ---------------- */
  function handleFile(e) {
    const f = e.target.files?.[0];
    if (e.target.value !== undefined) e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setUploadError('Please choose an image file (PNG, JPG or WebP).'); return; }
    setUploadError('');
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setSize(null); setOrigDims(null);
    readImageDims(f).then(setOrigDims);
    subjects.forEach((s) => s.ref && URL.revokeObjectURL(s.ref.url));
    setSubjects([]); setScanned(false); setScanNote(''); setActiveId(null); setDrawing(false);
    setIdeas({}); setResult(null); setError(null);
  }

  /* ---------------- 02 Review ---------------- */
  useEffect(() => {
    if (step !== 1 || !file || scanned || scanning) return undefined;
    let cancelled = false;
    setScanning(true);
    setScanMsg(0);
    const tick = setInterval(() => setScanMsg((m) => Math.min(m + 1, SCAN_MESSAGES.length - 1)), 1500);
    aiApi.analyzeHero(file).then((res) => {
      if (cancelled) return;
      const list = res.detected && res.hero ? (res.hero.heroes?.length ? res.hero.heroes : [res.hero]) : [];
      if (!list.length) setScanNote('We couldn’t find a subject automatically. Draw a box around it instead.');
      setSubjects(list.map((h, i) => ({ id: `s${nextId.current++}`, label: h.label || `Subject ${i + 1}`, detail: h.description || '', position: h.position || '', background: h.background || '', box: h.box || null, action: 'keep', prompt: '', ref: null })));
    }).catch(() => {
      if (!cancelled) setScanNote('We couldn’t find a subject automatically. Draw a box around it instead.');
    }).finally(() => {
      clearInterval(tick);
      if (!cancelled) { setScanning(false); setScanned(true); }
    });
    return () => { cancelled = true; clearInterval(tick); setScanning(false); };
  }, [step, file, scanned]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(id, p) { setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s))); }
  function setAction(s, action) {
    patch(s.id, { action });
    setActiveId(s.id);
  }
  function deleteSubject(id) { setSubjects((prev) => prev.filter((s) => s.id !== id)); if (activeId === id) setActiveId(null); }
  function addDrawn(box) {
    const id = `u${nextId.current++}`;
    setSubjects((prev) => [...prev, { id, label: `Subject ${prev.length + 1}`, detail: describeBox(box), position: describeBox(box), background: '', box, action: 'edit', prompt: '', ref: null, drawn: true }]);
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
      const { ideas: fresh = [] } = await aiApi.heroIdeas({
        file, current: s.detail.trim() || s.label, position: describeBox(s.box) || s.position, background: s.background,
        direction: s.prompt || '', exclude: cur.seen
      });
      setIdeas((p) => ({ ...p, [s.id]: { list: fresh, seen: [...cur.seen, ...fresh], loading: false, error: null } }));
    } catch (err) {
      setIdeas((p) => ({ ...p, [s.id]: { ...cur, loading: false, error: apiErrorInfo(err) } }));
    }
  }

  /* ---------------- generate ---------------- */
  async function generate() {
    setError(null);
    setStep(3);
    setGenerating(true);
    setResult(null);
    const items = [];
    const files = [];
    [...edits, ...removes].forEach((s) => {
      const base = { current: s.detail.trim() || s.label, position: describeBox(s.box) || s.position };
      if (s.action === 'remove') items.push({ ...base, mode: 'remove' });
      else if (s.ref) { items.push({ ...base, mode: 'upload', refIndex: files.length, newHero: (s.prompt || '').trim() }); files.push(s.ref.file); }
      else items.push({ ...base, mode: 'describe', newHero: (s.prompt || '').trim() });
    });
    setRecap(
      edits.map((s) => `${s.label} → ${(s.prompt || '').trim() ? `“${s.prompt.trim()}”` : 'your reference image'}`)
        .concat(`Removed → ${removes.length ? removes.map((s) => s.label).join(', ') : 'nothing'}`)
        .concat(`Size → ${sizeSummary(size, origDims)}`)
    );
    try {
      let id = postId;
      if (!id) {
        const { post: created } = await postsApi.create({ creativeType: 'hero', purpose: 'Hero image edit', mediums: ['instagram_feed'], briefNote: '', selectedAssets: [], exactAssetIds: [], creativeBrief: {} });
        id = created._id;
        setPostId(id);
      }
      const keep = subjects.filter((s) => s.action === 'keep').map((s) => `${s.detail.trim() || s.label}${s.box ? ` (${describeBox(s.box)})` : ''}`);
      const { post: updated, meta } = await postsApi.editHero(id, file, files, { items, keep }, sizePxOf(size));
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
      await downloadFile(resolveAssetUrl(selectedDesign.imageUrl), `${baseName}-subject-swap.${ext}`);
    } catch {
      setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' });
    } finally {
      setDownloading(false);
    }
  }

  // Keep = solid blue, Edit = white dashed, Remove = red (same as the reference boxes).
  const stageBoxes = subjects.map((s) => ({ id: s.id, box: s.box, selected: s.action === 'keep', remove: s.action === 'remove', label: `${s.label}: ${s.detail || 'drawn by you'}${s.action === 'remove' ? ' (will be removed)' : ''}` }));
  const countText = scanning || !scanned ? 'Analyzing your creative…'
    : incomplete ? 'Describe the replacement for each subject you’re editing.'
    : edits.length + removes.length === 0 ? 'Choose Edit or Remove for at least one subject.'
    : `${[edits.length && `${edits.length} to edit`, removes.length && `${removes.length} to remove`].filter(Boolean).join(', ')}. Everything else stays as it is.`;

  return (
    <Layout rail pageClass={step === 3 ? 'page-result page-subject-swap-download' : ''} flowBar={<FlowStepBar icon={iconSwapTool} name="Subject Swap" steps={STEPS} step={step} reachable={reachable} onStep={setStep} />}>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />
      {!(step === 3 && error && !resultUrl && !generating) && <AiErrorNotice error={error} />}

      {/* ---------------- 01 Upload ---------------- */}
      {step === 0 && (
        <Rail>
          <RailStage
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('is-dragover')}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('is-dragover'); const f = e.dataTransfer?.files?.[0]; if (f) handleFile({ target: { files: [f] } }); }}
          >
            <div className={`sa-preview ${previewUrl ? 'sa-preview--filled' : 'sa-preview--empty'}`.trim()}>
              {previewUrl && <img src={previewUrl} alt="Your uploaded creative" />}
              {previewUrl && (
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-preview__action" onClick={() => fileInputRef.current?.click()}>
                  <span>Replace file</span><img className="sa-icon-swap" src={iconSwap} alt="" />
                </button>
              )}
            </div>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">01 / Upload</p>
            <h2 className="sa-heading">Replace a subject</h2>
            <p>Upload the creative with the subject you want to change.</p>
            <p>We’ll identify the subjects in your image. You choose what to keep, edit or remove. Everything else stays as it is.</p>
            {!file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => fileInputRef.current?.click()}><span>Upload creative</span><img src={iconUpload} alt="" /></button>}
            {file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => setStep(1)}><span>Continue</span><img src={iconArrowWhite} alt="" /></button>}
            {uploadError && <p className="fx-err" role="alert">{uploadError}</p>}
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 02 Review ---------------- */}
      {step === 1 && file && (
        <Rail>
          <RailStage>
              <ImageStage src={previewUrl} alt="Your creative with the detected subjects outlined" boxes={stageBoxes} activeId={activeId} scanning={scanning} scanText={SCAN_MESSAGES[scanMsg]} drawing={drawing} tip="Draw a box around the subject we missed." onSelect={setActiveId} onDraw={addDrawn}>
                <button type="button" className={`sa-btn sa-btn--white sa-btn--sm sa-preview__action ${drawing ? 'is-on' : ''}`.trim()} disabled={scanning} onClick={() => setDrawing((d) => !d)}>
                  <span>{drawing ? 'Cancel drawing' : 'Add missing subject'}</span><img src={iconPlus} alt="" />
                </button>
              </ImageStage>
            <p className="rail__stage-count" aria-live="polite">{countText}</p>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">02 / Review</p>
            <h2 className="sa-heading">Which subjects would you like to change?</h2>
            <p>We found the subjects below. Keep each one, edit it by describing what should replace it, or remove it. Everything else stays as it is.</p>
            {scanning && <div className="fx-list" aria-hidden="true"><div className="fx-skel fx-skel-row" /><div className="fx-skel fx-skel-row" /></div>}
            {!scanning && (
              <div className="fx-list">
                {subjects.map((s, i) => {
                  const idea = ideas[s.id] || { list: [], seen: [] };
                  return (
                    <ElementCard key={s.id} item={s} index={i} active={s.id === activeId} onActive={() => setActiveId(s.id)} onAction={(a) => setAction(s, a)} onDelete={() => deleteSubject(s.id)} detail={s.action === 'edit' ? '' : s.detail}>
                      <EditBox
                        value={s.prompt || ''}
                        onChange={(v) => patch(s.id, { prompt: v })}
                        placeholder="Describe what should replace this subject"
                        ariaLabel={`New subject to replace ${s.label}`}
                        onSuggest={() => suggest(s)}
                        ideas={idea}
                        onPickIdea={(t) => { patch(s.id, { prompt: t }); setIdeas((p) => ({ ...p, [s.id]: { ...idea, list: [] } })); }}
                        reference={s.ref}
                        onReference={(f) => setRef(s, f)}
                        onClearReference={() => clearRef(s)}
                      />
                    </ElementCard>
                  );
                })}
                {!subjects.length && <p className="sa-note">{scanNote ? `${scanNote} ` : ''}No subjects yet. Use “Add missing subject” and draw a box around the part of the image you want to change.</p>}
              </div>
            )}
            {!scanning && subjects.length > 0 && !subjects.some((x) => x.box) && <p className="sa-note">We couldn’t outline these on the image automatically. Use “Add missing subject” to mark the area yourself.</p>}
            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!canContinue} onClick={() => setStep(2)}>
              <span>Continue</span><img src={iconArrowWhite} alt="" />
            </button>
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 03 Choose size ---------------- */}
      {step === 2 && (
        <ChooseSizePanel
          kicker="03 / Choose size"
          heading="Which size do you need?"
          previewUrl={previewUrl}
          size={size}
          onSize={setSize}
          originalDims={origDims}
          costs={costs}
          hint=""
          onGenerate={generate}
        />
      )}

      {/* ---------------- 04 Download ---------------- */}
      {step === 3 && (
        <Rail bottom>
          <RailStage scroll>
            <RailStageInner>
              <div className="sa-tiles sa-tiles--single" style={{ '--ar': resultAr }}>
                <ResultTile
                  title="" url={resultUrl} alt="Your creative with the new subject" downloadName="the swapped creative"
                  working={generating} workingLabel="Swapping…" downloading={downloading} onDownload={download}
                  onPreview={() => openLightbox({ src: selectedDesign.imageUrl, title: 'Your creative', downloadName: `${baseName}-subject-swap.png` })}
                >
                  <span>{selectedDesign?.imageNote || 'Nothing was made.'}</span>
                </ResultTile>
              </div>
            </RailStageInner>
          </RailStage>
          <RailBottom
            text={(
              <>
                <p className="sa-kicker">04 / Download</p>
                {error && !resultUrl && !generating
                  ? <GenerationError error={error} onRetry={generate} />
                  : <p>{generating ? 'Generating your creative. This can take a minute or two - everything else stays untouched.' : 'Your subject changes have been applied. Preview the result, then download it.'}</p>}
                <div className="fx-list">{recap.map((r) => <p className="fx-recap" key={r}>{r}</p>)}</div>
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!resultUrl || generating || downloading} onClick={download}>
                  <span>Download</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
                </button>
                <div className="sa-links">
                  <button type="button" className="sa-link" onClick={() => setStep(1)}>← Change the subjects</button>
                  {resultUrl && <button type="button" className="sa-link" onClick={() => navigate('/modify')}>Fine tune →</button>}
                </div>
              </>
            )}
            actions={<NextStepCards adapt imageUrl={resultUrl && !generating ? selectedDesign.imageUrl : ''} />}
          />
        </Rail>
      )}
    </Layout>
  );
}
