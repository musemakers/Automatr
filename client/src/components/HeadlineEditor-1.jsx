import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import { FlowStepBar, ImageStage, ResultTile, ChooseSizePanel, GenerationError, readImageDims, sizePxOf, sizeSummary } from './flow/FlowParts.jsx';
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

import iconTool from '../assets/generate-home/text-select.svg';
import iconUpload from '../assets/size-adapt/icon-upload.svg';
import iconSwap from '../assets/size-adapt/icon-swap.svg';
import iconPlus from '../assets/size-adapt/icon-plus.svg';
import iconDownWhite from '../assets/size-adapt/icon-download-white.svg';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';
import iconSparkle from '../assets/generate-home/sparkle.svg';

// Headline Switch: Upload -> Review (find the headline and change it) -> Choose size -> Download.
// The app outlines the headline and sub-headline it reads on the creative; for each line the person keeps it,
// changes the text or removes it (or draws a box to add text the app missed). Only those lines are edited; the
// rest of the creative is untouched. See editHeadlineText in posts.controller.js.
const STEPS = [['01', 'Upload'], ['02', 'Review'], ['03', 'Choose size'], ['04', 'Download']];
const ACTIONS = [['change', 'Change text'], ['keep', 'Keep original'], ['remove', 'Remove']];
const SCAN_MESSAGES = ['Looking at your creative…', 'Finding the headline…', 'Reading the text…'];

export default function HeadlineEditor({ onBack }) {
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
  // [{ id, role, label, original, position, box, action, text, user, direction, options, loadingOptions, optionsError }]
  const [lines, setLines] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [recap, setRecap] = useState([]);
  const [error, setError] = useState(null);
  const [size, setSize] = useState(null); // { platform, formatId, w, h, label } from the size picker; null = keep original
  const [origDims, setOrigDims] = useState(null);
  const [costs, setCosts] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // Re-used on retry so a failed edit never leaves duplicate posts behind.
  const [postId, setPostId] = useState(() => (post?.creativeType === 'headline' ? post._id : null));

  useEffect(() => { aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null)); }, []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    if (!drawing) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawing(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawing]);

  // A line counts as changed when it is removed, or its new text differs from what is on the image.
  const isChanged = (l) => l.action === 'remove' || (l.action === 'change' && l.text.trim().length > 0 && l.text.trim() !== l.original.trim());
  const changed = useMemo(() => lines.filter(isChanged), [lines]);
  const incomplete = lines.filter((l) => l.action === 'change' && l.text.trim().length === 0);
  const canGenerate = changed.length > 0 && incomplete.length === 0 && !generating;

  const selectedDesign = post?.designs?.find((d) => d.label === post.selectedVariantLabel) || post?.designs?.[0];
  const resultUrl = result && selectedDesign?.imageUrl ? resolveAssetUrl(selectedDesign.imageUrl) : '';
  const resultDims = (result?.width && result?.height ? { w: result.width, h: result.height } : null) || (size?.w && size?.h ? size : null) || origDims;
  const resultAr = resultDims?.w && resultDims?.h ? resultDims.w / resultDims.h : 0.8;
  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');
  const reachable = [true, Boolean(file), Boolean(file) && canGenerate, Boolean(result)];
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
    setLines([]); setScanned(false); setScanNote(''); setActiveId(null); setDrawing(false); setResult(null); setError(null);
  }

  /* ---------------- 02 Find headline ---------------- */
  useEffect(() => {
    if (step !== 1 || !file || scanned || scanning) return undefined;
    let cancelled = false;
    setScanning(true);
    setScanMsg(0);
    const tick = setInterval(() => setScanMsg((m) => Math.min(m + 1, SCAN_MESSAGES.length - 1)), 1500);
    aiApi.analyzeHeadline(file).then((res) => {
      if (cancelled) return;
      if (res.detected && res.lines?.length) {
        setLines(res.lines.map((l) => ({
          id: l.id, role: l.role, label: l.label, original: l.text, position: l.position || '', box: l.box || null,
          action: 'change', text: l.text, direction: '', options: [], loadingOptions: false, optionsError: null
        })));
      } else {
        setScanNote(res.detected ? "We couldn't find a headline or sub-headline on this image." : `Automatic detection isn't available (${res.reason || 'analysis unavailable'}).`);
      }
    }).catch(() => {
      if (!cancelled) setScanNote("We couldn't read the text on this image.");
    }).finally(() => {
      clearInterval(tick);
      if (!cancelled) { setScanning(false); setScanned(true); }
    });
    return () => { cancelled = true; clearInterval(tick); setScanning(false); };
  }, [step, file, scanned]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchLine(id, patch) { setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l))); }
  function removeLine(id) { setLines((prev) => prev.filter((l) => l.id !== id)); if (activeId === id) setActiveId(null); }
  function addDrawn(box) {
    const id = `u${nextId.current++}`;
    setLines((prev) => {
      const n = prev.filter((l) => l.user).length + 1;
      return [...prev, { id, role: `New text ${n}`, label: `New text ${n}`, original: '', position: describeBox(box), box, action: 'change', text: '', user: true, direction: '', options: [], loadingOptions: false, optionsError: null }];
    });
    setActiveId(id);
    setDrawing(false);
  }

  async function variations(l) {
    patchLine(l.id, { loadingOptions: true, optionsError: null });
    try {
      const { variations: v } = await aiApi.generateHeadlineVariations({ originalHeadline: l.original, purpose: '', briefNote: l.direction });
      patchLine(l.id, { options: v || [], loadingOptions: false });
    } catch (err) {
      patchLine(l.id, { loadingOptions: false, optionsError: apiErrorInfo(err) });
    }
  }

  /* ---------------- generate ---------------- */
  async function generate() {
    setError(null);
    setStep(3);
    setGenerating(true);
    setResult(null);
    setRecap(changed.map((l) => `${l.label} → ${l.action === 'remove' ? 'removed' : `changed to “${l.text.trim()}”`}`).concat(`Size → ${sizeSummary(size, origDims)}`));
    try {
      let id = postId;
      if (!id) {
        const { post: created } = await postsApi.create({ creativeType: 'headline', purpose: 'Headline edit', mediums: ['instagram_feed'], briefNote: '', selectedAssets: [], exactAssetIds: [], creativeBrief: {} });
        id = created._id;
        setPostId(id);
      }
      const edits = lines.map((l) => ({ id: l.id, label: l.label, original: l.original, action: l.action, text: l.action === 'change' ? l.text : '', where: l.box ? describeBox(l.box) : l.position }));
      const { post: updated, meta } = await postsApi.editHeadline(id, file, edits, sizePxOf(size));
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
      await downloadFile(resolveAssetUrl(selectedDesign.imageUrl), `${baseName}-headline-switch.${ext}`);
    } catch {
      setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' });
    } finally {
      setDownloading(false);
    }
  }

  const stageBoxes = lines.map((l) => ({ id: l.id, box: l.box, selected: l.action !== 'keep', label: `${l.label}: ${l.original || 'new text'}` }));
  const hint = canGenerate ? 'Next, choose the size you need.' : incomplete.length ? 'Type the new text for each line you’re changing.' : 'Change the text of, or remove, at least one line.';

  return (
    <Layout rail pageClass={step === 3 ? 'page-result page-headline-switch-download' : ''} flowBar={<FlowStepBar icon={iconTool} name="Headline Switch" steps={STEPS} step={step} reachable={reachable} onStep={setStep} />}>
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
            <h2 className="sa-heading">Change your headline</h2>
            <p>Upload the creative whose headline you want to update.</p>
            <p>We’ll find the headline and sub-headline. For each, you choose to keep, edit or remove it. Everything else stays as it is.</p>
            {!file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => fileInputRef.current?.click()}><span>Upload creative</span><img src={iconUpload} alt="" /></button>}
            {file && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => setStep(1)}><span>Continue</span><img src={iconArrowWhite} alt="" /></button>}
            {uploadError && <p className="fx-err" role="alert">{uploadError}</p>}
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 02 Find headline ---------------- */}
      {step === 1 && file && (
        <Rail>
          <RailStage>
              <ImageStage
                src={previewUrl} alt="Your creative with the detected text lines outlined" boxes={stageBoxes} activeId={activeId}
                scanning={scanning} scanText={SCAN_MESSAGES[scanMsg]} drawing={drawing} minH={0.02}
                tip="Draw a rectangle to show where you would like to add the new text"
                onSelect={setActiveId} onDraw={addDrawn}
              />
            <p className="rail__stage-count" aria-live="polite">{scanning ? 'Analyzing your creative…' : hint}</p>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">02 / Review</p>
            <h2 className="sa-heading">What would you like to do with the headline?</h2>
            <p>We found the text below. Keep it, edit it or remove it. If we missed a line, add it by drawing a box on the image.</p>
            {scanning && <div className="fx-list" aria-hidden="true"><div className="fx-skel fx-skel-row" /><div className="fx-skel fx-skel-row" /></div>}
            {!scanning && (
              <div className="fx-list">
                {lines.map((l, i) => (
                  <div key={l.id} className={`fx-item fx-item--line ${l.id === activeId ? 'is-active' : ''}`.trim()} onFocus={() => setActiveId(l.id)}>
                    <div className="fx-item__body" style={{ gap: 10 }}>
                      <div className="fx-item__top">
                        <span className="fx-item__num">{String(i + 1).padStart(2, '0')}</span>
                        <p className="fx-item__role">{l.label}</p>
                        <button type="button" className="fx-item__remove" aria-label={`Remove ${l.label} from the list`} onClick={() => removeLine(l.id)}>×</button>
                      </div>
                      {!l.user && (
                        <>
                          <p className="fx-cur">Currently reads: “{l.original}”</p>
                          <div className="fx-pills" role="radiogroup" aria-label={`What to do with the ${l.label.toLowerCase()}`}>
                            {ACTIONS.map(([a, label], ai) => (
                              <button
                                key={a} type="button" role="radio" aria-checked={l.action === a} tabIndex={l.action === a ? 0 : -1}
                                className={`fx-pill ${l.action === a ? 'is-on' : ''}`.trim()}
                                onClick={() => { setActiveId(l.id); patchLine(l.id, { action: a }); }}
                                onKeyDown={(e) => {
                                  const d = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 0;
                                  if (!d) return;
                                  e.preventDefault();
                                  const sib = e.currentTarget.parentElement.children[(ai + d + ACTIONS.length) % ACTIONS.length];
                                  sib.click(); sib.focus();
                                }}
                              >{label}</button>
                            ))}
                          </div>
                        </>
                      )}
                      <textarea
                        className={`fx-field ${l.action === 'remove' ? 'is-struck' : ''}`.trim()} rows={2} maxLength={240}
                        placeholder={l.user ? 'Type the text to add' : `Type the new ${l.label.toLowerCase()}`}
                        aria-label={l.action === 'change' ? `New ${l.label.toLowerCase()}` : `Original ${l.label.toLowerCase()}`}
                        value={l.action === 'change' ? l.text : l.original}
                        disabled={l.action !== 'change'}
                        onChange={(e) => patchLine(l.id, { text: e.target.value })}
                      />
                      {l.action === 'keep' && <p className="fx-hint">This line stays exactly as it is.</p>}
                      {l.action === 'remove' && <p className="fx-hint">This line will be taken off the image and the background filled in behind it.</p>}
                      {l.action === 'change' && !l.user && <p className="fx-hint">The old text is taken off the image and your new text is placed in the same spot.</p>}
                      {l.action === 'change' && !l.user && (
                        <>
                          <div className="fx-row">
                            <input className="fx-field" style={{ flex: 1, minWidth: 160, width: 'auto' }} type="text" maxLength={200} value={l.direction} placeholder="Optional: direction for the AI, e.g. festive, shorter" onChange={(e) => patchLine(l.id, { direction: e.target.value })} />
                            <button type="button" className="sa-btn sa-btn--white sa-btn--sm" disabled={l.loadingOptions} onClick={() => variations(l)}>
                              <img src={iconSparkle} alt="" className="sa-btn__sm" /><span>{l.loadingOptions ? 'Thinking…' : l.options.length ? 'More variations' : 'AI variations'}</span>
                            </button>
                          </div>
                          <AiErrorNotice error={l.optionsError} />
                          {l.options.length > 0 && (
                            <div className="fx-ideas">
                              {l.options.map((o) => <button key={o} type="button" className="fx-idea" onClick={() => patchLine(l.id, { text: o })}>{o}</button>)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {!lines.length && <p className="sa-note">{scanNote ? `${scanNote} ` : ''}No text yet - use “Add new text” to place some on the creative.</p>}
              </div>
            )}
            {!scanning && lines.length > 0 && !lines.some((x) => x.box) && <p className="sa-note">We couldn’t outline these on the image automatically. Use “Add new text” to mark the area yourself.</p>}
            <button type="button" className={`sa-btn sa-btn--outline ${drawing ? 'is-on' : ''}`.trim()} disabled={scanning} onClick={() => setDrawing((d) => !d)}>
              <span>{drawing ? 'Cancel drawing' : 'Add new text'}</span><img src={iconPlus} alt="" />
            </button>
            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={scanning || !canGenerate} onClick={() => setStep(2)}>
              <span>Continue</span><img src={iconArrowWhite} alt="" />
            </button>
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 03 Choose size ---------------- */}
      {step === 2 && (
        <ChooseSizePanel
          kicker="03 / Choose size"
          previewUrl={previewUrl}
          size={size}
          onSize={setSize}
          originalDims={origDims}
          costs={costs}
          hint={`${changed.length} text change${changed.length === 1 ? '' : 's'} will be applied.`}
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
                  title="" url={resultUrl} alt="Your creative with the headline changes applied" downloadName="the edited creative"
                  working={generating} workingLabel="Applying…" downloading={downloading} onDownload={download}
                  onPreview={() => openLightbox({ src: selectedDesign.imageUrl, title: 'Your creative', downloadName: `${baseName}-headline-switch.png` })}
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
                  : <p>{generating ? 'Generating your creative. This can take a minute - everything else stays untouched.' : 'Your headline changes have been applied. Preview the result, then download it.'}</p>}
                <div className="fx-list">{recap.map((r) => <p className="fx-recap" key={r}>{r}</p>)}</div>
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!resultUrl || generating || downloading} onClick={download}>
                  <span>Download</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
                </button>
                <div className="sa-links">
                  <button type="button" className="sa-link" onClick={() => setStep(1)}>← Change the text</button>
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
