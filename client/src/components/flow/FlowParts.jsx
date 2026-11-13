import React, { useRef, useState, useEffect, useContext, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { FlowBarContext } from '../Layout.jsx';
import { pct } from '../../utils/boxes.js';
import ICON_EYE from '../../assets/size-adapt/icon-eye.svg';
import ICON_DOWN_TILE from '../../assets/size-adapt/icon-download-tile.svg';
import ICON_SPARKLE_WHITE from '../../assets/size-adapt/icon-sparkle-white.svg';
import ICON_ARROW_WHITE from '../../assets/size-adapt/icon-arrow-right-white.svg';
import SizePicker from './SizePicker.jsx';
import BarActions from './BarActions.jsx';
import { Rail, RailStage, RailPanel } from './Rail.jsx';
import BloomLoader from '../BloomLoader.jsx';
import { CostTag } from '../ui.jsx';
import '../../styles/flow-quickfix.css';

// Shared pieces of the Subject Swap and Headline Switch flows (same look as Size Adapt):
// the step bar and the image "stage" that outlines what was found and lets the person draw a box.

export function FlowStepBar({ icon, name, steps, step, reachable, onStep, onMenuClick }) {
  const ctx = useContext(FlowBarContext);
  // Inside a Layout the bar is moved up into the page's top slot; Layout hides its plain title bar meanwhile.
  useLayoutEffect(() => { ctx?.register?.(true); return () => ctx?.register?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bar = (
    <div className="sa-stepbar">
      <div className="sa-stepbar__tool"><img src={icon} alt="" /><span>{name}</span></div>
      <ol className="sa-steps">
        {steps.map(([num, label], i) => (
          <React.Fragment key={num}>
            {i > 0 && <li className="sa-step__line" aria-hidden="true" />}
            <li>
              <button
                type="button"
                className={`sa-step ${step === i ? 'is-active' : ''} ${step > i ? 'is-done' : ''}`.trim()}
                aria-current={step === i ? 'step' : undefined}
                disabled={!reachable[i] || step === i}
                onClick={() => onStep(i)}
              >
                <span className="sa-step__dot">{num}</span>
                <span className="sa-step__label">{label}</span>
              </button>
            </li>
          </React.Fragment>
        ))}
      </ol>
      <BarActions onMenuClick={onMenuClick || ctx?.openMenu} />
    </div>
  );
  return ctx?.slot ? createPortal(bar, ctx.slot) : bar;
}

/**
 * The image with outlines on it.
 * boxes: [{ id, box: {x,y,w,h}|null, selected, label }]; items without a box are simply not outlined.
 * While `drawing`, a drag on the image calls onDraw(box) (boxes smaller than minW x minH are ignored).
 */
export function ImageStage({ src, alt, boxes, activeId, scanning, scanText, drawing, tip, onSelect, onDraw, minW = 0.04, minH = 0.04, children }) {
  const imgRef = useRef(null);
  const startRef = useRef(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => { if (!drawing) { startRef.current = null; setDraft(null); } }, [drawing]);

  function pos(e) {
    const r = imgRef.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  function down(e) {
    if (!drawing || e.button > 0 || e.target.closest?.('.sa-preview__action')) return;
    e.preventDefault();
    startRef.current = pos(e);
    setDraft({ ...startRef.current, w: 0, h: 0 });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
  }
  function move(e) { if (startRef.current) setDraft(rectOf(startRef.current, pos(e))); }
  function up(e) {
    if (!startRef.current) return;
    const box = rectOf(startRef.current, pos(e));
    startRef.current = null;
    setDraft(null);
    if (box.w >= minW && box.h >= minH) onDraw?.(box);
  }
  function cancel() { startRef.current = null; setDraft(null); }

  return (
    <div className={`fx-stage ${scanning ? 'is-scanning' : ''} ${drawing ? 'is-drawing' : ''}`.trim()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      <img ref={imgRef} className="fx-stage__img" src={src} alt={alt} draggable="false" />
      <div className="fx-boxes">
        {!scanning && boxes.map((b, i) => b.box && (
          <button
            key={b.id}
            type="button"
            className={`fx-box ${b.selected ? 'is-selected' : ''} ${b.remove ? 'is-remove' : ''} ${b.id === activeId ? 'is-active' : ''}`.trim()}
            style={{ left: pct(b.box.x), top: pct(b.box.y), width: pct(b.box.w), height: pct(b.box.h) }}
            aria-label={b.label}
            onClick={(e) => { e.stopPropagation(); onSelect?.(b.id); }}
          >
            <span className="fx-box__tag">{i + 1}</span>
          </button>
        ))}
        {draft && <div className="fx-box fx-box--draft" style={{ left: pct(draft.x), top: pct(draft.y), width: pct(draft.w), height: pct(draft.h) }} />}
      </div>
      {tip && drawing && <p className="fx-tip" role="status">{tip}</p>}
      {children}
      {scanning && <div className="fx-scan"><p className="fx-scan__status" role="status">{scanText}</p></div>}
    </div>
  );
}

/** The finished image as a tile: title, picture, Preview (opens the shared lightbox) and Download. */
export function ResultTile({ title, url, alt, downloadName, working, workingLabel = 'Generating…', onDownload, downloading, onPreview, children }) {
  return (
    <div className="sa-tile">
      {title ? <p className="sa-tile__title">{title}</p> : null}
      <div className={`sa-tile__img ${working ? 'is-bloom' : ''}`.trim()}>
        {working && <div className="sa-tile__state"><BloomLoader label={workingLabel} /></div>}
        {!working && url && (
          <>
            <img src={url} alt={alt} />
            <div className="sa-tile__actions">
              <button type="button" className="sa-btn sa-btn--white sa-btn--tile" onClick={onPreview}><img src={ICON_EYE} alt="" /><span>Preview</span></button>
              <span className="sa-tile__right">
                <button type="button" className="sa-btn sa-btn--primary sa-btn--tile" disabled={downloading} aria-label={`Download ${downloadName}`} onClick={onDownload}>
                  <img className="sa-icon-down" src={ICON_DOWN_TILE} alt="" />
                </button>
              </span>
            </div>
          </>
        )}
        {!working && !url && <div className="sa-tile__state">{children}</div>}
      </div>
    </div>
  );
}

/** One message for every generation error on the last screens, always with a Try again button. */
export const GENERATION_ERROR_TEXT = 'We couldn’t create your creative. Your selections are saved, so you can try again.';

export function GenerationError({ onRetry, error, text = GENERATION_ERROR_TEXT }) {
  return (
    <div className="fx-generr" role="alert">
      <p className="fx-generr__text">{text}</p>
      {error?.isBillingError && error?.billingUrl && (
        <a href={error.billingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary ai-error-notice__cta">Add AI credits ↗</a>
      )}
      <button type="button" className="sa-btn sa-btn--outline sa-btn--sm" onClick={onRetry}><span>Try again</span></button>
    </div>
  );
}

/** Resolves once the picked image has been read and decoded (at least `minMs`, so the loader never just flashes). */
export function whenImageReady(file, minMs = 700) {
  const wait = new Promise((r) => setTimeout(r, minMs));
  const decode = new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    im.onload = done; im.onerror = done;
    im.src = url;
  });
  return Promise.all([wait, decode]);
}

/** Reads the pixel size of an image File (for "Keep original size"). Resolves { w, h } or null. */
export function readImageDims(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(null); return; }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
    im.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    im.src = url;
  });
}

/** "WxH" for the server's `sizePx` field, or '' when no valid size is chosen. */
export function sizePxOf(size) {
  return size && size.w > 0 && size.h > 0 ? `${Math.round(size.w)}x${Math.round(size.h)}` : '';
}

/** Human text for a chosen size, e.g. "Instagram / Feed (1080 × 1350 px)". */
export function sizeSummary(size, fallbackDims) {
  const dims = size?.w && size?.h ? size : fallbackDims;
  const px = dims?.w && dims?.h ? `${dims.w} × ${dims.h} px` : '';
  if (!size || !size.label || size.formatId === 'original') return px ? `Original size (${px})` : 'Original size';
  return `${size.platform ? `${size.platform} / ` : ''}${size.label}${px ? ` (${px})` : ''}`;
}

/**
 * The "Choose size" step shared by Subject Swap and Headline Switch (same layout as Size Adapt):
 * pick a platform + size (or keep the original), see the creative, then Generate.
 * `size` is whatever SizePicker's onChange last reported ({ platform, formatId, w, h, label }).
 */
export function ChooseSizePanel({ kicker, heading = 'Which size do you need?', intro, previewUrl, size, onSize, originalDims, onGenerate, costs, hint }) {
  // Adaptations start on "Keep original size": pre-select it as soon as the creative's real size is known (until a size is chosen).
  useEffect(() => {
    if (originalDims && !size?.platform && !size?.formatId) {
      onSize?.({ platform: 'original', formatId: 'original', w: originalDims.w, h: originalDims.h, label: `Keep original size (${originalDims.w} × ${originalDims.h} px)` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalDims, size?.platform, size?.formatId]);
  return (
    <Rail>
      <RailStage>
        <div className="sa-preview sa-preview--filled">{previewUrl && <img src={previewUrl} alt="Your creative" />}</div>
      </RailStage>
      <RailPanel label="Settings">
        <p className="sa-kicker">{kicker}</p>
        <h2 className="sa-heading">{heading}</h2>
        {intro && <p>{intro}</p>}
        <div className="fx-sizepane">
          <SizePicker mode="image" platform={size?.platform} formatId={size?.formatId} onChange={onSize} originalDims={originalDims} allowOriginal />
        </div>
        {(hint || costs) && <p className="sa-note" aria-live="polite">{hint} <CostTag estimate={costs?.imageHigh} /></p>}
        <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" onClick={onGenerate}>
          <img src={ICON_SPARKLE_WHITE} alt="" className="sa-btn__sm" /><span>Generate</span><img src={ICON_ARROW_WHITE} alt="" />
        </button>
      </RailPanel>
    </Rail>
  );
}
