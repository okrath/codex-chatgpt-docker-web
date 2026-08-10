<h1 align="center">ChatGPT Web for Codex — Docker Chromium</h1>

<p align="center">
  <strong>Use ChatGPT Web as native Codex models — with the whole runtime and browser inside Docker.</strong><br>
  Nothing is installed on the host machine except Docker and Codex.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/runtime-Docker-2496ed?logo=docker&logoColor=white" alt="Docker runtime">
  <img src="https://img.shields.io/badge/Free_AI-no_API_fees-10a37f" alt="Free AI with no API fees">
</p>

> [!NOTE]
> **This repository is a fork of [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).**
> All of the core bridge, browser automation, and Codex integration code comes from that
> project — full credit to its author. This fork only changes *how it is installed and
> run*: instead of the desktop launcher app plus a system Google Chrome install, everything
> runs inside one Docker container with a containerized Chromium.

## What it does

Codex keeps its native task, context lifecycle, UI, and model picker. A local Responses
bridge routes the selected model turn through a fresh ChatGPT Temporary Chat in a real
browser, attaches images, and streams visible reasoning and Markdown back into the same
Codex task — no model API key required.

```text
Codex task ──Responses + SSE──▶ bridge (in Docker) ──Chromium (in Docker)──▶ ChatGPT
     ▲                                                          │
     └───────── native UI, context, images, and streaming ──────┘
```

Free/Go accounts get **ChatGPT Web — Luna** in Codex's model picker; accounts with the
reasoning selector get **Instant**, **Medium**, **High**, **Extra High**, and **Pro** as
the subscription allows.

## Free ChatGPT accounts: what works and the one real limit

**Full mode works on a free ChatGPT account.** This is verified end-to-end: a free-tier
account enabled Developer mode, created the custom **Codex Native2** Tunnel connector, and
Luna successfully called local Codex tools (reading files in the workspace) through it — no
paid subscription required. Both browser-only mode and the full local-tool harness run on
free Luna.

**The one real constraint is the per-turn size limit, not a feature lock.** ChatGPT Free
enforces a measured **~28,000-token budget on each single browser message**, and every
Codex turn must be delivered as one message. This is a transport limit of the free web
tier — it is *not* Luna's model context window (which is ~1M tokens) and cannot be raised
from this project's side. What it means in practice:

- Small, focused tasks work well: short prompts, a handful of files, shallow histories.
- Long, tool-heavy threads keep working: the bridge automatically trims older tool results
  and history to fit (see **Luna context slimming** below), so a deep thread no longer
  dead-ends on *"ran out of room in the model's context window."* The trade-off is that the
  Web model stops seeing the full text of older tool output — it keeps the recent turns plus
  Luna's rolling checkpoint, so questions about details from many turns back are less
  reliable.
- A single turn can still overflow when its *irreducible* core is already too big — Codex's
  system prompt, the MCP tool contract (full mode), the current instruction, and one large
  freshly-read file must all fit within ~28k even after slimming. Full mode's tool contract
  makes each turn heavier, so headroom for your own content is smaller than in browser-only
  mode.
- If a turn still overflows after slimming, reduce it (trim `~/.codex/AGENTS.md`, start a
  fresh/short thread, work on fewer or smaller files at a time) or use a paid ChatGPT tier,
  whose web transport budget is substantially larger and unlocks
  Instant/Medium/High/Extra High.
- Bridge-side automation cannot start a new Codex thread for you (Codex owns threads; the
  bridge only answers turns) — but with automatic slimming you rarely need to. When Codex
  itself says to start a new thread, that is still the cleanest reset for a thread that has
  accumulated a very large history.

Check `docker compose logs codex-chatgpt-web` for the exact token numbers whenever a turn
is rejected.

## What this fork changes

Compared to upstream [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web):

- **Removed the host-install path — including its code.** The Electron launcher app
  (`launcher/`), the one-command installers, and the native packaging/release scripts were
  deleted from this repository. No desktop launcher, no system Google Chrome, no Bun on
  the host.
- **Full mode works in the container.** The macOS launchd supervision was replaced by the
  container entrypoint: setup bootstraps the tunnel profile and the entrypoint keeps
  `tunnel-client run` alive when the runtime is in full mode.
- **Added a Docker runtime** ([docker/Dockerfile](docker/Dockerfile),
  [docker/entrypoint.sh](docker/entrypoint.sh), [docker-compose.yml](docker-compose.yml)):
  Bun runtime + Debian Chromium + Xvfb virtual display + noVNC, in one container.
- **Sign-in and model turns happen in the container's Chromium.** You watch and control
  that browser from your own browser at `http://localhost:7900` (noVNC).
- **One small source change** in [src/setup.ts](src/setup.ts): upstream restricted the
  terminal-managed Chrome mode to macOS; this fork unlocks it on Linux when
  `CODEX_CHATGPT_WEB_EXTERNAL_SUPERVISOR=1` is set (the container supervises the `serve`
  process itself, so no launchd service is installed).
- **A `socat` forwarder inside the container** bridges Docker port publishing to the
  Responses server, which intentionally binds `127.0.0.1` only.
- **Luna context slimming.** ChatGPT Free rejects a single browser message above a
  measured ~28,000-token transport budget, and every Codex turn must fit into one message.
  Every Luna turn drops harness-only rule sections from the compiled context (ClaudeKit-style
  `## Rule:` bundles such as slash-command skill routing tables, hook protocols, and
  agent-team rules — instructions a Web model cannot execute). If the turn still exceeds the
  budget the bridge escalates, in order: **(1)** condense the remaining rule sections to
  their first paragraph, **(2)** trim older completed tool results (keeping the most recent
  ones and the in-flight round) to a short placeholder, and **(3)** as a last resort, elide
  older user/assistant history (developer contracts and recent messages are always kept).
  This keeps long, tool-heavy threads alive instead of dead-ending on
  *"ran out of room in the model's context window"* — the reported usage reflects the
  slimmed payload, so Codex won't retire a thread the transport still carries. Files on disk
  are never modified — slimming applies only to the copy sent to the browser, and normal
  Codex usage with native models is unaffected. A ✂️ line in the Codex trace reports the
  numbers whenever slimming rescued an over-budget turn; routine strips are logged in
  `docker compose logs`. Override the droppable section list with
  `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` (comma-separated names, or `off` to disable).

Everything else — selectors, streaming, compaction, model catalog, security checks — is
unchanged upstream code.

## Requirements

- Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux)
- Codex installed on the host (its config lives in `~/.codex`)
- A ChatGPT account you can sign in to with **email/password or an emailed login code**
  (platform passkeys such as Windows Hello do not work inside the container)

## How you use it (read this first)

```text
┌────────────── Your machine ───────────────┐   ┌──────── Docker container ────────┐
│                                           │   │                                  │
│  Codex app  ◀── you ASSIGN TASKS HERE ─┐  │   │  Responses bridge                │
│      │                                 │  │   │      │                           │
│      └── http://127.0.0.1:17841/v1 ────┼──┼──▶│      ▼                           │
│                                        │  │   │  Chromium on ChatGPT web         │
│  Your browser ── ONLY for signing in ──┼──┼──▶│  (visible through noVNC :7900)   │
│  http://localhost:7900                    │   │                                  │
└───────────────────────────────────────────┘   └──────────────────────────────────┘
```

- **Where do I assign tasks?** In the **Codex app**, exactly as before. Setup points
  Codex at the bridge via `openai_base_url` in `~/.codex/config.toml`; you just pick a
  **ChatGPT Web — …** model in Codex's model picker.
- **What is `localhost:7900` for?** Only two things: **signing in to ChatGPT** (first
  boot, or when the session expires after ~3 months) and **watching** the browser work
  if you are curious. You never type prompts into ChatGPT web yourself.
- **A black noVNC screen is normal.** It is an empty virtual desktop; a Chromium window
  only appears during sign-in or while Codex is running a turn.

## Install

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then follow the log:

```bash
docker compose logs -f codex-chatgpt-web
```

Wait for the `First boot: ChatGPT sign-in required` banner, then sign in (next section).

> If the log reports that `openai_base_url` already exists in your Codex config, a
> previous route is installed. Allow replacing it:
> `REPLACE_CODEX_ROUTE=1 docker compose up -d`
> (Windows PowerShell: `$env:REPLACE_CODEX_ROUTE = "1"; docker compose up -d`.)

## Sign in to ChatGPT (step by step)

1. Open <http://localhost:7900/vnc.html?autoconnect=1&resize=scale> in your browser.
   A Chromium window is already on the ChatGPT sign-in page. **Click once inside the
   page** so your keyboard and mouse control the remote screen.
2. Press **Log in** and use **email + password** or an **emailed login code**.
   - ❌ Passkeys/Windows Hello do not work inside the container.
   - ⚠️ Avoid **Continue with Google** — Google usually rejects container browsers as
     "not secure".
   - Passwords with special characters: the VNC keyboard is US-layout. Open the noVNC
     sidebar (small arrow on the left edge) → **clipboard** icon → paste the password
     there → click the password field on the remote screen → press `Ctrl+V`.
3. If Cloudflare shows **"Verify you are human"**, tick it inside the window.
4. After signing in, **do nothing else** — even if ChatGPT lands on its home page, the
   flow steers the window back to the Temporary Chat, captures and verifies the session,
   installs the model route into `~/.codex/config.toml`, closes the window, and starts
   the bridge. Do not close the Chromium window yourself.
5. The whole attempt has a ~10-minute window; on timeout the container restarts and
   opens a fresh sign-in window.

Success looks like this in the log:

```text
Setup complete: browser-only
[docker] setup complete; Codex config updated at /data/codex/config.toml
codex-chatgpt-web x.y.z listening on http://127.0.0.1:17841/v1 (browser-only)
```

Finally, **quit and reopen the Codex app once**, then pick a **ChatGPT Web — …** model:
Free/Go accounts get **Luna**; Plus/Pro accounts get **Instant** through **Extra High**
(and **Pro** when exposed). Model turns run headed inside the virtual display, so the
same noVNC page shows every ChatGPT turn live.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Black noVNC screen | Normal — no window is open | Nothing to do; windows appear during sign-in and turns |
| Google says the browser is not secure | Google blocks container browsers | Use email + password or an emailed login code |
| Cloudflare CAPTCHA repeats | Automation fingerprint | Tick it; if it loops more than ~3 times, `docker compose restart codex-chatgpt-web` and retry |
| Codex does not list ChatGPT Web models | Codex was not restarted after setup | Quit the Codex app fully and reopen it |
| Turns fail with missing/expired login state | The ChatGPT session expired (~3 months) | `docker compose exec codex-chatgpt-web codex-chatgpt-web login`, sign in via noVNC, then `docker compose restart codex-chatgpt-web` |
| Codex says it "ran out of room in the model's context window" on Luna | The compiled turn exceeds ChatGPT Free's ~28k-token per-message transport budget even after automatic slimming | Check `docker compose logs` for the exact numbers; trim global instructions (e.g. `~/.codex/AGENTS.md`), start a smaller task, or use a paid ChatGPT tier |
| Switch ChatGPT accounts | — | Same as above: run `login` with the new account, then restart |
| Start over completely | — | `docker compose exec codex-chatgpt-web codex-chatgpt-web route disconnect`, then `docker compose down -v`, then reinstall |

## Everyday commands

```bash
# Health report
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
```

```bash
# Refresh an expired ChatGPT login (sign in again via noVNC), then restart
docker compose exec codex-chatgpt-web codex-chatgpt-web login
```

```bash
docker compose restart codex-chatgpt-web
```

```bash
# Remove the model route from ~/.codex/config.toml
docker compose exec codex-chatgpt-web codex-chatgpt-web route disconnect
```

Full guide, storage layout, and port details: [docs/docker-chromium-setup.md](docs/docker-chromium-setup.md).

## Full harness (local tools over MCP)

Browser-only mode gives the Web model the compiled task context but no local tools. Full
mode connects ChatGPT's tool calls back into the active Codex task through the official
[openai/tunnel-client](https://github.com/openai/tunnel-client) (outbound only — no open
inbound port). All non-Pro Web models, including Luna, become tool-capable; Pro stays
read-only. Requires **ChatGPT Developer Mode** with a custom MCP connector — see the
account-tier caveat below before starting.

**Step 1 — Create a Tunnel.** Open the OpenAI platform Tunnels page and create one, then
copy its id (looks like `tunnel_...`):

  https://platform.openai.com/settings/organization/tunnels

**Step 2 — Create an API key** with Tunnels Read + Use permission:

  https://platform.openai.com/settings/organization/api-keys

Both are free to create and consume no model credits.

**Step 3 — Import the runtime key into the container** (paste the key at the hidden prompt):

```bash
docker compose exec -it codex-chatgpt-web codex-chatgpt-web tunnel key-import
```

**Step 4 — Switch the runtime to full mode** (reuses the stored ChatGPT login; replace the
id with your own from Step 1):

```bash
docker compose exec codex-chatgpt-web codex-chatgpt-web setup --full --tunnel-id tunnel_YOUR_ID --acknowledge-unofficial
```

**Step 5 — Restart so the container starts supervising the tunnel runtime:**

```bash
docker compose restart codex-chatgpt-web
```

**Step 6 — Create the ChatGPT connector.** This is done entirely in the ChatGPT web UI
(open it in the noVNC screen or your own browser):

  https://chatgpt.com/#settings/Plugins

  1. Enable **Developer mode** first: **Settings → Security and login → Developer mode**
     (flip the toggle on; it shows an "Elevated risk" label).
  2. Open **Settings → Plugins**. The **Create connector** control is at the **top of the
     Plugins panel** (not inside the "Developer mode" row) — click it there.
  3. Fill the form:
     - **Type / MCP server:** Tunnel — select the exact tunnel you created in Step 1
     - **Authentication:** None
     - **Name:** exactly `Codex Native2` (character-for-character)
  4. Save. Open the new connector and set **Permissions → Allow all actions**
     (**Allow low-risk actions** blocks commands and patches).
  5. Back on the Plugins panel the row should read **`Codex Native2 — Connected · Allow all`**,
     and typing `@` in a chat should list **Codex Native2**.

  Do not rename or reuse an older **Codex Native** connector.

**Step 7 — Restart the Codex app once** and start a new task. Check health any time with
`codex-chatgpt-web doctor` and `codex-chatgpt-web tunnel status` inside the container. The
tunnel takes ~15–30 seconds to come up after a container restart, so an immediate `doctor`
may briefly report "Tunnel runtime is not ready" — run it again. A healthy full-mode doctor
ends with `✓ Tunnel runtime reports healthy and ready`; the remaining connector notice is
informational (local checks cannot see ChatGPT settings).

> **Free accounts work.** Developer mode and custom Tunnel connectors are available on the
> free ChatGPT tier (verified: a free account created and connected `Codex Native2` with
> Allow all actions). If the connector does not appear in the `@` menu right after you
> create it, reopen the chat — it syncs within a few seconds. The error
> `connector menu opened but exposed no row named "Codex Native2"` simply means the
> connector was not created yet (or not named exactly `Codex Native2`).

To go back: `setup --browser-only --acknowledge-unofficial` and restart the container.

## Limitations
- **No passkeys.** Use password or email-code sign-in.
- **Fixed bridge port.** Setup writes `openai_base_url = "http://127.0.0.1:17841/v1"`
  into the Codex config, so the host side of the port mapping must stay `17841`.
- ChatGPT UI changes can break selectors; drift fails explicitly instead of silently
  switching model or transport (unchanged upstream behavior).

## Security notes

- Both published ports bind to the host's `127.0.0.1` only; nothing is exposed to the LAN.
- The noVNC page is unauthenticated — anyone with access to the host loopback can view
  the browser screen. Do not forward port 7900 off the machine.
- Chromium runs with `--no-sandbox` inside the container (required as root); the
  container boundary replaces the Chromium sandbox.
- The ChatGPT login state in the `codex-chatgpt-web-home` Docker volume is a sensitive
  credential artifact. Never share it; `docker compose down -v` wipes it.

Temporary Chat is a ChatGPT privacy mode, not anonymity or local-only inference: prompts
are still processed by OpenAI under the account's settings and OpenAI's
[Temporary Chat policy](https://help.openai.com/en/articles/8914046-temporary-chat-faq).

## Documentation

- [Hướng dẫn tiếng Việt chi tiết](docs/huong-dan-docker-tieng-viet.md) (this fork)
- [Docker setup guide](docs/docker-chromium-setup.md) (this fork)
- [Architecture](docs/architecture.md) (upstream)
- [Security model](docs/security-model.md) (upstream)

## Disclaimer

This is independent software and is not affiliated with or endorsed by OpenAI or the
upstream author. Use it only with your own account and in accordance with applicable
[Terms of Use](https://openai.com/policies/terms-of-use/) and workspace policies; it does
not bypass authentication or access controls.

## License

MIT, same as upstream. See [LICENSE](LICENSE) and [LICENSES](LICENSES) for third-party
notices. Upstream project: [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).
