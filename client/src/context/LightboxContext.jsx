import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toPng } from 'html-to-image';
import { resolveAssetUrl, downloadFile } from '../api/client.js';
import VideoDownloadMenu from '../components/VideoDownloadMenu.jsx';
import DestinationMockup from '../components/DestinationMockup.jsx';
import BillboardExportDialog from '../components/BillboardExportDialog.jsx';
import { billboardPresetId } from '../constants/postFormats.js';
import '../styles/video-flow.css';
import iconDownWhite from '../assets/video/icon-download-white.svg';

const LightboxContext = createContext(null);

/**
 * Global "click an image, see it big with info" viewer. Mounted once at
 * the app root (see App.jsx) so any page can call useLightbox().open(...)
 * without needing its own modal state or markup - Dashboard, All Posts,
 * Generate Designs, Refine Options, Modify Post, Publish, the admin AI
 * Usage gallery, and the stock photo search all share this one implementation.
 *
 * Two ways to open it:
 *   - Single image: open({ src, title, meta, alt })
 *   - A browsable set (prev/next arrows appear automatically): open({
 *       items: [{ src, title, meta, alt, data }], index: 0,
 *       cta: { label: 'Select Photo', onClick: (item, index) => {...} }
 *     })
 *     `cta.onClick` receives the *current* item/index at the moment it's
 *     clicked (i.e. after the user has paged through with prev/next), and
 *     `item.data` is whatever arbitrary object the caller attached (e.g.
 *     the original stock-photo search result), so the handler can act on
 *     it without needing to look anything up again.
 *
 *   - Any item may carry `video` (a video URL): the pop-up then plays it (controls, loop) instead of showing an image.
 *     `src` may still be given as the poster. Video items have no mockup.
 *   - Any item may carry `originalSrc` (the untouched source image; "Open original" opens it instead of the shown image).
 *   - Any item may carry `downloadName` (a file name): a Download button then appears in the info bar.
 *   - Any item may carry `formatId` (a post format id, e.g. 'instagram_feed' or 'gads_leaderboard'): a
 *     "Show on destination" button then draws the creative inside a mock of where it will run
 *     (phone feed, story, web page, email, display ad slot, print, hoarding, marketplace...).
 *     `caption` (optional) is used as the post text in those mocks.
 *
 * @typedef {{ src: string, alt?: string, title?: string, meta?: Array<{label: string, value: string}>, data?: any, downloadName?: string }} LightboxItem
 */
export function LightboxProvider({ children }) {
  const [payload, setPayload] = useState(null);
  const [index, setIndex] = useState(0);

  const items = useMemo(() => {
    if (!payload) return [];
    if (payload.items) return payload.items;
    // Single-image shorthand - wrap it as a one-item set so the rest of
    // the component doesn't need two code paths.
    return [{ src: payload.src, alt: payload.alt, title: payload.title, meta: payload.meta, downloadName: payload.downloadName, originalSrc: payload.originalSrc, formatId: payload.formatId, caption: payload.caption, video: payload.video }];
  }, [payload]);

  const open = useCallback((p) => {
    setPayload(p);
    setIndex(p.index || 0);
  }, []);
  const close = useCallback(() => setPayload(null), []);

  const goNext = useCallback(() => setIndex((i) => (i + 1) % items.length), [items.length]);
  const goPrev = useCallback(() => setIndex((i) => (i - 1 + items.length) % items.length), [items.length]);

  useEffect(() => {
    if (!payload) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && items.length > 1) goNext();
      else if (e.key === 'ArrowLeft' && items.length > 1) goPrev();
    }
    document.addEventListener('keydown', onKeyDown);
    // Prevent the page behind the lightbox from scrolling while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [payload, close, goNext, goPrev, items.length]);

  return (
    <LightboxContext.Provider value={{ open, close }}>
      {children}
      {payload && (
        <Lightbox
          item={items[index]}
          index={index}
          total={items.length}
          cta={payload.cta}
          onNext={goNext}
          onPrev={goPrev}
          onClose={close}
        />
      )}
    </LightboxContext.Provider>
  );
}

export function useLightbox() {
  const ctx = useContext(LightboxContext);
  if (!ctx) throw new Error('useLightbox() must be used within a LightboxProvider.');
  return ctx;
}

function Lightbox({ item, index, total, cta, onNext, onPrev, onClose }) {
  const { src, alt, title, meta: rawMeta = [], downloadName, originalSrc, formatId, caption, video } = item;
  // Platform / Size / Purpose are not shown in the preview.
  const HIDDEN_META = ['platform', 'size', 'purpose'];
  const meta = (rawMeta || []).filter((m) => !HIDDEN_META.includes(String(m.label || '').toLowerCase()));
  const [mock, setMock] = useState(false);
  useEffect(() => setMock(false), [src, formatId]);
  const fullSrc = resolveAssetUrl(video || src);
  const posterSrc = video && src ? resolveAssetUrl(src) : undefined;
  const canMock = Boolean(formatId) && !video;
  const [ctaLoading, setCtaLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [billboardOpen, setBillboardOpen] = useState(false);
  // Billboard-size creatives: Download opens the Billboard print files dialog instead of saving the plain image.
  const isBillboard = Boolean(billboardPresetId(formatId));
  const billboardSrc = isBillboard && !video && downloadName && /^(\/uploads\/|https?:\/\/[^/]+\/uploads\/)/.test(String(originalSrc || src || '')) ? String(originalSrc || src) : '';

  async function handleDownload() {
    setDownloading(true);
    setDownloadError('');
    try {
      if (mock && canMock) {
        // The mockup is drawn live in the page, so it is captured as a picture of what is on screen.
        const stage = document.querySelector('.lightbox-body .dm-stage');
        if (!stage) throw new Error('mockup not on screen');
        const child = stage.children.length === 1 ? stage.children[0] : null;
        const w = child ? Math.ceil(child.getBoundingClientRect().width) + 120 : stage.scrollWidth;
        const h = child ? Math.ceil(child.getBoundingClientRect().height) + 90 : stage.scrollHeight;
        const dataUrl = await toPng(stage, {
          pixelRatio: 2,
          backgroundColor: '#f2f4f7',
          width: w,
          height: h,
          style: { width: `${w}px`, height: `${h}px`, padding: '40px 60px 50px', alignItems: 'center' }
        });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${String(downloadName || 'creative').replace(/\.[a-z0-9]+$/i, '')}-mockup.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        await downloadFile(fullSrc, downloadName);
      }
    } catch {
      setDownloadError(mock && canMock ? 'Could not download the mockup. Try again, or switch back to the creative and download that.' : 'Could not download. Use "View in full size" and save it from there.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleCtaClick() {
    if (!cta?.onClick) return;
    setCtaLoading(true);
    try {
      await cta.onClick(item, index);
    } finally {
      setCtaLoading(false);
    }
  }

  return (
    <div className="lightbox-overlay" role="dialog" aria-modal="true" aria-label="Preview" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>

      {total > 1 && (
        <button className="lightbox-nav lightbox-nav--prev" onClick={onPrev} aria-label="Previous image">‹</button>
      )}

      <div className="lightbox-body">
        {mock && canMock ? (
          <DestinationMockup formatId={formatId} src={src} caption={caption || title} />
        ) : video ? (
          <div className="lightbox-image-wrap">
            <video src={fullSrc} poster={posterSrc} className="lightbox-video" controls autoPlay loop muted playsInline aria-label={alt || title || 'Preview of your video'} />
          </div>
        ) : (
          <div className="lightbox-image-wrap">
            <img src={fullSrc} alt={alt || title || 'Preview of your creative'} className="lightbox-image" />
          </div>
        )}

        {total > 1 && (
          <p className="lightbox-counter">{index + 1} of {total}</p>
        )}

        {(title || meta.length > 0 || cta || downloadName || formatId || video) && (
          <div className="lightbox-info">
            {title && <p className="lightbox-info__title">{title}</p>}
            {meta.length > 0 && (
              <dl className="lightbox-info__meta">
                {meta.map((m, i) => (
                  <React.Fragment key={i}>
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            <div className={`lightbox-info__actions lightbox-info__actions--bar${canMock ? '' : ' lightbox-info__actions--centered'}`}>
              <div className="lightbox-info__left">
                <a href={originalSrc ? resolveAssetUrl(originalSrc) : fullSrc} target="_blank" rel="noreferrer" className="lightbox-link">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                  <span>View in full size</span>
                </a>
              </div>
              <div className="lightbox-info__mid">
                {downloadName && video && (
                  <VideoDownloadMenu url={video} baseName={downloadName} up className="btn btn-primary lightbox-cta">
                    <span>Download</span>
                    <img src={iconDownWhite} alt="" />
                  </VideoDownloadMenu>
                )}
                {downloadName && !video && (
                  <button type="button" className="btn btn-primary lightbox-cta" onClick={billboardSrc && !mock ? () => setBillboardOpen(true) : handleDownload} disabled={downloading}>
                    {downloading ? <span className="spinner" /> : null}
                    <span>{mock && canMock ? 'Download Mockup' : 'Download'}</span>
                    <img src={iconDownWhite} alt="" />
                  </button>
                )}
                {cta && (
                  <button type="button" className="btn btn-primary lightbox-cta" onClick={handleCtaClick} disabled={ctaLoading}>
                    {ctaLoading ? <span className="spinner" /> : null}
                    {cta.label}
                  </button>
                )}
              </div>
              <div className="lightbox-info__right">
                {canMock && (
                  <button type="button" className="lightbox-link" onClick={() => setMock((m) => !m)}>
                    {mock ? 'Show creative' : 'Show mockup'}
                  </button>
                )}

              </div>
            </div>
            {downloadError && <p className="hint" style={{ margin: '8px 0 0' }}>{downloadError}</p>}
          </div>
        )}
      </div>

      {total > 1 && (
        <button className="lightbox-nav lightbox-nav--next" onClick={onNext} aria-label="Next image">›</button>
      )}
      {billboardOpen && billboardSrc && (
        <BillboardExportDialog src={billboardSrc} title={downloadName} formatId={formatId} onClose={() => setBillboardOpen(false)} />
      )}
    </div>
  );
}
