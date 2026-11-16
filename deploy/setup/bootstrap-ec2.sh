#!/bin/bash
# One-time EC2 setup (Amazon Linux 2023). Run as root:  sudo bash bootstrap-ec2.sh
set -euo pipefail
REGION=ap-south-1

dnf -y update
dnf -y install nginx git ruby wget amazon-cloudwatch-agent

# Node.js 20 LTS + PM2
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf -y install nodejs
npm install -g pm2
sudo -u ec2-user -H bash -lc "pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 14"
env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user

# CodeDeploy agent
cd /tmp && wget -q https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install
chmod +x install && ./install auto
systemctl enable --now codedeploy-agent

# 2 GB swap (vite build + ffmpeg headroom on t3.medium)
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 && chmod 600 /swapfile
  mkswap /swapfile && swapon /swapfile && echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

# Persistent media volume (attached as /dev/sdf) -> /data  (uploads + backups)
DATA_DEV=$(readlink -f /dev/sdf || true)
if [ -n "$DATA_DEV" ] && [ -b "$DATA_DEV" ]; then
  blkid "$DATA_DEV" >/dev/null || mkfs.xfs "$DATA_DEV"
  mkdir -p /data
  UUID=$(blkid -s UUID -o value "$DATA_DEV")
  grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data xfs defaults,nofail 0 2" >> /etc/fstab
  mount -a
  mkdir -p /data/uploads /data/backups && chown -R ec2-user:ec2-user /data
else
  echo "WARNING: /dev/sdf not found - /data NOT mounted"
fi

mkdir -p /var/www/automatr && chown ec2-user:ec2-user /var/www/automatr
systemctl enable --now nginx
echo "Bootstrap done: $(node -v), pm2 $(pm2 -v), $(systemctl is-active codedeploy-agent) codedeploy-agent"
