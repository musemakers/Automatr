import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Two admin levels. Default: agency admin OR the customer's own admin (their team, models,
// delivery). With `agencyOnly`: the agency's own staff only (customers, usage/spend, pricing).
export default function AdminRoute({ children, agencyOnly = false }) {
  const { user, loading, isAgency, isStaff } = useAuth();

  if (loading) return <div className="empty-state">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (agencyOnly ? !isAgency : !isStaff) return <Navigate to="/dashboard" replace />;

  return children;
}
