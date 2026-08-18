#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:99
export APP_PORT=3001
export VNC_PORT=5900
export NOVNC_PORT=6080

if [ -z "${VNC_PASSWORD:-}" ]; then
  export VNC_PASSWORD="$(openssl rand -hex 6)"
fi

mkdir -p /tmp/vnc /var/log/nginx
echo "Starting Railway browser service..."
echo "Railway PORT=${PORT:-unset}"
echo "Node APP_PORT=$APP_PORT"

# Create a password file for x11vnc.
x11vnc -storepasswd "$VNC_PASSWORD" /tmp/vnc/passwd >/dev/null

# Virtual desktop + tiny window manager.
Xvfb :99 -screen 0 1440x1000x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
sleep 1
fluxbox >/tmp/fluxbox.log 2>&1 &

# VNC server bound only inside container.
x11vnc \
  -display :99 \
  -rfbport "$VNC_PORT" \
  -rfbauth /tmp/vnc/passwd \
  -forever -shared -noxdamage -repeat \
  >/tmp/x11vnc.log 2>&1 &

# noVNC + WebSocket proxy.
websockify \
  --web=/usr/share/novnc/ \
  "$NOVNC_PORT" localhost:"$VNC_PORT" \
  >/tmp/novnc.log 2>&1 &

# Node app.
node src/index.js >/tmp/node.log 2>&1 &

# Railway exposes $PORT. Nginx proxies app + noVNC through it.
export PORT="${PORT:-8080}"
envsubst '${PORT}' < /app/nginx.conf.template > /etc/nginx/nginx.conf

echo "Temporary VNC password: $VNC_PASSWORD"
echo "Node app: $APP_PORT | noVNC: $NOVNC_PORT | public: $PORT"

exec nginx -g 'daemon off;'
