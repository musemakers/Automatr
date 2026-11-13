import React from 'react';
import { Rail, RailStage, RailPanel } from '../flow/Rail.jsx';
import SizePicker from '../flow/SizePicker.jsx';
import { sizeText } from './videoUtils.js';
import iconSparkle from '../../assets/video/icon-sparkle-white.svg';
import iconArrow from '../../assets/video/icon-arrow-right-white.svg';

/**
 * Video size screen: the video can be a different size from the image. "Keep original size" shows the real
 * pixel size of the image. The creative on the right is shown cropped to the chosen shape.
 */
export default function VideoSize({ kicker, imageUrl, originalDims, size, onSize, effective, busy, onGenerate, notice }) {
  const isOriginal = !size || size.formatId === 'original' || size.platform === 'original';
  const dims = effective || (isOriginal ? originalDims : null);
  const ar = dims ? dims.w / dims.h : originalDims ? originalDims.w / originalDims.h : 1;
  return (
    <Rail>
      <RailStage>
        <div className="vf-canvas" style={{ '--ar': ar }} aria-label="Your creative at the chosen video size">
          {imageUrl ? <img src={imageUrl} alt="Your creative at the chosen video size" /> : <p className="vf-canvas__empty">Select a creative on the first screen to see it here</p>}
        </div>
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
        <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={busy || !dims} onClick={onGenerate}>
          <img src={iconSparkle} alt="" className="sa-btn__sm" /><span>Generate video</span><img src={iconArrow} alt="" />
        </button>
      </RailPanel>
    </Rail>
  );
}
