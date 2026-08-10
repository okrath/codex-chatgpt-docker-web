#!/usr/bin/env bash
# Container entrypoint: starts the virtual display stack (Xvfb + x11vnc + noVNC),
# forwards the published bridge port to the loopback-only Responses server, runs
# first-boot setup (interactive ChatGPT sign-in through noVNC), then serves.
set -euo pipefail

: "${DISPLAY:=:99}"
: "${SCREEN_GEOMETRY:=1440x900x24}"
: "${VNC_PORT:=5900}"
: "${NOVNC_PORT:=7900}"
: "${BRIDGE_PORT:=17841}"
: "${PROXY_PORT:=8300}"
: "${CODEX_HOME:=/data/codex}"
: "${REPLACE_CODEX_ROUTE:=0}"

export DISPLAY CODEX_HOME
mkdir -p "$CODEX_HOME"

APP_HOME="${CODEX_CHATGPT_WEB_HOME:-$HOME/.codex-chatgpt-web}"
CONFIG_PATH="$APP_HOME/config.json"

echo "[docker] starting virtual display $DISPLAY (${SCREEN_GEOMETRY})"
Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp &

for _ in $(seq 1 100); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  echo "[docker] Xvfb did not become ready on $DISPLAY" >&2
  exit 1
fi

echo "[docker] starting x11vnc + noVNC on container port ${NOVNC_PORT}"
x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -localhost -forever -shared -nopw -quiet &
websockify --web=/usr/share/novnc "0.0.0.0:${NOVNC_PORT}" "localhost:${VNC_PORT}" >/dev/null 2>&1 &

# The Responses server intentionally binds 127.0.0.1 only. Docker port publishing
# arrives on the container's external interface, so forward it to loopback here.
echo "[docker] forwarding container port ${PROXY_PORT} -> 127.0.0.1:${BRIDGE_PORT}"
socat "TCP-LISTEN:${PROXY_PORT},fork,reuseaddr,bind=0.0.0.0" "TCP:127.0.0.1:${BRIDGE_PORT}" &

if [ ! -f "$CONFIG_PATH" ]; then
  cat <<BANNER

============================================================================
 First boot: ChatGPT sign-in required.

 1. Open the container screen in your browser:
      http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=scale
 2. A Chromium window is opening on the ChatGPT sign-in page.
    Sign in with your email/password or a login code.
    (Platform passkeys are NOT available inside the container.)
 3. Leave the window open; setup continues automatically once the
    Temporary Chat composer is visible. You have about 10 minutes.

 If this attempt times out the container restarts and tries again.
============================================================================

BANNER
  setup_args=(setup --browser-only
    --port "$BRIDGE_PORT"
    --chrome /usr/local/bin/chromium-no-sandbox
    --acknowledge-unofficial)
  if [ "$REPLACE_CODEX_ROUTE" = "1" ]; then
    setup_args+=(--replace-codex-route)
  fi
  bun /app/src/cli.ts "${setup_args[@]}"
  echo "[docker] setup complete; Codex config updated at $CODEX_HOME/config.toml"
  echo "[docker] restart the Codex app once so it picks up the new model route"
fi

# Full mode: supervise the OpenAI tunnel runtime the way launchd does on macOS
# (a persistent `tunnel-client run` with automatic restarts).
CONFIG_MODE=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_PATH','utf8')).mode)")
if [ "$CONFIG_MODE" = "full" ]; then
  { read -r TUNNEL_BIN; read -r TUNNEL_DIR; read -r TUNNEL_PROFILE; } < <(bun -e "
    const c = JSON.parse(require('fs').readFileSync('$CONFIG_PATH', 'utf8'));
    console.log(c.tunnel.binaryPath);
    console.log(c.tunnel.profileDir);
    console.log(c.tunnel.profileName);
  ")
  echo "[docker] supervising OpenAI tunnel runtime (profile ${TUNNEL_PROFILE})"
  (
    while true; do
      "$TUNNEL_BIN" run --profile-dir "$TUNNEL_DIR" --profile "$TUNNEL_PROFILE" \
        || echo "[docker] tunnel runtime exited with status $?"
      echo "[docker] restarting tunnel runtime in 10s"
      sleep 10
    done
  ) &
fi

echo "[docker] starting Responses bridge on 127.0.0.1:${BRIDGE_PORT} (published via ${PROXY_PORT})"
exec bun /app/src/cli.ts serve
