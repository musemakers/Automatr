import React from 'react';
import { Rail, RailStage, RailPanel } from '../flow/Rail.jsx';
import SizePicker from '../flow/SizePicker.jsx';
import CropPreview from '../flow/CropPreview.jsx';
import { sizeText } from './videoUtils.js';
import iconSparkle from '../../assets/video/icon-sparkle-white.svg';
import iconArrow from '../../assets/video/icon-arrow-right-white.svg';

/**
 * Video size screen: the video can be a different size from the image. "Keep original size" shows the real
 * pixel size of the image. The creative on the right shows the chosen shape as a dotted outline (as in Size Adapt).
 */
export default function VideoSize({ kicker, imageUrl, originalDims, size, onSize, effective, busy, onGenerate, notice, qualityCheck, onQualityCheck }) {
  const isOriginal = !size || size.formatId === 'original' || size.platform === 'original';
  const dims = effective || (isOriginal ? originalDims : null);
  // The same dotted-outline preview as Size Adapt: the outline is the part of the creative that stays in the video.
  const frames = !isOriginal && dims ? [{ key: `${dims.w}x${dims.h}`, ar: dims.w / dims.h, text: /\d\s*[×x]\s*\d/.test(size.label || '') ? size.label : `${size.label || size.platform || 'Video'} · ${dims.w} × ${dims.h}` }] : [];
  return (
    <Rail>
      <RailStage>
        {imageUrl
          ? <CropPreview url={imageUrl} frames={frames} alt="Your creative with the chosen video size outlined" />
          : <div className="sa-preview sa-preview--empty"><p className="vf-canvas__empty">Select a creative on the first screen to see it here</p></div>}
      </RailStage>
      <RailPanel label="Settings">
        {notice}
        <p className="sa-kicker">{kicker}</p>
        <h2 className="sa-heading">What size should your video be?</h2>
        <p>Your video can be a different size from your image. We’ll fit your creative to the size you pick.</p>
        <div className="vf-size">
          <SizePicker
            mode="video"
            allowOriginal
            originalDims={originalDims}
            platform={size ? size.platform : 'original'}
            formatId={size ? size.formatId : 'original'}
            onChange={onSize}
          />
          {dims ? <p className="vf-size__note">{sizeText(dims)}{isOriginal ? ' (original size)' : ''}</p> : <p className="vf-size__note">Enter a width and height to continue.</p>}
        </div>
        {onQualityCheck && (
          <label className="vf-qc" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={Boolean(qualityCheck)} onChange={(e) => onQualityCheck(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              <strong>Check video quality</strong>
              <span style={{ display: 'block', opacity: 0.75 }}>We inspect the finished video for glitches (extra fingers, warped faces, garbled text) and, if we find any, make it again with a fix. This takes a few extra minutes.</span>
            </span>
          </label>
        )}
        <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={busy || !dims} onClick={onGenerate}>
          <img src={iconSparkle} alt="" className="sa-btn__sm" /><span>Generate video</span><img src={iconArrow} alt="" />
        </button>
      </RailPanel>
    </Rail>
  );
}
