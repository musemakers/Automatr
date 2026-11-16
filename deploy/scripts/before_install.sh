#!/bin/bash
set -euo pipefail
mkdir -p /var/www/automatr
# Remove previous build output so stale files never survive a deploy (uploads live on /data, not here)
rm -rf /var/www/automatr/client/dist
