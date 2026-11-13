import React from 'react';
import BloomLoader from '../BloomLoader.jsx';
import { Rail, RailStage, RailStageInner, RailBottom } from '../flow/Rail.jsx';
import { resolveAssetUrl } from '../../api/client.js';
import { sizeText, VIDEO_ERROR } from './videoUtils.js';
import iconEye from '../../assets/video/icon-eye.svg';
import iconDownTile from '../../assets/video/icon-download-tile.svg';
import iconDownWhite from '../../assets/video/icon-download-white.svg';

/**
 * Final screen (last-screen layout): the video on the dotted stage with Preview + Download on it, and a bottom panel
 * with the step line, the status line (generating -> ready) and the main Download button. The page needs
 * pageClass="page-result page-video-done". Every failure shows the same message with Try again.
 */
export default function VideoDone({ kicker, run, dims, downloading, onDownload, onPreview, onRetry, extras, notice }) {
  const ready = run.status === 'done' && run.job?.videoUrl;
  const working = run.status === 'starting' || run.status === 'running';
  const failed = run.status === 'failed';
  const url = ready ? resolveAssetUrl(run.job.videoUrl) : '';
  const ar = dims ? dims.w / dims.h : 1;

  const text = (
    <>
      {notice}
      <p>{kicker}</p>
      <p role="status">
        {working && 'Generating your video. This can take a few minutes, and you can leave this page: it will keep going.'}
        {ready && `Preview it or download it${dims ? ` at ${sizeText(dims)}` : ''}.`}
        {run.status === 'idle' && 'Choose the motion and size first, then generate your video.'}
      </p>
      {failed && <p className="rail__bottom-error" role="alert">{run.error || VIDEO_ERROR}</p>}
      {failed && <button type="button" className="sa-btn sa-btn--outline sa-btn--sm" onClick={onRetry}><span>Try again</span></button>}
      <button type="button" className="sa-btn sa-btn--primary sa-btn--lg" disabled={!ready || downloading} onClick={onDownload}>
        <span>Download</span><img className="sa-icon-down" src={iconDownWhite} alt="" />
      </button>
    </>
  );

  return (
    <Rail bottom>
      <RailStage scroll>
        <RailStageInner>
          <div className="sa-tiles sa-tiles--single" style={{ '--ar': ar }}>
            <div className="sa-tile">
              <div className={`sa-tile__img sa-tile__img--video ${working ? 'is-bloom' : ''}`.trim()}>
                {working && <div className="sa-tile__state vf-vid__state"><BloomLoader label="Creating your video…" /></div>}
                {ready && (
                  <>
                    <video src={url} muted loop autoPlay playsInline aria-label="Your video" />
                    <div className="sa-tile__actions">
                      <button type="button" className="sa-btn sa-btn--white sa-btn--tile" onClick={onPreview}><img src={iconEye} alt="" /><span>Preview</span></button>
                      <span className="sa-tile__right">
                        <button type="button" className="sa-btn sa-btn--primary sa-btn--tile" disabled={downloading} aria-label="Download video" onClick={onDownload}>
                          <img className="sa-icon-down" src={iconDownTile} alt="" />
                        </button>
                      </span>
                    </div>
                  </>
                )}
                {(failed || run.status === 'idle') && <div className="sa-tile__state vf-vid__state"><span>{failed ? 'No video yet.' : 'Your video will show here.'}</span></div>}
              </div>
            </div>
          </div>
        </RailStageInner>
      </RailStage>
      <RailBottom label="Download options" text={text} actions={extras} />
    </Rail>
  );
}
