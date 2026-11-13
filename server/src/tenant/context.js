import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request "which customer is this?" context. requireAuth (middleware/auth.js)
// opens it for every authenticated request; everything downstream - Mongoose
// queries (tenantPlugin), per-customer settings (appSettingsService), file
// storage (utils/storage.js) - reads it from here, so service code never has to
// thread a customerId through dozens of function signatures.
//
//   store = { customerId: string|null, customer: CustomerDoc|null, all: boolean }
//
// customerId === null with a store present means "deliberately unscoped"
// (agency admin viewing every customer, or startup/migration code).
// NO store at all means the code ran outside any request - the tenant plugin
// warns loudly about that (or throws when TENANT_STRICT=true).
const als = new AsyncLocalStorage();

export function runWithTenant(store, fn) {
  return als.run(store, fn);
}

/** Run code deliberately across every customer (admin roll-ups, migrations, boot tasks). */
export function unscoped(fn) {
  return als.run({ customerId: null, customer: null, all: true }, fn);
}

export const getTenant = () => als.getStore() || null;
export const currentCustomerId = () => getTenant()?.customerId || null;
export const currentCustomer = () => getTenant()?.customer || null;
