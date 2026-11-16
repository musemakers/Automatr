#!/bin/bash
set -euo pipefail
sudo -u ec2-user -H bash -lc "cd /var/www/automatr && pm2 startOrReload deploy/ecosystem.config.cjs --update-env && pm2 save"
