import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import PreservationPreview from './PreservationPreview.jsx';
import PreservationCards from './PreservationCards.jsx';

// Full-screen lightbox shown once a creative has been analysed: the original
// on the left with dotted outlines around what the AI found, and the
// preserve / redesign cards on the right. Esc, the backdrop or "Done" close it.

export default function PreservationLightbox({
  open,
  onClose,
  imageSrc,
  regionDefs,
  showOutlines,
  onShowOutlines,
  hoveredKey,
  onHover,
  onChangeBox,
  hasBoxEdits,
  onResetBoxes,
  items,
  layout,
  onSetAll,
  note,
  onReupload,
  tab = 'elements',
  onTab,
  protectedCount = 0,
  protectSlot
}) {
  const doneRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    doneRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const kept = items.filter((i) => i.active).length;
  const hasRegions = regionDefs.length > 0;
  const protect = tab === 'protect';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What should we preserve from the original?"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'rgba(10,14,23,.58)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(8px, 3vw, 32px)'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1180,
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          borderRadius: 22,
          boxShadow: '0 40px 100px rgba(10,14,23,.45), 0 0 0 1px rgba(255,255,255,.06)',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '20px 26px 16px', borderBottom: '1px solid #EEF0F5' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 19, fontWeight: 600, color: '#0F2A5C', letterSpacing: '-.01em' }}>
              What should we preserve?
            </div>
            <div style={{ fontSize: 13, color: '#667085', marginTop: 3, lineHeight: 1.45 }}>
              Choose what carries over from your original creative. Everything else is freshly designed for the new brief.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', border: '1px solid #E4E7EE', background: '#fff', cursor: 'pointer', color: '#475467', fontSize: 18, lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 26px 0', borderBottom: '1px solid #EEF0F5' }}>
          {[['elements', 'Elements'], ['protect', protectedCount ? `Protect exact areas (${protectedCount})` : 'Protect exact areas']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => onTab && onTab(k)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: '8px 4px',
                marginRight: 18,
                fontSize: 13,
                fontWeight: 600,
                color: tab === k ? '#1D3FE0' : '#667085',
                borderBottom: tab === k ? '2px solid #2E5EFF' : '2px solid transparent',
                marginBottom: -1
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {protect ? (
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 'clamp(16px, 2.4vw, 28px)', background: 'linear-gradient(180deg,#F7F8FC 0%,#EEF1F8 100%)' }}>
            <div style={{ maxWidth: 620, margin: '0 auto' }}>
              <div style={{ borderRadius: 14, overflow: 'hidden', boxShadow: '0 18px 44px rgba(15,42,92,.18)', marginBottom: 14 }}>{protectSlot}</div>
            </div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <div
            style={{
              flex: '1 1 420px',
              minWidth: 0,
              background: 'linear-gradient(180deg,#F7F8FC 0%,#EEF1F8 100%)',
              padding: 'clamp(16px, 2.4vw, 28px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14
            }}
          >
            <div style={{ borderRadius: 14, boxShadow: '0 18px 44px rgba(15,42,92,.18)', maxWidth: '100%', overflow: 'visible' }}>
              <PreservationPreview
                src={imageSrc}
                regions={regionDefs}
                show={showOutlines}
                hoveredKey={hoveredKey}
                onToggle={(key) => regionDefs.find((d) => d.key === key)?.toggle()}
                onChangeBox={onChangeBox}
                maxHeight="min(62vh, 560px)"
              />
            </div>
            {onReupload && (
              <button type="button" className="btn btn-secondary" onClick={onReupload} style={{ fontSize: 13 }}>
                &#8593; Re-upload image
              </button>
            )}
            {hasRegions ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#667085' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 600, color: '#0A0E17' }}>
                  <input type="checkbox" checked={showOutlines} onChange={(e) => onShowOutlines(e.target.checked)} />
                  Dotted outlines
                </label>
                <span>
                  Approximate &middot; drag to adjust, click to toggle
                  {hasBoxEdits && (
                    <>
                      {' · '}
                      <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={onResetBoxes}>
                        Reset
                      </button>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#667085' }}>{note || 'Element outlines are not available for this image.'}</div>
            )}
          </div>

          <div style={{ flex: '1 1 460px', minWidth: 0, padding: 'clamp(16px, 2.4vw, 28px)' }}>
            <PreservationCards items={items} hoveredKey={hoveredKey} onHover={onHover} layout={layout} onSetAll={onSetAll} />
          </div>
        </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 26px', borderTop: '1px solid #EEF0F5', background: '#fff' }}>
          <span style={{ fontSize: 13, color: '#667085' }}>
            <strong style={{ color: '#0A0E17' }}>{kept}</strong> of {items.length} elements kept as in the original
          </span>
          <button ref={doneRef} type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
