#!/bin/bash
set -euo pipefail
APP_DIR=/var/www/automatr
APP_USER=ubuntu
ENV_SRC=/etc/automatr/server.env
cd "$APP_DIR"

# 1. Server env lives on the instance (not in git) - copy it in on every deploy
[ -s "$ENV_SRC" ] || { echo "ERROR: $ENV_SRC missing or empty"; exit 1; }
install -m 600 -o $APP_USER -g $APP_USER "$ENV_SRC" server/.env

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
