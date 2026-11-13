import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import '../../styles/brand-profile.css';

// The page wrapper (.bpx scopes the reference prototype's brand styles), plus the prototype's toast and confirm dialog.
const Ctx = createContext(null);
export const useBrandUi = () => useContext(Ctx);

export function BrandUiProvider({ children }) {
  const [toastState, setToastState] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const timer = useRef(null);
  const dlg = useRef(null);

  const toast = useCallback((msg, actLabel, act) => {
    setToastState({ msg, actLabel, act });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastState(null), actLabel ? 7000 : 3200);
  }, []);
  const confirmDlg = useCallback((title, text, okLabel, onOk) => setConfirm({ title, text, okLabel, onOk }), []);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const d = dlg.current;
    if (confirm && d && !d.open) { d.returnValue = ''; try { d.showModal(); } catch { /* already open */ } }
  }, [confirm]);

  return (
    <Ctx.Provider value={{ toast, confirmDlg }}>
      <div className="bpx">
        {children}
        <dialog
          ref={dlg}
          className="bk-confirm"
          aria-labelledby="bk-confirm-title"
          onClose={() => { const c = confirm; const ok = dlg.current && dlg.current.returnValue === 'ok'; setConfirm(null); if (ok && c) c.onOk(); }}
        >
          <form method="dialog">
            <h3 id="bk-confirm-title">{confirm?.title}</h3>
            <p>{confirm?.text}</p>
            <div className="bk-confirm__row">
              <button className="bp-btn bp-btn--outline" value="cancel">Cancel</button>
              <button className="bp-btn bp-btn--primary" value="ok"><span>{confirm?.okLabel || 'Confirm'}</span></button>
            </div>
          </form>
        </dialog>
        {toastState && (
          <div className="bk-toast" role="status" aria-live="polite">
            <span>{toastState.msg}</span>
            {toastState.actLabel && <button type="button" onClick={() => { setToastState(null); toastState.act && toastState.act(); }}>{toastState.actLabel}</button>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
