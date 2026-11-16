#!/bin/bash
# One-time EC2 setup (Ubuntu 24.04) - used as EC2 user-data, or run: sudo bash bootstrap-ec2.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
REGION=ap-south-1
APP_USER=ubuntu

apt-get update -y
apt-get upgrade -y
apt-get install -y nginx git ruby-full wget curl unzip ca-certificates

# Node.js 20 LTS + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
sudo -u $APP_USER -H bash -lc "pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 14"
env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER

# CodeDeploy agent
cd /tmp && wget -q https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install
chmod +x install && ./install auto
systemctl enable --now codedeploy-agent

# CloudWatch agent
wget -q https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -O /tmp/cwagent.deb
dpkg -i -E /tmp/cwagent.deb

# AWS CLI v2 (not preinstalled on Ubuntu)
if ! command -v aws >/dev/null; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install
fi

# 2 GB swap (vite build + ffmpeg headroom on t3.medium)
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile
  mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Persistent media volume -> /data (the extra EBS disk: any whole disk that is not the root disk)
ROOT_DISK=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")
DATA_DEV=$(lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | grep -v "/dev/${ROOT_DISK}$" | head -1 || true)
if [ -n "$DATA_DEV" ]; then
  blkid "$DATA_DEV" >/dev/null || mkfs.ext4 -L automatr-data "$DATA_DEV"
  mkdir -p /data
  UUID=$(blkid -s UUID -o value "$DATA_DEV")
  grep -q "$UUID" /etc/fstab || echo "UUID=$UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
  mount -a
  mkdir -p /data/uploads /data/backups && chown -R $APP_USER:$APP_USER /data
else
  echo "WARNING: no data volume found - /data NOT mounted"
fi

mkdir -p /var/www/automatr && chown $APP_USER:$APP_USER /var/www/automatr
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx
echo "Bootstrap done: $(node -v), pm2 $(pm2 -v), codedeploy-agent $(systemctl is-active codedeploy-agent), data=${DATA_DEV:-none}"
