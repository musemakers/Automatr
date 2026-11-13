import React, { useState } from 'react';

// The preserve / redesign options as a grid of calm, uniform cards - one per
// detected element. Every card uses the same neutral treatment; the only
// colour is the brand blue on whatever is switched on, so the grid reads as
// one quiet system instead of a rainbow. Hovering a card highlights that
// element's outline on the image (onHover), and clicking anywhere on the
// card toggles it.
//
// items: [{ key, title, description, active, onLabel, offLabel, onToggle }]
// layout: { flexible, summary, onChange(flexible) } - the layout/composition choice
// onSetAll(bool): "Keep all" / "Redesign all"

const BLUE = '#2E5EFF';
const BLUE_DARK = '#1D3FE0';
const BLUE_SOFT = '#EEF3FF';
const BLUE_LINE = '#C9D7FF';
const LINE = '#E4E7EE';
const MUTED = '#667085';
const INK = '#0A0E17';

function Check({ color }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.4 5 8.9l4.6-5.3" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Swap({ color }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 4.5h7.5M7.5 2.2 9.8 4.5 7.5 6.8M10 7.5H2.5M4.5 5.2 2.2 7.5 4.5 9.8" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Switch({ on }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      style={{
        flex: '0 0 auto',
        width: 34,
        height: 20,
        borderRadius: 999,
        background: on ? BLUE : '#D5DAE4',
        position: 'relative',
        transition: 'background .18s ease',
        display: 'inline-block'
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(10,14,23,.28)',
          transition: 'left .18s ease'
        }}
      />
    </span>
  );
}

function StatusPill({ active, onLabel, offLabel }) {
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px 3px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.01em',
        background: active ? BLUE_SOFT : '#F3F4F8',
        color: active ? BLUE_DARK : MUTED
      }}
    >
      {active ? <Check color={BLUE_DARK} /> : <Swap color={MUTED} />}
      {active ? onLabel : offLabel}
    </span>
  );
}

function Card({ item, hovered, onHover }) {
  const { key: k, title, description, active, onLabel, offLabel, onToggle } = item;
  const [focus, setFocus] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
      onMouseEnter={() => onHover(k)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 15px 13px',
        borderRadius: 14,
        border: `1px solid ${active || hovered ? BLUE_LINE : LINE}`,
        background: active ? '#F8FAFF' : '#fff',
        boxShadow: focus
          ? `0 0 0 3px rgba(46,94,255,.18)`
          : hovered
            ? '0 6px 18px rgba(15,42,92,.08)'
            : '0 1px 2px rgba(15,42,92,.03)',
        cursor: 'pointer',
        userSelect: 'none',
        outline: 'none',
        transition: 'background .18s ease, border-color .18s ease, box-shadow .18s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, lineHeight: 1.25, letterSpacing: '-.005em' }}>{title}</span>
        <Switch on={active} />
      </div>
      <span
        title={description}
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          color: MUTED,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 34
        }}
      >
        {description}
      </span>
      <StatusPill active={active} onLabel={onLabel} offLabel={offLabel} />
    </div>
  );
}

export default function PreservationCards({ items, hoveredKey, onHover, layout, onSetAll }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }}>Elements</span>
        <span style={{ display: 'inline-flex', gap: 14 }}>
          <button type="button" className="link-btn" style={{ fontSize: 12.5, fontWeight: 500 }} onClick={() => onSetAll(true)}>
            Keep all
          </button>
          <button type="button" className="link-btn" style={{ fontSize: 12.5, fontWeight: 500 }} onClick={() => onSetAll(false)}>
            Redesign all
          </button>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(205px, 1fr))', gap: 10 }}>
        {items.map((item) => (
          <Card key={item.key} item={item} hovered={hoveredKey === item.key} onHover={onHover} />
        ))}
      </div>

      {layout && (
        <div
          style={{
            marginTop: 10,
            padding: '13px 15px',
            borderRadius: 14,
            border: `1px solid ${LINE}`,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,42,92,.03)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, letterSpacing: '-.005em' }}>Layout &amp; composition</div>
            {layout.summary && <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.45, marginTop: 3 }}>{layout.summary}</div>}
          </div>
          <div role="group" aria-label="Layout" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: '#F0F2F7' }}>
            {[
              [false, 'Keep layout'],
              [true, 'Allow redesign']
            ].map(([flex, label]) => {
              const on = layout.flexible === flex;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => layout.onChange(flex)}
                  style={{
                    border: 0,
                    cursor: 'pointer',
                    padding: '6px 13px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: on ? '#fff' : 'transparent',
                    color: on ? INK : MUTED,
                    boxShadow: on ? '0 1px 3px rgba(10,14,23,.14)' : 'none',
                    transition: 'all .15s ease'
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
