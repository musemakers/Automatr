#!/bin/bash
set -euo pipefail
APP_DIR=/var/www/automatr
APP_USER=ubuntu
cd "$APP_DIR"

# 1. Env lives in the app folder (gitignored, survives deploys) - just make sure it's there
[ -s server/.env ] || { echo "ERROR: $APP_DIR/server/.env missing - create it on the server first"; exit 1; }
chmod 600 server/.env

# 2. Client must call the API same-origin (/api)
rm -f client/.env client/.env.local client/.env.production

chown -R $APP_USER:$APP_USER "$APP_DIR"

# 3. Nginx site (Ubuntu: drop the stock default site, ours is default_server)
rm -f /etc/nginx/sites-enabled/default
install -m 644 deploy/nginx/automatr.conf /etc/nginx/conf.d/automatr.conf
nginx -t && systemctl reload nginx

# 4. Install + build as the app user
sudo -u $APP_USER -H bash -lc "cd $APP_DIR/server && npm ci --omit=dev --no-audit --no-fund"
sudo -u $APP_USER -H bash -lc "cd $APP_DIR/client && npm ci --no-audit --no-fund && npm run build"
