# Docker Chromium runtime

This fork runs the whole ChatGPT Web bridge — the Responses daemon **and** the browser —
inside one Docker container. Nothing is installed on the host machine except Docker and
Codex itself: no desktop launcher, no system Google Chrome, no Bun.

```text
Host                                   Docker container (linux/amd64)
┌─────────────────┐  http://127.0.0.1:17841/v1  ┌─────────────────────────────────────┐
│ Codex app / CLI │ ───────────────────────────▶│ socat :8300 ──▶ 127.0.0.1:17841     │
│                 │                             │ codex-chatgpt-web serve (Bun)       │
│ ~/.codex ───────┼── bind mount ──────────────▶│ /data/codex (route install target)  │
└─────────────────┘                             │ Playwright ──▶ Chromium (headed)    │
   your browser ──── http://localhost:7900 ────▶│ noVNC ◀─ x11vnc ◀─ Xvfb :99         │
                                                └─────────────────────────────────────┘
```

The upstream project offers two browser hosts: the Electron launcher (`launcher`) and a
terminal-managed Chrome (`managed-chrome`, previously macOS-only). The container uses the
`managed-chrome` path with the Debian `chromium` package, unlocked on Linux through the
`CODEX_CHATGPT_WEB_EXTERNAL_SUPERVISOR=1` environment variable: setup skips the launchd
service install and the container entrypoint supervises `serve` instead.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).
- Codex installed on the host (its config lives in `~/.codex`).
- A ChatGPT account you can sign in to with **email/password or an emailed login code**.
  Platform passkeys (Windows Hello, Touch ID) do not work inside the container.

## Quick start

```bash
docker compose up -d --build
docker compose logs -f codex-chatgpt-web
```

On first boot the log prints a sign-in banner. Then:

1. Open <http://localhost:7900/vnc.html?autoconnect=1&resize=scale> in your host browser.
2. Sign in to ChatGPT inside the Chromium window shown there (about a 10-minute window;
   on timeout the container restarts and opens a fresh sign-in window).
3. When the Temporary Chat composer becomes visible, setup captures the session,
   verifies it, installs the model route into `~/.codex/config.toml`, and starts serving.
4. Restart the Codex app once. The **ChatGPT Web — …** models appear in its model picker.

If `~/.codex/config.toml` already contains a custom or previously installed
`openai_base_url`, the first boot fails closed. Opt in to replacing it:

```bash
REPLACE_CODEX_ROUTE=1 docker compose up -d
```

(On Windows PowerShell: `$env:REPLACE_CODEX_ROUTE = "1"; docker compose up -d`.)

## Day-2 operations

Every CLI command from the upstream README is available inside the container:

```bash
# Health report
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor

# Refresh an expired ChatGPT login (sign in again through the noVNC page),
# then restart so the daemon reopens the browser with the new session state
docker compose exec codex-chatgpt-web codex-chatgpt-web login
docker compose restart codex-chatgpt-web

# Route management on the mounted host Codex config
docker compose exec codex-chatgpt-web codex-chatgpt-web route status
docker compose exec codex-chatgpt-web codex-chatgpt-web route disconnect
```

Model turns run headed inside the virtual display, so the noVNC page also lets you watch
every ChatGPT turn live — the same visibility the desktop launcher's embedded browser
provides.

## Storage layout

| Location | Contents | Lifetime |
| --- | --- | --- |
| named volume `codex-chatgpt-web-home` → `/root/.codex-chatgpt-web` | config.json, ChatGPT login state, logs, diagnostics | persists across rebuilds; `docker compose down -v` wipes it (forces a new sign-in) |
| bind mount `~/.codex` → `/data/codex` | the host Codex `config.toml` that setup patches | owned by the host |

## Fixed ports

The Responses server intentionally refuses to bind anything but `127.0.0.1`, and setup
writes `openai_base_url = "http://127.0.0.1:17841/v1"` into the Codex config. The container
therefore runs a `socat` forwarder (container port `8300` → container loopback `17841`) and
Compose publishes it back to the host as `127.0.0.1:17841`. Keep the host side of that port
mapping at `17841`; only the noVNC port is freely remappable.

## Luna context slimming (Free accounts)

ChatGPT Free rejects a single browser message above a measured ~28,000-token transport
budget, and every Codex turn must fit into one message. Every Luna turn therefore drops
harness-only `## Rule:` sections from the compiled context (ClaudeKit-style bundles a Web
model cannot execute: skill routing tables, hook protocols, agent-team rules). If the turn
still exceeds the budget, the remaining rule sections are condensed to their first
paragraph. Slimming applies only to the copy sent to the browser — files on disk are never
modified and native-model Codex usage is unaffected. A ✂️ commentary line appears in the
Codex trace whenever slimming rescued an over-budget turn; routine strips are logged to
the daemon console. Configure with `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (comma-separated
section names, `off` disables).

## Full harness (MCP) in the container

Full mode is supported: setup bootstraps the tunnel profile (`tunnel-client runtimes
connect` → healthy → stop) and the container entrypoint then supervises a persistent
`tunnel-client run` — the same role launchd plays on macOS. The flow is documented step
by step in the README ("Full harness" section): create a Tunnel + runtime key on the
OpenAI platform, `tunnel key-import`, `setup --full --tunnel-id …`, restart the
container, then create the **Codex Native2** connector in ChatGPT Developer Mode with
**Allow all actions**. `tunnel start/stop/restart` are intentionally disabled inside the
container — restart the container instead; `tunnel status` and `doctor` report health.

## Limitations

- **No passkeys.** The container has no platform authenticator; use password or
  email-code sign-in.
- **Sign-in challenges.** ChatGPT may show extra verification for a Linux/Chromium
  browser; complete them interactively in the noVNC window.

## Security notes

- Both published ports bind to the host's `127.0.0.1` only; nothing is exposed to the LAN.
- The noVNC page is unauthenticated — anyone who can reach the host loopback can view the
  browser screen. That matches the upstream threat model (the loopback Responses listener
  is equally reachable by local processes), but do not forward port 7900 off the machine.
- Chromium runs with `--no-sandbox` because the container process is root; the container
  boundary replaces the Chromium sandbox. Do not reuse this image outside Docker.
- The ChatGPT login state in the named volume is a sensitive credential artifact — treat
  the Docker volume like the upstream browser profile and never share it.
