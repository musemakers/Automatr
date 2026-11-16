#!/bin/bash
set -euo pipefail
APP_DIR=/var/www/automatr
ENV_SRC=/etc/automatr/server.env
cd "$APP_DIR"

# 1. Server env lives on the instance (not in git) - copy it in on every deploy
[ -s "$ENV_SRC" ] || { echo "ERROR: $ENV_SRC missing or empty"; exit 1; }
install -m 600 -o ec2-user -g ec2-user "$ENV_SRC" server/.env

# 2. Client must call the API same-origin (/api)
rm -f client/.env client/.env.local client/.env.production

chown -R ec2-user:ec2-user "$APP_DIR"

# 3. Nginx site (move the stock default server off :80)
sed -i -E 's/listen(\s+)(\[::\]:)?80 default_server;/listen\1\28080;/' /etc/nginx/nginx.conf
install -m 644 deploy/nginx/automatr.conf /etc/nginx/conf.d/automatr.conf
nginx -t && systemctl reload nginx

# 4. Install + build as ec2-user
sudo -u ec2-user -H bash -lc "cd $APP_DIR/server && npm ci --omit=dev --no-audit --no-fund"
sudo -u ec2-user -H bash -lc "cd $APP_DIR/client && npm ci --no-audit --no-fund && npm run build"
