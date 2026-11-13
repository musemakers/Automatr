import React, { useEffect, useRef, useState } from 'react';
import '../../styles/rail-edit-adapt.css';

// The dotted-outline preview used by Size Adapt (Choose size) and the video flows (Video size).
// Each frame is the part of the picture that stays in frame at that size. Every outline is drawn with the same area
// as the creative, so only its shape differs; the creative shrinks when an outline is bigger than the stage, and it
// sits in the middle of the stage. With no frames the picture is simply shown whole.
//
//   <CropPreview url={src} frames={[{ key: '1080x1920', ar: 1080 / 1920, text: 'Reel · 1080 × 1920 px' }]} />
export const CROP_TINTS = ['#2e5eff', '#e5484d', '#12b76a', '#f79009'];

export default function CropPreview({ url, frames: wanted = [], alt = 'Your creative' }) {
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const key = wanted.map((f) => `${f.key}:${f.ar}:${f.text}`).join('|');
  useEffect(() => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return undefined;
    function measure() {
      const iw = img.naturalWidth; const ih = img.naturalHeight;
      const pr = box.getBoundingClientRect();
      if (!iw || !ih || !pr.width || !pr.height) return;
      const frames = [];
      const seen = new Set();
      wantedRef.current.forEach((f, i) => {
        if (!f.ar || seen.has(f.key)) return;
        seen.add(f.key);
        const fh = Math.sqrt((iw * ih) / f.ar);
        frames.push({ key: f.key, w: f.ar * fh, h: fh, tint: CROP_TINTS[i % CROP_TINTS.length], text: f.text });
      });
      let W = iw; let H = ih;
      frames.forEach((f) => { W = Math.max(W, f.w); H = Math.max(H, f.h); });
      const k = frames.length ? Math.min(1, pr.width / W, pr.height / H) : 1;
      setLayout({ k: frames.length ? k : null, iw, ih, cx: pr.width / 2, cy: pr.height / 2, frames });
    }
    measure();
    img.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    const ro = window.ResizeObserver ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => { img.removeEventListener('load', measure); window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [url, key]);
  const k = layout?.k;
  return (
    <div className="sa-preview sa-preview--filled" ref={boxRef}>
      <img ref={imgRef} src={url} alt={alt} style={k ? { maxWidth: 'none', maxHeight: 'none', width: layout.iw * k, height: layout.ih * k } : undefined} />
      <div className="crop-layer" aria-hidden="true">
        {k && layout.frames.map((f) => (
          <div key={f.key} className="crop" style={{ '--c': f.tint, width: f.w * k, height: f.h * k, left: layout.cx - (f.w * k) / 2, top: layout.cy - (f.h * k) / 2 }}>
            <span className="crop__tag">{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
