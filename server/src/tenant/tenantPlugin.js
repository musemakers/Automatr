import mongoose from 'mongoose';
import { getTenant } from './context.js';

// Mongoose plugin that makes a collection customer-scoped:
//  - adds a `customer` field
//  - every find/update/delete/count/aggregate is automatically filtered to the
//    current customer (from the AsyncLocalStorage tenant context)
//  - every new document is stamped with the current customer
// so one customer can never read or change another customer's rows, without each
// controller having to remember to filter.
//
// A query that already names `customer` explicitly is left alone (lets admin
// code ask for a specific customer). Running with NO tenant context at all is a
// bug (context lost) - it logs a warning, or throws if TENANT_STRICT=true.

const warned = new Set();
function noContext(modelName, op) {
  const msg = `[tenant] ${modelName}.${op} ran with no customer context - query is UNSCOPED`;
  if (process.env.TENANT_STRICT === 'true') throw new Error(msg);
  const key = `${modelName}.${op}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`${msg}. Wrap intentional cross-customer work in unscoped(); set TENANT_STRICT=true to make this an error.`);
  }
}

const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'countDocuments', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'distinct'
];

export default function tenantPlugin(schema) {
  schema.add({ customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true, default: null } });

  function scopeQuery() {
    if (typeof this.getFilter !== 'function') return; // document middleware variant
    const tenant = getTenant();
    if (!tenant) return noContext(this.model?.modelName, this.op);
    if (!tenant.customerId) return; // deliberately unscoped
    if (this.getFilter().customer === undefined) this.where({ customer: tenant.customerId });
  }
  for (const op of QUERY_OPS) schema.pre(op, scopeQuery);

  schema.pre('save', function stampCustomer(next) {
    if (this.isNew && !this.customer) {
      const tenant = getTenant();
      if (!tenant) noContext(this.constructor.modelName, 'save');
      else if (tenant.customerId) this.customer = tenant.customerId;
    }
    next();
  });

  schema.pre('insertMany', function stampMany(next, docs) {
    const tenant = getTenant();
    if (!tenant) noContext(this.modelName, 'insertMany');
    else if (tenant.customerId) for (const d of docs) if (!d.customer) d.customer = tenant.customerId;
    next();
  });

  schema.pre('aggregate', function scopeAggregate() {
    const tenant = getTenant();
    if (!tenant) return noContext(this.model()?.modelName, 'aggregate');
    if (!tenant.customerId) return;
    const pipeline = this.pipeline();
    // $geoNear must stay first; none of our pipelines use it, but be safe.
    const at = pipeline.length && pipeline[0].$geoNear ? 1 : 0;
    pipeline.splice(at, 0, { $match: { customer: new mongoose.Types.ObjectId(String(tenant.customerId)) } });
  });
}
