import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../styles/search.css';

// The search icon in the top bar (and in every flow's step bar). Tapping it opens a search box right beside the icon;
// pressing Enter (or typing, once you are already on the results page) shows the matching documents in the main area.
export default function SearchControl() {
  const navigate = useNavigate();
  const location = useLocation();
  const onResults = location.pathname === '/search';
  const urlQ = onResults ? new URLSearchParams(location.search).get('q') || '' : '';
  const [open, setOpen] = useState(onResults);
  const [value, setValue] = useState(urlQ);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(q, replace = false) {
    const t = q.trim();
    navigate(t ? `/search?q=${encodeURIComponent(t)}` : '/search', { replace });
  }

  function onChange(e) {
    const v = e.target.value;
    setValue(v);
    // Live results while typing, but only once the results page is already open - never pull someone out of a flow mid-word.
    if (onResults) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => go(v, true), 250);
    }
  }

  function close() {
    clearTimeout(timer.current);
    setOpen(false);
    setValue('');
  }

  return (
    <div className={`searchctl${open ? ' searchctl--open' : ''}`}>
      {open && (
        <form
          className="searchctl__box"
          role="search"
          onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); go(value, onResults); }}
        >
          <input
            ref={inputRef}
            type="search"
            className="searchctl__input"
            placeholder="Search copy, brief, headline…"
            aria-label="Search your creatives"
            value={value}
            onChange={onChange}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          />
          <button type="button" className="searchctl__close" aria-label="Close search" onClick={close}>✕</button>
        </form>
      )}
      <button type="button" className="icon-btn" aria-label="Search" aria-expanded={open} onClick={() => (open ? (value.trim() ? go(value, onResults) : close()) : setOpen(true))}>
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m20 20-3.6-3.6" /></svg>
      </button>
    </div>
  );
}
