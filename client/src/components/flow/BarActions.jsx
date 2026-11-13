import React from 'react';
import SearchControl from '../SearchControl.jsx';

/** Right-hand end of the flow bar: mobile menu button, search and notifications (same icons as the Topbar). */
export default function BarActions({ onMenuClick }) {
  return (
    <>
      <button type="button" className="menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="topbar__actions stepbar__actions">
        <SearchControl />
        <button type="button" className="icon-btn" aria-label="Notifications">
          <svg viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" />
            <path strokeLinecap="round" d="M10 19a2 2 0 0 0 4 0" />
          </svg>
        </button>
      </div>
    </>
  );
}
