import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import BloomLoader from './BloomLoader.jsx';
import { AiErrorNotice, CostTag } from './ui.jsx';
import { FlowStepBar, GenerationError } from './flow/FlowParts.jsx';
import NextStepCards from './flow/NextStepCards.jsx';
import { Rail, RailStage, RailPanel, RailBottom } from './flow/Rail.jsx';
import SizePicker from './flow/SizePicker.jsx';
import CropPreview from './flow/CropPreview.jsx';
import { useLeaveGuard } from './LeaveGuard.jsx';
import { takeHandoffFile } from '../utils/handoff.js';
import '../styles/flow-quickfix.css';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';
import { getFormat, formatPx, billboardPresetId } from '../constants/postFormats.js';
import BillboardExportDialog from './BillboardExportDialog.jsx';
import '../styles/rail-edit-adapt.css';

import iconResize from '../assets/size-adapt/resize.svg';
import iconUpload from '../assets/size-adapt/icon-upload.svg';
import iconSwap from '../assets/size-adapt/icon-swap.svg';
import iconPlus from '../assets/size-adapt/icon-plus.svg';
import iconEye from '../assets/size-adapt/icon-eye.svg';
import iconDownTile from '../assets/size-adapt/icon-download-tile.svg';
import iconDownWhite from '../assets/size-adapt/icon-download-white.svg';
import iconArrowWhite from '../assets/size-adapt/icon-arrow-right-white.svg';
import iconSparkleWhite from '../assets/size-adapt/icon-sparkle-white.svg';

// Size Adapt: Upload -> Select Size -> Download.
// The creative itself is never edited. All chosen sizes go to the server in ONE request (postsApi.adaptSizes);
// it makes a few at a time in the background and saves each as it finishes, so this page just polls the post.
// Still-image placements only (video / carousel need a motion brief or several slides). The platform and size
// lists come from the one shared size list (SizePicker): social, Google Display, email and web, print, outdoor,
// stationery and Custom (the person types a width and height in pixels).
const sizeText = (f) => (f.px ? `${f.px.replace('x', ' × ')} px` : f.ratio);
const MAX_SIZES = 8;
const POLL_MS = 3000;
const STALE_MS = 10 * 60 * 1000; // matches the server: a size pending this long was lost
const STEPS = [['01', 'Upload'], ['02', 'Choose size'], ['03', 'Download']];
const XICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

// A row is one platform + size chosen in the SizePicker; formatId stays '' until a complete size is chosen
// (e.g. a Custom width and height that are not both filled in yet).
const newRow = () => ({ platform: '', formatId: '' });

// Dotted outlines on the creative (shared CropPreview): each chosen size is the part of the picture that stays in frame.
function cropFrames(formatIds) {
  return [...new Set(formatIds)].map((id) => {
    const px = formatPx(id);
    if (!px?.w || !px?.h) return null;
    const f = getFormat(id);
    return { key: id, ar: px.w / px.h, text: f.custom ? `Custom ${px.w} × ${px.h}` : `${f.label} · ${px.w} × ${px.h}` };
  }).filter(Boolean);
}

export default function AdaptEditor({ onBack }) {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  const { open: openLightbox } = useLightbox();
  const fileInputRef = useRef(null);

  const hasServerCreative = post?.creativeType === 'resize' && post.designs?.some((d) => d.imageUrl);
  const isPending = (v) => v?.status === 'pending' && (!v.startedAt || Date.now() - new Date(v.startedAt).getTime() < STALE_MS);
  // Coming back while sizes are still being made (or just finished): go straight to the Download step.
  const resumeVariants = hasServerCreative ? (post.designs.find((d) => d.label === post.selectedVariantLabel) || post.designs[0])?.formatVariants || [] : [];
  const resumeDownload = resumeVariants.some(isPending);
  const [step, setStep] = useState(resumeDownload ? 2 : hasServerCreative ? 1 : 0); // 0 upload, 1 select size, 2 download
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [costs, setCosts] = useState(null);
  // Re-used when the creative is replaced so no duplicate posts are left behind.
  const [postId, setPostId] = useState(() => (post?.creativeType === 'resize' ? post._id : null));
  const [rows, setRows] = useState(() => [newRow()]);
  const [chosenIds, setChosenIds] = useState(() => (resumeDownload ? resumeVariants.map((v) => v.formatId) : [])); // sizes requested on step 03
  const [submitting, setSubmitting] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [pickedId, setPickedId] = useState(null); // the adaptation chosen to convert to video

  useEffect(() => { aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null)); }, []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  // The creative on the server (also what a returning visit shows when nothing was re-uploaded).
  const selected = post?.creativeType === 'resize' ? post.designs?.find((d) => d.label === post.selectedVariantLabel) || post.designs?.[0] : null;
  const serverUrl = selected?.imageUrl ? resolveAssetUrl(selected.imageUrl) : '';
  const creativeUrl = previewUrl || serverUrl;
  const ready = Boolean(serverUrl) && !uploading;
  const variants = selected?.formatVariants || [];
  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');

  // Handed over from another flow ("Adapt now"): upload it exactly as if it had been picked, then go to Choose size.
  const handoffTried = useRef(false);
  useEffect(() => {
    if (handoffTried.current) return;
    handoffTried.current = true;
    takeHandoffFile('resize').then((f) => { if (f) handleFile({ target: { files: [f], value: '' } }, true); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(e, advance = false) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(picked.type)) {
      setError({ message: 'Please choose an image file (PNG, JPG or WebP).' });
      return;
    }
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
    setError(null);
    setChosenIds([]);
    setPickedId(null);
    setUploading(true);
    try {
      let id = postId;
      if (!id) {
        const { post: created } = await postsApi.create({
          creativeType: 'resize', purpose: 'Size adaptation', mediums: ['instagram_feed'],
          briefNote: '', selectedAssets: [], exactAssetIds: [], creativeBrief: {}
        });
        id = created._id;
        setPostId(id);
      }
      const { post: updated } = await postsApi.adaptSource(id, picked);
      setPost(updated);
      if (advance) setStep(1);
    } catch (err) {
      setError(apiErrorInfo(err));
      setFile(null);
      setPreviewUrl('');
    } finally {
      setUploading(false);
    }
  }

  /* ---------- 02 Select size ---------- */
  function updateRow(i, patch) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    if (rows.length >= MAX_SIZES) return;
    setRows((rs) => [...rs, newRow()]);
  }
  function removeRow(i) { setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)); }
  const chosenRowIds = [...new Set(rows.map((r) => r.formatId).filter(Boolean))];

  /* ---------- 03 Generate + download ---------- */
  const readyUrl = (id) => variants.find((x) => x.formatId === id && x.imageUrl);
  const pendingNow = chosenIds.some((id) => isPending(variants.find((x) => x.formatId === id)));

  // One request for every size that is not already made / being made; the server does the rest.
  async function requestSizes(ids) {
    if (!post?._id || ids.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { post: updated, skipped } = await postsApi.adaptSizes(post._id, post.selectedVariantLabel, { formatIds: ids });
      if (updated) setPost(updated);
      if (skipped?.length) setError({ message: `${skipped.length} size${skipped.length === 1 ? ' was' : 's were'} not made - this workspace has used its monthly image allowance.` });
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setSubmitting(false);
    }
  }

  function generate() {
    const ids = chosenRowIds;
    if (!ids.length) return;
    setChosenIds(ids);
    setPickedId(null);
    setStep(2);
    requestSizes(ids.filter((id) => !readyUrl(id) && !isPending(variants.find((x) => x.formatId === id))));
  }
  function redo(id) { requestSizes([id]); }

  // While any size is still being made, refresh the post every few seconds.
  useEffect(() => {
    if (step !== 2 || !pendingNow || !post?._id) return undefined;
    const t = setInterval(() => {
      postsApi.get(post._id).then(({ post: fresh }) => fresh && setPost(fresh)).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [step, pendingNow, post?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the allowance meter to refresh once the batch has finished.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pendingNow) window.dispatchEvent(new Event('automatr:allowance-refresh'));
    wasPending.current = pendingNow;
  }, [pendingNow]);

  const isBillboardId = (id) => Boolean(billboardPresetId(id));
  const [billboardDlg, setBillboardDlg] = useState(null); // billboard sizes open the Billboard print files dialog instead of saving the plain image
  async function download(key, url, name) {
    if (isBillboardId(key)) { setBillboardDlg({ src: url, title: name, formatId: key }); return; }
    setDownloadingKey(key);
    try { await downloadFile(resolveAssetUrl(url), name); }
    catch { setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' }); }
    finally { setDownloadingKey(null); }
  }
  async function downloadAll() {
    let firstBillboard = null;
    for (const id of chosenIds) {
      const v = variants.find((x) => x.formatId === id && x.imageUrl);
      if (!v) continue;
      if (isBillboardId(id)) { firstBillboard ||= { src: v.imageUrl, title: `${baseName}-${id}.png`, formatId: id }; continue; }
      await download(id, v.imageUrl, `${baseName}-${id}.png`);
      await new Promise((r) => setTimeout(r, 350));
    }
    // Billboard sizes are made one at a time in their own dialog (the others have been downloaded above).
    if (firstBillboard) setBillboardDlg(firstBillboard);
  }
  const readyCount = chosenIds.filter((id) => readyUrl(id)).length;
  const busy = pendingNow || submitting;

  function openPreview(v, f) {
    openLightbox({ src: v.imageUrl, formatId: v.formatId, title: `${f.platform} ${f.label} (${sizeText(f)})`, downloadName: `${baseName}-${v.formatId}.png` });
  }

  const reachable = [true, ready, ready && chosenIds.length > 0];
  // Nothing to protect on the first step, nor once the sizes are made and shown on the last one.
  useLeaveGuard(step > 0 && !(step === 2 && readyCount > 0 && !busy));
  const pickedVariant = pickedId ? readyUrl(pickedId) : null;
  const tileAr = (id) => { const px = formatPx(id); return px?.w && px?.h ? px.w / px.h : 1; };

  return (
    <Layout rail pageClass={step === 2 ? 'page-result page-size-adapt-download' : ''} flowBar={<FlowStepBar icon={iconResize} name="Size Adapt" steps={STEPS} step={step} reachable={reachable} onStep={setStep} />}>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />

      <AiErrorNotice error={error} />

      {/* ---------------- 01 Upload ---------------- */}
      {step === 0 && (
        <Rail>
          <RailStage
            id="dropzone"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('is-dragover')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('is-dragover');
              const f = e.dataTransfer?.files?.[0];
              if (f) handleFile({ target: { files: [f], value: '' } });
            }}
          >
            <div className={`sa-preview ${creativeUrl ? 'sa-preview--filled' : 'sa-preview--empty'} ${uploading ? 'sa-preview--loading' : ''}`.trim()}>
              {creativeUrl && <img src={creativeUrl} alt="Your uploaded creative" />}
              {uploading && <div className="sa-preview__busy"><BloomLoader bare label="Getting your creative ready" /></div>}
              {creativeUrl && !uploading && (
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-preview__action" onClick={() => fileInputRef.current?.click()}>
                  <span>Replace file</span><img className="sa-icon-swap" src={iconSwap} alt="" />
                </button>
              )}
            </div>
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">01 / Upload</p>
            <h2 className="sa-heading">Resize your creative</h2>
            <p>Upload a finished creative and we’ll adapt it to the sizes you need.<br />Your artwork and messaging stay the same. Only the size changes.</p>
            {!creativeUrl && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={() => fileInputRef.current?.click()}><span>Upload creative</span><img src={iconUpload} alt="" /></button>}
            {creativeUrl && <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!ready} onClick={() => setStep(1)}><span>Continue</span><img src={iconArrowWhite} alt="" /></button>}
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 02 Select size ---------------- */}
      {step === 1 && (
        <Rail>
          <RailStage>
            <CropPreview url={creativeUrl} frames={cropFrames(chosenRowIds)} alt="Your uploaded creative" />
          </RailStage>
          <RailPanel label="Settings">
            <p className="sa-kicker">02 / Choose size</p>
            <h2 className="sa-heading">Which sizes do you need?</h2>
            <p>Choose one or more sizes. Your artwork and text are re-framed to fit each one, and you can download them individually or together.</p>
            <p className="sa-note">Pick up to {MAX_SIZES} sizes. They are made together, a few at a time. <CostTag estimate={costs?.imageHigh} /></p>
            <div className="sa-stack">
              {rows.map((r, i) => (
                <div className="sa-group" key={i}>
                  {i > 0 && (
                    <div className="sa-group__head sa-group__head--end">
                      <button type="button" className="sa-group__remove sa-group__remove--solid" onClick={() => removeRow(i)} aria-label={`Remove size ${i + 1}`} title="Remove this size">{XICON}</button>
                    </div>
                  )}
                  <SizePicker
                    mode="image"
                    platform={r.platform}
                    formatId={r.formatId}
                    onChange={(sz) => updateRow(i, { platform: sz?.platform || '', formatId: sz?.formatId || '' })}
                  />
                </div>
              ))}
            </div>
            {rows.length < MAX_SIZES && (
              <button type="button" className="sa-btn sa-btn--outline" onClick={addRow}><span>Add another size</span><img src={iconPlus} alt="" /></button>
            )}
            <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={chosenRowIds.length === 0} onClick={generate}>
              <img src={iconSparkleWhite} alt="" className="sa-btn__sm" /><span>Generate</span><img src={iconArrowWhite} alt="" />
            </button>
          </RailPanel>
        </Rail>
      )}

      {/* ---------------- 03 Download ---------------- */}
      {step === 2 && (
        <Rail bottom>
          <RailStage scroll>
            <div className="rail__stage-inner">
              <div className="sa-tiles sa-tiles--bare sa-tiles--grid">
            {chosenIds.map((id) => {
              const f = getFormat(id);
              const v = variants.find((x) => x.formatId === id);
              const working = isPending(v) || (submitting && !v?.imageUrl);
              const waiting = false;
              return (
                <div className={`sa-tile ${pickedId === id ? 'is-picked' : ''}`.trim()} key={id} style={{ '--ar': tileAr(id) }}>
                  <p className="sa-tile__title" title={`${f.platform} / ${f.label} · ${sizeText(f)}`}>{f.platform} / {f.label} · {sizeText(f)}</p>
                  <div className={`sa-tile__img ${working ? 'is-bloom' : ''}`.trim()}>
                    {(working || waiting) && (
                      <div className="sa-tile__state">
                        {working ? <BloomLoader label="Adapting…" /> : <span>Waiting…</span>}
                      </div>
                    )}
                    {!working && !waiting && v?.imageUrl && (
                      <>
                        <img src={resolveAssetUrl(v.imageUrl)} alt={`${f.platform} ${f.label}`} />
                        <button type="button" className="sa-tile__pick" aria-pressed={pickedId === id} aria-label={`Select ${f.platform} ${f.label} to convert to video`} onClick={() => setPickedId(pickedId === id ? null : id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        </button>
                        <div className="sa-tile__actions">
                          <button type="button" className="sa-btn sa-btn--white sa-btn--tile" onClick={() => openPreview(v, f)}><img src={iconEye} alt="" /><span>Preview</span></button>
                          <span className="sa-tile__right">
                            <button type="button" className="sa-btn sa-btn--white sa-btn--tile" onClick={() => redo(id)} title="Adapt this size again"><span>Redo</span></button>
                            <button type="button" className="sa-btn sa-btn--primary sa-btn--tile" disabled={downloadingKey === id} aria-label={`Download ${f.platform} ${f.label}`} onClick={() => download(id, v.imageUrl, `${baseName}-${id}.png`)}>
                              <img className="sa-icon-down" src={iconDownTile} alt="" />
                            </button>
                          </span>
                        </div>
                      </>
                    )}
                    {!working && !waiting && !v?.imageUrl && (
                      <div className="sa-tile__state">
                        <GenerationError onRetry={() => redo(id)} text={/allowance/i.test(v?.imageNote || '') ? v.imageNote : undefined} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
              </div>
            </div>
          </RailStage>
          <RailBottom
            text={(
              <>
                <p className="sa-kicker">03 / Download</p>
                <p>{busy ? `Preparing your sizes. ${readyCount} of ${chosenIds.length} ready - they are made a few at a time, so this can take a minute or two. You can leave this page and they will keep going.` : readyCount < chosenIds.length ? `${readyCount} of ${chosenIds.length} are ready. Use Try again on the ones that could not be made.` : 'Preview each size, then download them individually or all at once.'}</p>
                <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={readyCount === 0 || busy || Boolean(downloadingKey)} onClick={downloadAll}>
                  <span>Download all</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
                </button>
                <div className="sa-links">
                  <button type="button" className="sa-link" onClick={() => setStep(1)}>+ Adapt more sizes</button>
                  <button type="button" className="sa-link" onClick={() => navigate('/modify')}>Fine tune the original →</button>
                </div>
              </>
            )}
            actions={<NextStepCards convert="select" imageUrl={pickedVariant?.imageUrl || ''} />}
          />
        </Rail>
      )}
      {billboardDlg && <BillboardExportDialog src={billboardDlg.src} title={billboardDlg.title} formatId={billboardDlg.formatId} onClose={() => setBillboardDlg(null)} />}
    </Layout>
  );
}
