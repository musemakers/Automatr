import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import BrandLogo from './BrandLogo.jsx';
import { APP_VERSION, BUILD_TIME, formattedBuildTime } from '../version.js';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 11 12 4l8 7M6 10v9h5v-6h2v6h5v-9" /> },
  { to: '/generate', label: 'Generate Media', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3M12 18v3M4.5 12h3M16.5 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" /> },
  { to: '/posts/in-progress', label: 'In Progress', icon: <><circle cx="12" cy="12" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" /></> },
  { to: '/posts/completed', label: 'Completed', icon: <><circle cx="12" cy="12" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.3 2.4 2.4 4.6-5" /></> },
  { to: '/usage', label: 'Usage', icon: <><path strokeLinecap="round" strokeLinejoin="round" d="M5 20V11M12 20V5M19 20v-7" /></> },
  { to: '/news', label: 'Industry News', icon: <><rect x="4" y="12" width="3" height="8" rx="0.5" /><rect x="10.5" y="8" width="3" height="12" rx="0.5" /><rect x="17" y="4" width="3" height="16" rx="0.5" /></> }
];

export default function Sidebar({ isOpen = false, onClose }) {
  const { user, customer, isAgency, isStaff, logout } = useAuth();
  const initials = (user?.name || '')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '—';

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`.trim()}>
      <div className="brand">
        <Link to="/dashboard" onClick={onClose} aria-label="AUTOMATr home" title="Home" style={{ display: 'inline-flex' }}>
          <BrandLogo />
        </Link>
      </div>

      {/* A customer's own people see which workspace they are in. The super admin does not work inside a customer's workspace, so nothing is shown. */}
      {customer && !isAgency && (
        <div className="nav-group" style={{ paddingBottom: 0 }}>
          <p className="nav-label">Customer</p>
          <p style={{ color: '#E6E8F2', fontSize: 13.5, fontWeight: 500, padding: '0 12px' }}>{customer.name}</p>
        </div>
      )}

      <div className="nav-group">
        <p className="nav-label">Workspace</p>
        {NAV_ITEMS.filter((item) => !item.agencyOnly || isAgency).map((item) => item.inert ? (
          <a
            key={item.to}
            href={item.to}
            className="nav-item nav-item--inert"
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
          >
            <svg viewBox="0 0 24 24">{item.icon}</svg>
            {item.label}
          </a>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            state={item.to === '/generate' ? { home: true } : undefined}
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24">{item.icon}</svg>
            {item.label}
          </NavLink>
        ))}
      </div>

      {isStaff && (
        <div className="nav-group">
          <p className="nav-label">Admin</p>
          {isAgency && (
            <NavLink
              to="/admin/customers"
              onClick={onClose}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
            >
              <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></svg>
              Customers
            </NavLink>
          )}
          {isAgency && (
          <NavLink
            to="/admin/workspace"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
            Workspace &amp; Delivery
          </NavLink>
          )}
          <NavLink
            to="/admin/users"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            Users &amp; Access
          </NavLink>
          {isAgency && (
          <NavLink
            to="/admin/industries"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><rect x="4" y="12" width="3" height="8" rx="0.5" /><rect x="10.5" y="8" width="3" height="12" rx="0.5" /><rect x="17" y="4" width="3" height="16" rx="0.5" /></svg>
            Industry Segments
          </NavLink>
          )}
          {isAgency && (
          <NavLink
            to="/admin/ai-settings"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
            AI Settings
          </NavLink>
          )}
          {isAgency && (<>
          <NavLink
            to="/admin/ai-blocks"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="4" width="7" height="6" rx="1.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M10 7h4M6.5 10v4a2 2 0 0 0 2 2H14" /></svg>
            AI Blocks
          </NavLink>
          <NavLink
            to="/admin/brief-studio"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" /></svg>
            Brief Studio
          </NavLink>
          <NavLink
            to="/admin/ai-usage"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 15l4-6 4 4 5-8" /></svg>
            AI Usage
          </NavLink>
          <NavLink
            to="/admin/email-templates"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" /></svg>
            Email Templates
          </NavLink>
          <NavLink
            to="/admin/usage-estimator"
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`.trim()}
          >
            <svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M16 11v6" /></svg>
            Usage Estimator
          </NavLink>
          </>)}
        </div>
      )}

      <div className="sidebar__footer">
        <span className="avatar">{initials}</span>
        <div>
          <p>{user?.name || 'Guest'}</p>
          <p>
            {isAgency ? 'Agency admin' : user?.role === 'customerAdmin' ? 'Customer admin' : 'Member'}
            {!isAgency && customer?.name ? ` · ${customer.name}` : ''}
          </p>
        </div>
        {isAgency && (
          <NavLink
            to="/settings"
            onClick={onClose}
            className="icon-btn"
            style={{ marginLeft: 'auto', background: 'transparent', borderColor: '#1D212E' }}
            aria-label="Account settings"
            title="Account settings"
          >
            <svg viewBox="0 0 24 24" style={{ stroke: '#C7CBDA' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.09-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.09 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </NavLink>
        )}
        <button
          className="icon-btn"
          style={{ background: 'transparent', borderColor: '#1D212E', ...(isAgency ? {} : { marginLeft: 'auto' }) }}
          aria-label="Log out"
          onClick={logout}
          title="Log out"
        >
          <svg viewBox="0 0 24 24" style={{ stroke: '#C7CBDA' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1M10 12h10m0 0-3-3m3 3-3 3" />
          </svg>
        </button>
      </div>

      <p className="sidebar__version" title={BUILD_TIME ? `Built ${BUILD_TIME}` : 'Development build'}>
        v{APP_VERSION} · {formattedBuildTime()}
      </p>
    </aside>
  );
}
