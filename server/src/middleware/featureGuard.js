// Optional features are switched on per customer by the agency (Customer.features). Use after requireAuth.
// A workspace without the feature gets a plain 403, so a hidden option can't be reached by calling the API directly.
export const FEATURE_LABELS = { billboards: 'Billboards', multiSceneVideo: 'Multi-scene Video' };

export function requireFeature(key) {
  return (req, res, next) => {
    if (req.customer?.features?.[key]) return next();
    return res.status(403).json({ error: `${FEATURE_LABELS[key] || 'This feature'} is not enabled for this workspace. Ask your agency to switch it on.`, feature: key });
  };
}
