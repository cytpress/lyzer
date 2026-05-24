#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-lyzer}"
APP_DIR="${APP_DIR:-/opt/lyzer}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Repo dir: $REPO_DIR"
echo "App dir:  $APP_DIR"
echo "App user: $APP_USER"

echo "Installing systemd units..."
for unit in "$REPO_DIR"/ops/systemd/lyzer-*; do
  unit_name="$(basename "$unit")"
  sed \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    "$unit" > "/tmp/$unit_name"
  install -m 644 "/tmp/$unit_name" "/etc/systemd/system/$unit_name"
  rm -f "/tmp/$unit_name"
done

echo "Installing scripts..."
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/scripts"
install -m 755 -o "$APP_USER" -g "$APP_USER" "$REPO_DIR"/scripts/lyzer-*.sh "$APP_DIR/scripts/"

if [ ! -f "$APP_DIR/.env.scheduler" ]; then
  echo "Creating .env.scheduler from example..."
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$REPO_DIR"/.env.scheduler.example "$APP_DIR/.env.scheduler"
else
  echo ".env.scheduler already exists; keeping existing file."
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env.scheduler"
  chmod 600 "$APP_DIR/.env.scheduler"
fi

echo "Reloading systemd..."
systemctl daemon-reload

echo "Enabling timers..."
systemctl enable --now \
  lyzer-fetch.timer \
  lyzer-analyze.timer \
  lyzer-deploy-check.timer

echo "Current timers:"
systemctl list-timers --all 'lyzer-*'

echo "Done."
