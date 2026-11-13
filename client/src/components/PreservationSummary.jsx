import React from 'react';

// The compact, always-visible stand-in for the full preserve picker (which
// lives in the lightbox): what was kept vs. redesigned at a glance, plus
// "Review & edit" to reopen the lightbox and "Replace" to swap the creative.

const BLUE_DARK = '#1D3FE0';
const BLUE_SOFT = '#EEF3FF';
const MUTED = '#667085';

export default function PreservationSummary({ items, layoutFlexible, imageSrc, onReview, onProtect, protectedCount = 0, onReplace }) {
  const kept = items.filter((i) => i.active).length;
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 16,
        border: '1px solid #E4E7EE',
        background: '#fff',
        boxShadow: '0 1px 2px rgba(15,42,92,.04), 0 8px 24px rgba(15,42,92,.04)',
        marginBottom: 16
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {imageSrc ? (
          <button
            type="button"
            onClick={onReview}
            aria-label="Review original creative"
            title="Review & edit"
            style={{ flex: '0 0 auto', width: 72, height: 72, padding: 0, borderRadius: 12, border: '1px solid #E4E7EE', overflow: 'hidden', cursor: 'pointer', background: '#F5F7FB', boxShadow: '0 2px 8px rgba(15,42,92,.08)' }}
          >
            <img src={imageSrc} alt="Original creative" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </button>
        ) : (
        <span
            style={{ flex: '0 0 auto', width: 36, height: 36, borderRadius: '50%', background: BLUE_SOFT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.4 5 8.9l4.6-5.3" stroke={BLUE_DARK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0A0E17', letterSpacing: '-.005em' }}>Original creative analysed</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
            {kept} of {items.length} elements kept &middot; {layoutFlexible ? 'layout may be redesigned' : 'layout kept'}
            {protectedCount > 0 && <> &middot; {protectedCount} protected area{protectedCount > 1 ? 's' : ''}</>}
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
          <button type="button" className="btn btn-secondary" onClick={onReview}>
            Review &amp; edit
          </button>
          <button type="button" className="link-btn" style={{ fontSize: 12.5 }} onClick={onProtect}>
            Protect exact areas
          </button>
          <button type="button" className="link-btn" style={{ fontSize: 12.5 }} onClick={onReplace}>
            &#8593; Re-upload image
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {items.map((i) => (
            <span
              key={i.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 500,
                background: i.active ? BLUE_SOFT : '#F3F4F8',
                color: i.active ? BLUE_DARK : MUTED
              }}
            >
              {i.active ? '✓' : '↻'} {i.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
