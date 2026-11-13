export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  const body = { error: err.message || 'Something went wrong on the server.' };
  // Set by utils/classifyAiError.js when a provider call failed because of
  // an out-of-credits/quota issue - lets the client show a direct "Add
  // credits" link to that provider's billing page instead of a dead end.
  if (err.isBillingError) {
    body.isBillingError = true;
    body.billingProvider = err.billingProvider;
    body.billingProviderLabel = err.billingProviderLabel;
    body.billingUrl = err.billingUrl;
  }
  res.status(status).json(body);
}
