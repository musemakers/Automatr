import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Mirrors the sidebar's top workspace destinations - kept to 5 so labels
// stay legible at mobile tab-bar width. Admin links stay drawer-only since
// they're a small audience and would crowd this bar.
const TABS = [
  { to: '/dashboard', label: 'Home', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 11 12 4l8 7M6 10v9h5v-6h2v6h5v-9" /> },
  { to: '/generate', label: 'Generate', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3M12 18v3M4.5 12h3M16.5 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" /> },
  { to: '/posts/completed', label: 'Creatives', icon: <><circle cx="12" cy="12" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.3 2.4 2.4 4.6-5" /></> },
  { to: '/news', label: 'News', icon: <><rect x="4" y="12" width="3" height="8" rx="0.5" /><rect x="10.5" y="8" width="3" height="12" rx="0.5" /><rect x="17" y="4" width="3" height="16" rx="0.5" /></> }
];

/**
 * Fixed bottom tab bar shown only on phone-width screens (see .bottom-nav in
 * theme.css) - the sidebar drawer still holds every destination (including
 * Admin), this is just a thumb-reachable shortcut to the 5 most-used ones so
 * switching sections doesn't require opening the hamburger every time.
 */
export default function BottomNav() {
  const { isAgency } = useAuth();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.filter((tab) => !tab.agencyOnly || isAgency).map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => `bottom-nav__item ${isActive ? 'active' : ''}`.trim()}
        >
          <svg viewBox="0 0 24 24">{tab.icon}</svg>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
