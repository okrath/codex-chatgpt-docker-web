# Container runtime for codex-chatgpt-web: the Responses bridge plus a Docker-hosted
# Chromium replaces both the desktop launcher and the system Chrome install.
FROM oven/bun:1.3.14-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    x11-utils \
    novnc \
    websockify \
    socat \
    curl \
    ca-certificates \
    procps \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# The runtime spawns this executable for both the sign-in window and Playwright model
# turns. Running as root inside the container requires --no-sandbox; container isolation
# is the sandbox boundary here.
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"\n' \
      > /usr/local/bin/chromium-no-sandbox \
  && chmod +x /usr/local/bin/chromium-no-sandbox

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# Terminal-style CLI so `docker compose exec <service> codex-chatgpt-web <command>` works.
RUN printf '#!/bin/sh\nexec bun /app/src/cli.ts "$@"\n' > /usr/local/bin/codex-chatgpt-web \
  && chmod +x /usr/local/bin/codex-chatgpt-web

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

# XDG state must live inside the persistent app-home volume: the tunnel-client
# keeps its runtime alias registry and health files there, and they must survive
# container recreation.
ENV DISPLAY=:99 \
    CODEX_CHATGPT_WEB_EXTERNAL_SUPERVISOR=1 \
    CODEX_HOME=/data/codex \
    XDG_STATE_HOME=/root/.codex-chatgpt-web/xdg-state

# 8300: externally reachable forwarder to the loopback-only Responses bridge.
# 7900: noVNC page used to watch the Chromium screen and complete ChatGPT sign-in.
EXPOSE 8300 7900

ENTRYPOINT ["entrypoint.sh"]
