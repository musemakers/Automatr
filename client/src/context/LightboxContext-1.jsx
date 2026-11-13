import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { resolveAssetUrl, downloadFile } from '../api/client.js';
import DestinationMockup from '../components/DestinationMockup.jsx';

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
    return [{ src: payload.src, alt: payload.alt, title: payload.title, meta: payload.meta, downloadName: payload.downloadName, originalSrc: payload.originalSrc, formatId: payload.formatId, caption: payload.caption }];
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
  const { src, alt, title, meta = [], downloadName, originalSrc, formatId, caption } = item;
  const [mock, setMock] = useState(false);
  useEffect(() => setMock(false), [src, formatId]);
  const fullSrc = resolveAssetUrl(src);
  const [ctaLoading, setCtaLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  async function handleDownload() {
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadFile(fullSrc, downloadName);
    } catch {
      setDownloadError('Could not download. Use "Open original" and save it from there.');
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
    <div className="lightbox-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>

      {total > 1 && (
        <button className="lightbox-nav lightbox-nav--prev" onClick={onPrev} aria-label="Previous image">‹</button>
      )}

      <div className="lightbox-body">
        {mock && formatId ? (
          <DestinationMockup formatId={formatId} src={src} caption={caption || title} />
        ) : (
          <div className="lightbox-image-wrap">
            <img src={fullSrc} alt={alt || title || 'Image'} className="lightbox-image" />
          </div>
        )}

        {total > 1 && (
          <p className="lightbox-counter">{index + 1} of {total}</p>
        )}

        {(title || meta.length > 0 || cta || downloadName || formatId) && (
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
            <div className="lightbox-info__actions">
              <a href={originalSrc ? resolveAssetUrl(originalSrc) : fullSrc} target="_blank" rel="noreferrer" className="lightbox-info__open">
                {originalSrc || !downloadName ? 'Open original ↗' : 'Open full size ↗'}
              </a>
              <div className="lightbox-info__btns">
              {formatId && (
                <button type="button" className="btn btn-secondary lightbox-cta" onClick={() => setMock((m) => !m)}>
                  {mock ? 'Show image' : '📱 Show Mockup'}
                </button>
              )}
              {downloadName && (
                <button type="button" className="btn btn-primary lightbox-cta" onClick={handleDownload} disabled={downloading}>
                  {downloading ? <span className="spinner" /> : null}
                  ⬇ Download
                </button>
              )}
              {cta && (
                <button type="button" className="btn btn-primary lightbox-cta" onClick={handleCtaClick} disabled={ctaLoading}>
                  {ctaLoading ? <span className="spinner" /> : null}
                  {cta.label}
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
    </div>
  );
}
