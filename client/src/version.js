// __APP_VERSION__ and __BUILD_TIME__ are injected at build time by
// vite.config.js (see the `define` block there) - __BUILD_TIME__ in
// particular is a real timestamp generated fresh on every `npm run build`,
// which is what makes it reliable for confirming a deploy actually updated
// (a manually-bumped version number can be forgotten; this can't be stale).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;

export function formattedBuildTime() {
  if (!BUILD_TIME) return 'dev build';
  return new Date(BUILD_TIME).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
