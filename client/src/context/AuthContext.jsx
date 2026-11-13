import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../api/resources.js';
import { CUSTOMER_KEY } from '../api/client.js';
import { setEnabledFeatures } from '../constants/postFormats.js';

const AuthContext = createContext(null);

// The server answers every auth call with { user, customer, customers }:
//   customer  - the workspace the session is in (brand, models, storage, delivery...)
//   customers - what the person may switch between (agency admins: all; everyone else: just theirs)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [viewOnly, setViewOnly] = useState(false); // agency admin looking at a customer's workspace: no creating
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((data) => {
    setEnabledFeatures(data.customer?.features); // before any screen renders, so the size picker already knows
    setUser(data.user);
    setCustomer(data.customer || null);
    setCustomers(data.customers || []);
    setViewOnly(Boolean(data.viewOnly));
    // Remember the workspace (agency admins pick it; for everyone else the server decides anyway).
    if (data.customer?.id || data.customer?._id) {
      try { localStorage.setItem(CUSTOMER_KEY, data.customer._id || data.customer.id); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('automatr_token');
    if (!token) {
      setLoading(false);
      return;
    }
    const fetchMe = () => authApi.me();
    fetchMe()
      .catch((err) => {
        // A remembered workspace that no longer exists (deleted/renamed) must not log the person out.
        const status = err?.response?.status;
        if ((status === 404 || status === 400) && localStorage.getItem(CUSTOMER_KEY)) {
          localStorage.removeItem(CUSTOMER_KEY);
          return fetchMe();
        }
        throw err;
      })
      .then(applySession)
      .catch(() => localStorage.removeItem('automatr_token'))
      .finally(() => setLoading(false));
  }, [applySession]);

  const login = useCallback(async (email, password) => {
    // Never carry one person's workspace choice over to the next login.
    localStorage.removeItem(CUSTOMER_KEY);
    const data = await authApi.login({ email, password });
    localStorage.setItem('automatr_token', data.token);
    applySession(data);
    return data.user;
  }, [applySession]);

  const register = useCallback(async (payload) => {
    localStorage.removeItem(CUSTOMER_KEY);
    const data = await authApi.register(payload);
    localStorage.setItem('automatr_token', data.token);
    applySession(data);
    return data.user;
  }, [applySession]);

  const logout = useCallback(() => {
    localStorage.removeItem('automatr_token');
    localStorage.removeItem(CUSTOMER_KEY);
    setUser(null);
    setCustomer(null);
    setCustomers([]);
    setViewOnly(false);
    setEnabledFeatures(null);
  }, []);

  // Agency admins only. Reloads so every page starts clean in the other customer's workspace
  // (nothing from the previous customer can linger in memory).
  const switchCustomer = useCallback((customerId, to = '/dashboard') => {
    try { localStorage.setItem(CUSTOMER_KEY, customerId); } catch { /* ignore */ }
    window.location.assign(to);
  }, []);

  // Agency admins only. Same as switchCustomer but without reloading the page: the workspace is switched in place and the
  // session is refreshed, so the caller can simply navigate afterwards.
  const openCustomer = useCallback(async (customerId) => {
    try { localStorage.setItem(CUSTOMER_KEY, customerId); } catch { /* ignore */ }
    const data = await authApi.me();
    applySession(data);
    return data;
  }, [applySession]);

  const refreshSession = useCallback(async () => {
    const data = await authApi.me();
    applySession(data);
    return data;
  }, [applySession]);

  const isAgency = user?.role === 'admin';
  const isStaff = user?.role === 'admin' || user?.role === 'customerAdmin';
  // Optional features the agency switched on for the workspace the session is in.
  const features = { billboards: Boolean(customer?.features?.billboards), multiSceneVideo: Boolean(customer?.features?.multiSceneVideo), designOptions: [1, 2, 3].includes(Number(customer?.features?.designOptions)) ? Number(customer.features.designOptions) : 1 };

  return (
    <AuthContext.Provider
      value={{ user, setUser, customer, customers, viewOnly, isAgency, isStaff, features, switchCustomer, openCustomer, refreshSession, loading, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
