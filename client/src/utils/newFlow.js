// True for the New Creative journey (the one with the seven-step bar). Quick fixes, Creative Adaptation and
// custom features have their own step sets.
export function isNewFlow(post) {
  const t = post?.creativeType;
  if (!t) return true;
  if (typeof t === 'string' && t.startsWith('custom:')) return false;
  return !['adaptation', 'headline', 'hero', 'resize', 'convert'].includes(t);
}
export const newFlowProp = (post) => (isNewFlow(post) ? 'new' : undefined);
