import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BloomLoader from './BloomLoader.jsx';
import { Card, CardHead, Btn, CostTag } from './ui.jsx';
import { useWorkflow } from '../context/WorkflowContext.jsx';
import { useLightbox } from '../context/LightboxContext.jsx';
import { postsApi } from '../api/resources.js';
import { apiErrorInfo, resolveAssetUrl, downloadFile } from '../api/client.js';
import { POST_FORMATS, ADAPT_ONLY_FORMATS, ADAPT_PLATFORM_ORDER, getFormat } from '../constants/postFormats.js';

// Still-image placements only: video placements need a motion brief and carousels
// need several slides, neither of which exists for a single edited creative.
// Plus the adapt-only placements: website banners, Google Display sizes, email, print, outdoor...
const PORT_FORMATS = [...POST_FORMATS.filter((f) => !f.isVideo && !f.isCarousel), ...ADAPT_ONLY_FORMATS];
const PORT_PLATFORMS = [...new Set(PORT_FORMATS.map((f) => f.platform))].sort((a, b) => {
  const ia = ADAPT_PLATFORM_ORDER.indexOf(a);
  const ib = ADAPT_PLATFORM_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});
const sizeText = (f) => (f.px ? `${f.px.replace('x', ' × ')} px` : f.ratio);

/**
 * The "finished" half of the single-element edit modes (Edit Headline Only,
 * Change Hero Image Only): the edited creative at its original size, Download,
 * Fine tune / Adapt Creative buttons, and "Adapt Creative" with a download for
 * each. Reads the edited image from the post in WorkflowContext.
 *
 * Props: result { width, height } (shown only once an edit exists), file (the
 * uploaded original, used to name downloads), fileTag, changedWhat (e.g.
 * "the text you changed"), stepNumber, costs, setError, panelRef.
 */
export default function EditResultPanel({ result, file, fileTag, changedWhat, title = 'Your edited creative', intro, stepNumber = '3', costs, setError, panelRef, portOnly = false }) {
  const navigate = useNavigate();
  const { post, setPost } = useWorkflow();
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [portPlatform, setPortPlatform] = useState(PORT_PLATFORMS[0]);
  const [portFormatId, setPortFormatId] = useState(PORT_FORMATS.find((f) => f.platform === PORT_PLATFORMS[0])?.id || '');
  const [portingFormatId, setPortingFormatId] = useState(null);
  const portRef = useRef(null);
  const [preview, setPreview] = useState(null); // legacy modal (unused: previews now open the shared lightbox, which has Show on destination)
  const { open: openLightbox } = useLightbox();

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => e.key === 'Escape' && setPreview(null);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [preview]);

  const selected = ['headline', 'hero', 'resize'].includes(post?.creativeType) ? post.designs?.find((d) => d.label === post.selectedVariantLabel) || post.designs?.[0] : null;
  const editedUrl = result && selected?.imageUrl ? resolveAssetUrl(selected.imageUrl) : '';
  if (!result || !editedUrl) return null;

  const baseName = (file?.name || 'creative').replace(/\.[^.]+$/, '');
  const formatVariants = selected?.formatVariants || [];
  const portOptions = PORT_FORMATS.filter((f) => f.platform === portPlatform);

  function handlePortPlatform(platform) {
    setPortPlatform(platform);
    setPortFormatId(PORT_FORMATS.find((f) => f.platform === platform)?.id || '');
  }

  async function handleDownload(key, url, filename) {
    setDownloadingKey(key);
    setError(null);
    try {
      await downloadFile(resolveAssetUrl(url), filename);
    } catch (err) {
      setError({ message: 'Could not download the image. Try opening it in a new tab and saving it from there instead.' });
    } finally {
      setDownloadingKey(null);
    }
  }

  async function handlePort(formatId) {
    const target = formatId || portFormatId;
    if (!target || !post?._id) return;
    setPortingFormatId(target);
    setError(null);
    try {
      const { post: updated } = await postsApi.portFormats(post._id, post.selectedVariantLabel, { formatIds: [target] });
      setPost(updated);
    } catch (err) {
      setError(apiErrorInfo(err));
    } finally {
      setPortingFormatId(null);
    }
  }

  return (
      <div ref={panelRef} style={{ marginTop: 18, scrollMarginTop: 16 }}>
        {!portOnly && (
        <Card>
          <CardHead title={`${stepNumber} · ${title}`} tag={result.width && result.height ? `${result.width} × ${result.height} px` : undefined} />
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <img src={editedUrl} alt={title} style={{ width: '100%', maxHeight: 560, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--line)' }} />
            <div>
              <p className="hint" style={{ marginTop: 0 }}>
                {intro || (
                  <>
                    Only {changedWhat} is different. The artwork keeps its original size
                    {result.width && result.height ? ` (${result.width} × ${result.height} px)` : ''}.
                  </>
                )}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <Btn
                  variant="primary"
                  loading={downloadingKey === 'master'}
                  onClick={() => handleDownload('master', selected.imageUrl, `${baseName}-${fileTag}.${(/\.(png|jpe?g|webp)(\?|$)/i.exec(selected.imageUrl)?.[1] || 'png').toLowerCase()}`)}
                >
                  ⬇ Download
                </Btn>
                <Btn variant="secondary" onClick={() => navigate('/modify')}>Fine tune →</Btn>
                <Btn variant="secondary" onClick={() => portRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Adapt Creative →</Btn>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Fine tune lets you touch up the image or write a caption. Nothing changes unless you choose it.
              </p>
            </div>
          </div>
        </Card>
        )}

        <Card style={{ marginTop: portOnly ? 0 : 18 }}>
          <div ref={portRef} style={{ scrollMarginTop: 16 }} />
          <CardHead title="Adapt Creative" tag="AI" />
          <p className="hint" style={{ marginBottom: 14 }}>
            Adapt this creative for another platform or size. The same artwork and text are re-framed to the new
            shape, and you can download each one. Pick as many as you need, one at a time.
          </p>
          <style>{`
            .adapt-select{font:inherit;font-size:15px;line-height:1.3;color:var(--ink,inherit);min-height:48px;padding:11px 14px;background-color:#fff;border:1px solid var(--line);border-radius:10px;cursor:pointer;outline:none;transition:border-color .15s,box-shadow .15s}
            .adapt-select:hover{border-color:#c9cfdb}
            .adapt-select:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(37,99,235,.14)}
            .adapt-select option{font-size:15px}
          `}</style>
          <div className="select-row" style={{ marginBottom: 16 }}>
            <select className="adapt-select" value={portPlatform} onChange={(e) => handlePortPlatform(e.target.value)}>
              {PORT_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select className="adapt-select" value={portFormatId} onChange={(e) => setPortFormatId(e.target.value)}>
              {portOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.label} ({sizeText(f)})</option>
              ))}
            </select>
            <Btn variant="secondary" loading={Boolean(portingFormatId)} disabled={!portFormatId} onClick={() => handlePort()}>
              ✦ Adapt to this size
            </Btn>
            <CostTag estimate={costs?.imageHigh} />
          </div>

          {formatVariants.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
              {formatVariants.map((v) => {
                const f = getFormat(v.formatId);
                const busy = portingFormatId === v.formatId;
                return (
                  <div key={v.formatId} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10 }}>
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13 }}>{f.platform} {f.label} <span className="hint">({sizeText(f)})</span></p>
                    {busy && <div style={{ position: 'relative', height: 180, borderRadius: 8, overflow: 'hidden' }}><BloomLoader label="Adapting…" /></div>}
                    {!busy && v.imageUrl && (
                      <>
                        <img
                          src={resolveAssetUrl(v.imageUrl)}
                          alt={`${f.platform} ${f.label}`}
                          onClick={() => openLightbox({ src: v.imageUrl, formatId: v.formatId, title: `${f.platform} ${f.label} (${sizeText(f)})`, downloadName: `${baseName}-${v.formatId}.png` })}
                          style={{ width: '100%', borderRadius: 8, display: 'block', cursor: 'zoom-in' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <Btn variant="secondary" onClick={() => openLightbox({ src: v.imageUrl, formatId: v.formatId, title: `${f.platform} ${f.label} (${sizeText(f)})`, downloadName: `${baseName}-${v.formatId}.png` })}>Preview</Btn>
                          <Btn
                            variant="secondary"
                            loading={downloadingKey === v.formatId}
                            onClick={() => handleDownload(v.formatId, v.imageUrl, `${baseName}-${v.formatId}.png`)}
                          >
                            ⬇ Download
                          </Btn>
                          <Btn variant="secondary" onClick={() => handlePort(v.formatId)} disabled={Boolean(portingFormatId)}>Redo</Btn>
                        </div>
                      </>
                    )}
                    {!busy && !v.imageUrl && (
                      <>
                        <p className="hint" style={{ margin: '0 0 8px' }}>{v.imageNote || 'Could not be generated.'}</p>
                        <Btn variant="secondary" onClick={() => handlePort(v.formatId)} disabled={Boolean(portingFormatId)}>Try again</Btn>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {preview && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={preview.title}
            onClick={() => setPreview(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,14,25,.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 16px 24px' }}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Close preview"
              style={{ position: 'absolute', top: 14, right: 16, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,.95)', color: '#111', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}
            >
              ×
            </button>
            <img
              src={preview.url}
              alt={preview.title}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 120px)', objectFit: 'contain', borderRadius: 8, background: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,.45)' }}
            />
            <p style={{ color: '#fff', fontSize: 13, margin: '12px 0 0' }}>{preview.title}</p>
          </div>
        )}
      </div>
    
  );
}
