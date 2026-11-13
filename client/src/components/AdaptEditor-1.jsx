import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import AnalyzingIndicator from './AnalyzingIndicator.jsx';
import { AiErrorNotice, CostTag } from './ui.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi, aiApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';
import { POST_FORMATS, ADAPT_ONLY_FORMATS, ADAPT_PLATFORM_ORDER, getFormat } from '../constants/postFormats.js';

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
// Still-image placements only (video / carousel need a motion brief or several slides), plus the adapt-only
// placements: website banners, Google Display, email, print, outdoor, Amazon, Flipkart...
const PORT_FORMATS = [...POST_FORMATS.filter((f) => !f.isVideo && !f.isCarousel), ...ADAPT_ONLY_FORMATS];
const PORT_PLATFORMS = [...new Set(PORT_FORMATS.map((f) => f.platform))].sort((a, b) => {
  const ia = ADAPT_PLATFORM_ORDER.indexOf(a);
  const ib = ADAPT_PLATFORM_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});
const formatsOf = (platform) => PORT_FORMATS.filter((f) => f.platform === platform);
const sizeText = (f) => (f.px ? `${f.px.replace('x', ' × ')} px` : f.ratio);
const MAX_SIZES = 8;
const POLL_MS = 3000;
const STALE_MS = 10 * 60 * 1000; // matches the server: a size pending this long was lost
const STEPS = [['01', 'Upload'], ['02', 'Select Size'], ['03', 'Download']];

const newRow = (platform = PORT_PLATFORMS[0], used = []) => {
  const list = formatsOf(platform);
  const f = list.find((x) => !used.includes(x.id)) || list[0];
  return { platform, formatId: f?.id || '' };
};

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

  useEffect(() => { aiApi.getCostEstimates().then(setCosts).catch(() => setCosts(null)); }, []);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  // The creative on the server (also what a returning visit shows when nothing was re-uploaded).
  const selected = post?.creativeType === 'resize' ? post.designs?.find((d) => d.label === post.selectedVariantLabel) || post.designs?.[0] : null;
  const serverUrl = selected?.imageUrl ? resolveAssetUrl(selected.imageUrl) : '';
  const creativeUrl = previewUrl || serverUrl;
  const ready = Boolean(serverUrl) && !uploading;
  const variants = selected?.formatVariants || [];
  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');

  async function handleFile(e) {
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
    } catch (err) {
      setError(apiErrorInfo(err));
      setFile(null);
      setPreviewUrl('');
    } finally {
      setUploading(false);
    }
  }

  /* ---------- 02 Select size ---------- */
  const usedIds = rows.map((r) => r.formatId);
  function updateRow(i, patch) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function changePlatform(i, platform) {
    updateRow(i, { platform, formatId: formatsOf(platform)[0]?.id || '' });
  }
  function addRow() {
    if (rows.length >= MAX_SIZES) return;
    // next platform/format not already picked
    for (const p of PORT_PLATFORMS) {
      const f = formatsOf(p).find((x) => !usedIds.includes(x.id));
      if (f) { setRows((rs) => [...rs, { platform: p, formatId: f.id }]); return; }
    }
  }
  function removeRow(i) { setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)); }

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
    const ids = [...new Set(rows.map((r) => r.formatId).filter(Boolean))];
    setChosenIds(ids);
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

  async function download(key, url, name) {
    setDownloadingKey(key);
    try { await downloadFile(resolveAssetUrl(url), name); }
    catch { setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' }); }
    finally { setDownloadingKey(null); }
  }
  async function downloadAll() {
    for (const id of chosenIds) {
      const v = variants.find((x) => x.formatId === id && x.imageUrl);
      if (v) { await download(id, v.imageUrl, `${baseName}-${id}.png`); await new Promise((r) => setTimeout(r, 350)); }
    }
  }
  const readyCount = chosenIds.filter((id) => readyUrl(id)).length;
  const busy = pendingNow || submitting;

  function openPreview(v, f) {
    openLightbox({ src: v.imageUrl, formatId: v.formatId, title: `${f.platform} ${f.label} (${sizeText(f)})`, downloadName: `${baseName}-${v.formatId}.png` });
  }

  const reachable = [true, ready, ready && chosenIds.length > 0];

  return (
    <Layout
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onBack}
            title="Back to Generate Media"
            style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--line)', textUnderlineOffset: 5 }}
          >
            Generate Media
          </button>
          <span aria-hidden="true" style={{ color: 'var(--muted)', fontWeight: 400 }}>&rsaquo;</span>
          <span style={{ color: 'var(--blue)' }}>Size Adapt</span>
        </span>
      }
    >
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />

      <div className="sa-stepbar">
        <div className="sa-stepbar__tool"><img src={iconResize} alt="" /><span>Size Adapt</span></div>
        <ol className="sa-steps">
          {STEPS.map(([num, label], i) => (
            <React.Fragment key={num}>
              {i > 0 && <li className="sa-step__line" aria-hidden="true" />}
              <li>
                <button
                  type="button"
                  className={`sa-step ${step === i ? 'is-active' : ''} ${step > i ? 'is-done' : ''}`.trim()}
                  aria-current={step === i ? 'step' : undefined}
                  disabled={!reachable[i] || step === i}
                  onClick={() => setStep(i)}
                >
                  <span className="sa-step__dot">{num}</span>
                  <span className="sa-step__label">{label}</span>
                </button>
              </li>
            </React.Fragment>
          ))}
        </ol>
      </div>

      <AiErrorNotice error={error} />

      {/* ---------------- 01 Upload ---------------- */}
      {step === 0 && (
        <div className="sa-panel">
          <div className="sa-text">
            <p className="sa-kicker">01 / Upload</p>
            <h2 className="sa-heading">Start adapting</h2>
            <p>Upload any creative that you are happy with but now need it in another size.</p>
            <p>It won’t be altered - you choose the size you need, and boom! The same creative, same messaging, but resized.</p>
          </div>
          <div
            className="sa-drop"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('is-dragover'); }}
            onDragLeave={(e) => e.currentTarget.classList.remove('is-dragover')}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('is-dragover');
              const f = e.dataTransfer?.files?.[0];
              if (f) handleFile({ target: { files: [f], value: '' } });
            }}
          >
            <div className="sa-drop__head">
              <p>{uploading ? 'Getting your creative ready…' : creativeUrl ? 'Click next to select preferred size.' : 'Click upload to select a file (PNG, JPG or WebP).'}</p>
              {!creativeUrl && <button type="button" className="sa-btn sa-btn--primary" onClick={() => fileInputRef.current?.click()}><span>Upload</span><img src={iconUpload} alt="" /></button>}
              {creativeUrl && <button type="button" className="sa-btn sa-btn--primary" disabled={!ready} onClick={() => setStep(1)}><span>Select size</span><img src={iconArrowWhite} alt="" /></button>}
            </div>
            <div className={`sa-preview ${creativeUrl ? 'sa-preview--filled' : 'sa-preview--empty'}`.trim()}>
              {creativeUrl && <img src={creativeUrl} alt="Your uploaded creative" />}
              {uploading && <div className="sa-preview__busy"><AnalyzingIndicator label="Getting your creative ready…" /></div>}
              {creativeUrl && !uploading && (
                <button type="button" className="sa-btn sa-btn--white sa-btn--sm sa-preview__action" onClick={() => fileInputRef.current?.click()}>
                  <span>Reupload</span><img className="sa-icon-swap" src={iconSwap} alt="" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 02 Select size ---------------- */}
      {step === 1 && (
        <div className="sa-panel">
          <div className="sa-text">
            <p className="sa-kicker">02 / Select Size</p>
            <h2 className="sa-heading">Which size(s) do you need the creative in?</h2>
            <p>Adapt this creative for another platform or size. The same artwork and text are re-framed to the new shape, and you can download each one individually or all of them together.</p>
            <p className="sa-note">Pick up to {MAX_SIZES} sizes. They are made together, a few at a time.</p>
            <div className="sa-stack">
              {rows.map((r, i) => (
                <div className="sa-group" key={i}>
                  <select className="sa-select" aria-label={`Platform ${i + 1}`} value={r.platform} onChange={(e) => changePlatform(i, e.target.value)}>
                    {PORT_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <select className="sa-select" aria-label={`Format ${i + 1}`} value={r.formatId} onChange={(e) => updateRow(i, { formatId: e.target.value })}>
                    {formatsOf(r.platform).map((f) => <option key={f.id} value={f.id}>{f.label} ({sizeText(f)})</option>)}
                  </select>
                  {rows.length > 1 && <button type="button" className="sa-group__remove" onClick={() => removeRow(i)} aria-label={`Remove size ${i + 1}`}>×</button>}
                </div>
              ))}
            </div>
            {rows.length < MAX_SIZES && (
              <button type="button" className="sa-btn sa-btn--outline" onClick={addRow}><span>Add another size</span><img src={iconPlus} alt="" /></button>
            )}
          </div>
          <div className="sa-drop">
            <div className="sa-drop__head">
              <p>{rows.length} size{rows.length === 1 ? '' : 's'} selected. Each one is a separate AI image. <CostTag estimate={costs?.imageHigh} /></p>
              <button type="button" className="sa-btn sa-btn--primary" onClick={generate}>
                <img src={iconSparkleWhite} alt="" className="sa-btn__sm" /><span>Generate</span><img src={iconArrowWhite} alt="" />
              </button>
            </div>
            <div className="sa-preview sa-preview--filled"><img src={creativeUrl} alt="Your uploaded creative" /></div>
          </div>
        </div>
      )}

      {/* ---------------- 03 Download ---------------- */}
      {step === 2 && (
        <div className="sa-panel">
          <div className="sa-text">
            <p className="sa-kicker">03 / Download</p>
            <h2 className="sa-heading">{busy ? 'Adapting…' : readyCount < chosenIds.length ? 'Almost there' : 'Here you go!'}</h2>
            <p>{busy ? `${readyCount} of ${chosenIds.length} ready. Sizes are made a few at a time, so this can take a minute or two - you can leave this page and they will keep going.` : readyCount < chosenIds.length ? `${readyCount} of ${chosenIds.length} are ready. Use Try again on the ones that could not be made.` : 'The adaptations are now ready! Feel free to preview them and download at your convenience.'}</p>
            <button type="button" className="sa-btn sa-btn--primary" disabled={readyCount === 0 || busy || Boolean(downloadingKey)} onClick={downloadAll}>
              <span>Download all</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
            </button>
            <div className="sa-links">
              <button type="button" className="sa-link" onClick={() => setStep(1)}>+ Adapt more sizes</button>
              <button type="button" className="sa-link" onClick={() => navigate('/modify')}>Fine tune the original →</button>
            </div>
          </div>
          <div className="sa-tiles">
            {chosenIds.map((id) => {
              const f = getFormat(id);
              const v = variants.find((x) => x.formatId === id);
              const working = isPending(v) || (submitting && !v?.imageUrl);
              const waiting = false;
              return (
                <div className="sa-tile" key={id}>
                  <p className="sa-tile__title">{f.platform} / {f.label}</p>
                  <div className="sa-tile__img">
                    {(working || waiting) && (
                      <div className="sa-tile__state">
                        {working ? <AnalyzingIndicator label="Adapting…" size={48} /> : <span>Waiting…</span>}
                      </div>
                    )}
                    {!working && !waiting && v?.imageUrl && (
                      <>
                        <img src={resolveAssetUrl(v.imageUrl)} alt={`${f.platform} ${f.label}`} />
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
                        <span>{v?.imageNote || (v?.status === 'pending' ? 'This took too long - try again.' : 'Could not be generated.')}</span>
                        <button type="button" className="sa-btn sa-btn--white sa-btn--sm" onClick={() => redo(id)}><span>Try again</span></button>
                      </div>
                    )}
                  </div>
                  <p className="sa-tile__size">{sizeText(f)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Layout>
  );
}
