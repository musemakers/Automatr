import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // server/src
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));

export const APP_VERSION = pkg.version;

// The server has no build step (plain Node, unlike the client's Vite
// build), so there's no automatic "compiled at" timestamp to hook into.
// This is stamped by hand whenever a new update is packaged - update it
// alongside the version bump in package.json.
export const BUILD_DATE = '2026-07-20';
