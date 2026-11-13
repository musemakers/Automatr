import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Lets the person brush-mark the exact part of an already-generated image
// that needs fixing, before sending it (plus a text instruction) to the
// "Fix an area" touch-up tool - see modifyImageWithRegion in resources.js
// and refineImageRegion in the server's designService.js.
//
// This renders ONLY a transparent overlay canvas, absolutely positioned to
// fill whatever it's mounted inside - it does NOT load or render its own
// <img>. It's meant to be dropped directly inside the same preview canvas
// element that already shows the design's image, as a sibling positioned
// on top of it, so the person is always marking up the one image already
// on screen rather than a second copy fetched separately.
//
// Two canvases are kept in sync on every stroke:
//  - a VISIBLE one, drawn in translucent red so the person can see exactly
//    what they've marked;
//  - a HIDDEN one, drawn in solid opaque white on a transparent background -
//    this is the actual mask exported to the server. Keeping it separate
//    from the visible canvas avoids the visible canvas's overlapping
//    semi-transparent strokes (each pass darkens the overlap) from ever
//    being mistaken for a real alpha value - the exported mask is always a
//    clean "painted = fully opaque" / "untouched = fully transparent" image,
//    which is what the server's mask-inversion math (buildOpenAiMask) expects.
//
// Exposes exportMask()/clear()/hasMarks via ref rather than taking a
// value/onChange prop, since a live-updating data URL on every brush stroke
// would be wasteful to hold in parent state - the parent only actually
// needs the mask at the moment "Apply fix" is clicked. Brush size is a
// plain prop (not internal state) so the parent can host the brush-size
// control in its own tools panel, away from the preview itself.
const RegionAnnotator = forwardRef(function RegionAnnotator({ brushSize = 36, disabled = false }, ref) {
  const wrapRef = useRef(null);
  const visibleCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [hasMarks, setHasMarks] = useState(false);

  // Sizes both canvases (in real device pixels, for crisp strokes on
  // high-DPI screens) to match whatever box this ends up mounted inside -
  // watched with a ResizeObserver rather than a one-off measurement, since
  // the preview frame's size can change (viewport resize, sidebar toggle)
  // while the annotator is open.
  function syncCanvasSize() {
    const wrap = wrapRef.current;
    const visible = visibleCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!wrap || !visible || !mask) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [visible, mask]) {
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
  }

  useEffect(() => {
    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  function pointFromEvent(e) {
    const canvas = visibleCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr
    };
  }

  function strokeSegment(from, to) {
    const dpr = window.devicePixelRatio || 1;
    const width = brushSize * dpr;

    const visibleCtx = visibleCanvasRef.current.getContext('2d');
    visibleCtx.lineCap = 'round';
    visibleCtx.lineJoin = 'round';
    visibleCtx.lineWidth = width;
    visibleCtx.strokeStyle = 'rgba(255,40,40,0.55)';
    visibleCtx.beginPath();
    visibleCtx.moveTo(from.x, from.y);
    visibleCtx.lineTo(to.x, to.y);
    visibleCtx.stroke();

    const maskCtx = maskCanvasRef.current.getContext('2d');
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.lineWidth = width;
    maskCtx.strokeStyle = 'rgba(255,255,255,1)';
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
  }

  function handlePointerDown(e) {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = pointFromEvent(e);
    lastPointRef.current = p;
    // A single tap/click with no drag still leaves a dot - draw a zero-length
    // segment onto itself so it's not lost.
    strokeSegment(p, p);
    setHasMarks(true);
  }

  function handlePointerMove(e) {
    if (disabled || !drawingRef.current) return;
    const p = pointFromEvent(e);
    strokeSegment(lastPointRef.current, p);
    lastPointRef.current = p;
  }

  function endStroke() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clear() {
    for (const canvas of [visibleCanvasRef.current, maskCanvasRef.current]) {
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasMarks(false);
  }

  useImperativeHandle(ref, () => ({
    clear,
    hasMarks,
    exportMask() {
      if (!hasMarks || !maskCanvasRef.current) return null;
      return maskCanvasRef.current.toDataURL('image/png');
    }
  }));

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, touchAction: 'none', background: 'transparent' }}>
      <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
      <canvas
        ref={visibleCanvasRef}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          background: 'transparent',
          cursor: disabled ? 'default' : 'crosshair',
          outline: 'none'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />
    </div>
  );
});

export default RegionAnnotator;
