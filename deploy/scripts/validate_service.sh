#!/bin/bash
# Wait up to ~150s for the API (DB connect + seeding runs before listen)
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5050/api/health >/dev/null; then echo "Health check OK"; exit 0; fi
  sleep 5
done
echo "Health check FAILED"; sudo -u ec2-user -H bash -lc "pm2 logs automatr --lines 80 --nostream" || true
exit 1
