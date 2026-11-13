import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/* "Pause your work?" - confirmation shown when someone leaves a flow through the left panel or a Back button.
 *
 *   useLeaveGuard(hasProgress)   call inside an editor/page; true while there is work worth confirming about
 *   <LeaveGuardHost />           rendered once (Layout does it); owns the modal and the click interception
 *   data-leave-guard             put this attribute on a Back button (or any button/link) to have it confirm first
 *
 * react-router v6 here is a plain BrowserRouter (no data router, so no useBlocker). The host therefore listens for
 * clicks in the capture phase, swallows the click while progress exists and, if the person chooses "Leave page",
 * re-fires the very same click with the guard bypassed - so NavLink state, onClick handlers etc. all behave as normal.
 */

let hasProgress = false;
const listeners = new Set();
function setProgress(v) {
  if (hasProgress === v) return;
  hasProgress = v;
  listeners.forEach((l) => l());
}
function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
const getSnapshot = () => hasProgress;

export function useLeaveGuard(progress) {
  useEffect(() => {
    setProgress(Boolean(progress));
  }, [progress]);
  useEffect(() => () => setProgress(false), []);
}

function guardedTarget(e) {
  const t = e.target;
  if (!t || !t.closest) return null;
  const marked = t.closest('[data-leave-guard]');
  if (marked) return marked;
  const a = t.closest('.sidebar a[href]');
  if (a && a.getAttribute('aria-disabled') !== 'true') return a;
  return null;
}

export function LeaveGuardHost() {
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [open, setOpen] = useState(false);
  const dlgRef = useRef(null);
  const pending = useRef(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (!progress) return undefined;
    function onClick(e) {
      if (bypass.current || e.defaultPrevented || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = guardedTarget(e);
      if (!el || (el.tagName === 'A' && el.getAttribute('target') === '_blank')) return;
      e.preventDefault();
      e.stopPropagation();
      pending.current = el;
      setOpen(true);
    }
    function onUnload(e) { e.preventDefault(); e.returnValue = ''; }
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [progress]);

  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); d.querySelector('[data-stay]')?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);

  function leave() {
    const el = pending.current;
    pending.current = null;
    setOpen(false);
    if (!el) return;
    bypass.current = true;
    try { el.click(); } finally { bypass.current = false; }
  }

  return (
    <dialog ref={dlgRef} className="leave-guard" aria-labelledby="leave-guard-title" onCancel={(e) => { e.preventDefault(); setOpen(false); }}>
      <h2 className="leave-guard__title" id="leave-guard-title">Pause your work?</h2>
      <p className="leave-guard__text">Your work so far will be saved under <strong>In Progress</strong> in the left panel, so you can pick it up where you left off.</p>
      <div className="leave-guard__actions">
        <button type="button" className="leave-guard__link" onClick={leave}>Leave page</button>
        <button type="button" className="btn btn-primary" data-stay onClick={() => setOpen(false)}>Stay on page</button>
      </div>
    </dialog>
  );
}
