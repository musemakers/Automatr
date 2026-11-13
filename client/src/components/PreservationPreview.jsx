import React, { useRef, useState } from 'react';

// Shows the uploaded creative with a dotted selection outline around each
// element the person has chosen to preserve. Boxes are normalized
// [x, y, w, h] fractions (0-1, top-left origin) from template analysis, so
// they're positioned with percentages and scale with the image. They're AI
// estimates, so each one can be corrected right on the image:
//   - drag the box to move it
//   - drag a corner handle to resize it
//   - click it (without dragging) to turn that "Preserve ..." option on/off
//
// regions: [{ key, label, box, color, active }]
//   active     - the matching option is ticked (outline shown)
//   hoveredKey - an option the person is hovering; shown even if unticked
//   onToggle(key), onChangeBox(key, [x, y, w, h])
const MIN = 0.02;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export default function PreservationPreview({ src, regions, show, hoveredKey, onToggle, onChangeBox, maxHeight = 360 }) {
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const visible = show ? regions.filter((r) => r.box && (r.active || r.key === hoveredKey || r.key === draggingKey)) : [];

  function startDrag(e, region, mode) {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { key: region.key, mode, startX: e.clientX, startY: e.clientY, box: region.box, rect, moved: false };
    setDraggingKey(region.key);
  }

  function onMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 4) return;
    d.moved = true;
    let [x, y, w, h] = d.box;
    if (d.mode === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      let left = x, top = y, right = x + w, bottom = y + h;
      if (d.mode.includes('w')) left = clamp(left + dx, 0, right - MIN);
      if (d.mode.includes('e')) right = clamp(right + dx, left + MIN, 1);
      if (d.mode.includes('n')) top = clamp(top + dy, 0, bottom - MIN);
      if (d.mode.includes('s')) bottom = clamp(bottom + dy, top + MIN, 1);
      x = left; y = top; w = right - left; h = bottom - top;
    }
    onChangeBox && onChangeBox(d.key, [x, y, w, h]);
  }

  function endDrag(e, region) {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingKey(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // a plain click (no drag) on the box body toggles the option
    if (d && !d.moved && d.mode === 'move' && region && onToggle) onToggle(region.key);
  }

  const handles = [
    ['nw', { left: -6, top: -6, cursor: 'nwse-resize' }],
    ['ne', { right: -6, top: -6, cursor: 'nesw-resize' }],
    ['sw', { left: -6, bottom: -6, cursor: 'nesw-resize' }],
    ['se', { right: -6, bottom: -6, cursor: 'nwse-resize' }]
  ];

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        maxWidth: '100%',
        lineHeight: 0,
        borderRadius: 12,
        touchAction: 'none',
        userSelect: 'none'
      }}
    >
      <img src={src} alt="Creative to adapt" draggable={false} style={{ display: 'block', maxWidth: '100%', maxHeight, width: 'auto', height: 'auto', borderRadius: 12 }} />
      {visible.map((r) => {
        const [x, y, w, h] = r.box;
        const hovered = r.key === hoveredKey || r.key === draggingKey || r.key === overKey;
        return (
          <div
            key={r.key}
            role="button"
            tabIndex={0}
            title={`${r.active ? 'Preserving' : 'Not preserving'}: ${r.label} - click to ${r.active ? 'turn off' : 'turn on'}, drag to move, pull a corner to resize`}
            onPointerDown={(e) => startDrag(e, r, 'move')}
            onPointerMove={onMove}
            onPointerUp={(e) => endDrag(e, r)}
            onPointerCancel={(e) => endDrag(e, null)}
            onPointerEnter={() => setOverKey(r.key)}
            onPointerLeave={() => setOverKey((k) => (k === r.key ? null : k))}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
              boxSizing: 'border-box',
              cursor: 'move',
              background: hovered ? `${r.color}22` : 'transparent',
              border: `2px dashed ${r.color}`,
              opacity: r.active ? 1 : 0.6,
              // white halo so the dashes stay visible on dark and light areas alike
              boxShadow: '0 0 0 1px rgba(255,255,255,0.75), inset 0 0 0 1px rgba(255,255,255,0.45)',
              borderRadius: 3
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: -2,
                top: 0,
                transform: 'translateY(-100%)',
                background: r.color,
                color: '#fff',
                fontSize: 10,
                lineHeight: '14px',
                padding: '0 5px',
                borderRadius: '3px 3px 0 0',
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
              }}
            >
              {r.label}
            </span>
            {handles.map(([mode, pos]) => (
              <span
                key={mode}
                onPointerDown={(e) => startDrag(e, r, mode)}
                onPointerMove={onMove}
                onPointerUp={(e) => endDrag(e, r)}
                onPointerCancel={(e) => endDrag(e, null)}
                style={{ position: 'absolute', width: 11, height: 11, background: r.color, border: '1.5px solid #fff', borderRadius: 2, boxSizing: 'border-box', opacity: hovered ? 1 : 0, transition: 'opacity .12s ease', ...pos }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
