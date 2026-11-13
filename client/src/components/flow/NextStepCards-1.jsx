import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startNextFlow } from '../../utils/handoff.js';
import '../../styles/flow-quickfix.css';
import ICON_RESIZE from '../../assets/size-adapt/next-resize.svg';
import ICON_CONVERT from '../../assets/size-adapt/next-convert-video.svg';
import ICON_ARROW from '../../assets/size-adapt/next-arrow-right.svg';

/**
 * "What next?" cards under the Download button on the last screen of a flow.
 *   adapt            - "Want to adapt this creative to another size?" -> Size Adapt
 *   convert          - "Wish to convert this creative to video?" -> Convert to Video
 *   convert="select" - "Wish to convert one of the creatives to video?" - the person picks one result first
 *                      (hint "Select an adaptation first." until imageUrl is set)
 * imageUrl is the result handed over to the next flow, so it is not uploaded again; the cards stay
 * disabled until there is one.
 */
export default function NextStepCards({ adapt = false, convert = false, imageUrl = '', selectHint = 'Select an adaptation first.' }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const select = convert === 'select';
  const ok = Boolean(imageUrl) && !busy;

  async function go(kind) {
    if (!imageUrl || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await startNextFlow(navigate, kind, imageUrl);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  if (!adapt && !convert) return null;
  return (
    <div className="nextsteps">
      {adapt && (
        <div className="nextcard">
          <div className="nextcard__main">
            <img src={ICON_RESIZE} alt="" width="39" height="39" />
            <div className="nextcard__body"><p className="nextcard__text">Want to adapt this creative to another size?</p></div>
          </div>
          <button type="button" className="nextcard__link" disabled={!ok} onClick={() => go('resize')}><span>Adapt now</span><img src={ICON_ARROW} alt="" width="24" height="24" /></button>
        </div>
      )}
      {convert && (
        <div className={`nextcard ${select ? 'nextcard--tight' : ''}`.trim()}>
          <div className="nextcard__main">
            <img src={ICON_CONVERT} alt="" width="39" height="39" />
            <div className="nextcard__body">
              <p className="nextcard__text">{select ? 'Wish to convert one of the creatives to video?' : 'Wish to convert this creative to video?'}</p>
              {select && !imageUrl && <p className="nextcard__error" role="status">{selectHint}</p>}
            </div>
          </div>
          <button type="button" className="nextcard__link" disabled={!ok} onClick={() => go('convert')}><span>Convert now</span><img src={ICON_ARROW} alt="" width="24" height="24" /></button>
        </div>
      )}
      {failed && <p className="nextcard__error" role="alert">We couldn’t hand your creative over. Try again.</p>}
    </div>
  );
}
