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

**Restarting or rebuilding kills every in-flight turn.** The turn broker holds its capability
tokens in two in-memory maps and never persists them, so a restart leaves the model holding a
`turn_token` the new process has never seen; its next Codex Native call is refused. The broker
distinguishes this from a token it retired itself and says so, because the failure otherwise
reads to the model like a broken task. The Codex task is fine — one more message starts a new
turn with a valid token. Prefer restarting while no turn is running, and expect a rebuild
during an active task to interrupt it.

A refused token does not imply a restart, though. The model retypes those 37 characters into
every call, so an unknown token while this same process still holds a live turn is a corrupted
copy. Telling it to re-read the token was not enough — it retyped the same wrong value — so a
copy within two characters of the issued token is now bound to that turn whenever exactly one
turn is live, logged as `recoveredTypo=N`. Two live turns make the nearest match a guess that
could hand one turn's workspace authority to another, so exactness is required again there, and
`liveTurns` in the `broker claim received` line separates every reading.

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
budget, and every Codex turn must fit into one message. Every Luna turn drops harness-only
`## Rule:` sections from the compiled context (ClaudeKit-style bundles a Web model cannot
execute: skill routing tables, hook protocols, agent-team rules).

If the turn still exceeds the budget, the bridge first tries a **lossless** route:
multi-message preload (on by default) splits the turn into ordered earlier-context messages
plus a final task message, each inside the budget, delivered into the same chat so the model
accumulates the whole thread in its own window. User-authored `## Rule:` sections ride along
verbatim here, because preload runs before any condensing. Preload is capped at three parts
(`CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS`) because ChatGPT Free stops acknowledging after
roughly three rapid messages in one chat, and a failed delivery is retried once as a single
slimmed message, so it is never worse than the lossy route. Disable with
`CODEX_CHATGPT_WEB_LUNA_PRELOAD=off`. A 📨 line in the Codex trace reports the split.

Only when preload cannot apply does the bridge escalate with shrinking keep-windows until it
fits: (1) condense the remaining rule sections to their first paragraph, then (2) collapse
older history — removing it outright and replacing the whole span with a single marker
message, down toward just the current turn (recent messages and the in-flight round kept;
older developer contracts folded in only at the deepest step). Collapsing to one marker matters — a per-message placeholder
across hundreds of items would itself cost tens of thousands of tokens; a ~340k-token thread
compiles to ~10k. This keeps long, tool-heavy threads alive instead of dead-ending on "ran
out of room in the model's context window," and the
reported usage reflects the slimmed payload so Codex won't retire the thread. Slimming
applies only to the copy sent to the browser — files on disk are never modified and
native-model Codex usage is unaffected. A ✂️ commentary line appears in the Codex trace
whenever slimming rescued an over-budget turn; routine strips are logged to the daemon
console. Configure with `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (comma-separated section names,
`off` disables).

**Slimming is also what makes Codex's own subagents work on a free account.** Setup enables
Codex delegation (`multi_agent = true`, with `multi_agent_v2 = false` so the bridge can read
cross-backend task payloads), and each delegated subagent is a full Codex task with its own
turn, its own Temporary Chat, its own budget, and its own local tools. Measured live on Free:
one task delegated to two subagents produced three concurrent browser turns, and each
subagent turn arrived at about 32,100 tokens — over the ~28,000 limit — fitting only after
the harness-only rule sections (~3,900 tokens) were dropped. With slimming disabled, expect
delegated turns to be rejected outright.

## Full harness (MCP) in the container

Full mode is supported: setup bootstraps the tunnel profile (`tunnel-client runtimes
connect` → healthy → stop) and the container entrypoint then supervises a persistent
`tunnel-client run` — the same role launchd plays on macOS. The full seven-step flow, with
clickable links, lives in the README ("Full harness" section):

- Tunnels page: https://platform.openai.com/settings/organization/tunnels
- API keys page: https://platform.openai.com/settings/organization/api-keys
- ChatGPT connector settings: https://chatgpt.com/#settings/Plugins

In brief: create a Tunnel + runtime key, `tunnel key-import`, `setup --full --tunnel-id …`,
restart the container, then create the **Codex Native2** connector in ChatGPT Developer
mode (**Type:** Tunnel, **Authentication:** None, **Allow all actions**).
`tunnel start/stop/restart` are intentionally disabled inside the container — restart the
container instead; `tunnel status` and `doctor` report health.

Free accounts work: Developer mode and custom Tunnel connectors are available on the free
ChatGPT tier (verified). To create the connector: enable Developer mode under Settings →
Security and login, then Settings → Plugins → **Create connector** (top of the Plugins
panel) → Type Tunnel, select the tunnel, Authentication None, Name exactly `Codex Native2`,
then set Permissions to Allow all actions. The Plugins row should then read
`Codex Native2 — Connected · Allow all`.

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
