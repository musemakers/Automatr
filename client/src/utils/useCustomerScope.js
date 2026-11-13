import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '../api/resources.js';
import { setCustomerScope, clearCustomerScope, apiErrorMessage } from '../api/client.js';

// Super admin: look at ONE customer (brand assets, gallery) without switching into their workspace.
// Every request made while the page is open is sent for that customer; the session and the saved workspace stay as they were.
// Returns that customer's own { user, customer } (the brand kit lives on `user.brandKit`) once loaded.
export function useCustomerScope(customerId) {
  const tokenRef = useRef(null);
  // Set while rendering so the page's very first requests (made in child effects) already carry the customer.
  if (tokenRef.current === null) tokenRef.current = setCustomerScope(customerId);

  const [state, setState] = useState({ user: null, customer: null, error: '' });

  useEffect(() => {
    tokenRef.current = setCustomerScope(customerId);
    const token = tokenRef.current;
    let alive = true;
    setState({ user: null, customer: null, error: '' });
    authApi.me()
      .then((d) => { if (alive) setState({ user: d.user, customer: d.customer, error: '' }); })
      .catch((e) => { if (alive) setState({ user: null, customer: null, error: apiErrorMessage(e) }); });
    return () => { alive = false; clearCustomerScope(token); };
  }, [customerId]);

  const setUser = useCallback((u) => setState((s) => ({ ...s, user: typeof u === 'function' ? u(s.user) : u })), []);
  return { ...state, setUser, ready: Boolean(state.customer) };
}
