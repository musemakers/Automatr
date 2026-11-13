import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  define: {
    // Baked into the bundle at build time - __BUILD_TIME__ in particular
    // changes on every single build regardless of whether anyone remembers
    // to bump the version number, so it's the reliable "did this actually
    // get rebuilt" signal. See src/version.js / Sidebar.jsx footer.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  }
});
