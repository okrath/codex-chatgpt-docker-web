# Contributing

This repository is a Docker-focused fork of
[miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web). Keep the project
narrow: ChatGPT web-backed Codex models running through the Docker Chromium runtime only.
Generic providers and unrelated OpenCodex product surfaces are out of scope, and the
removed host-install path (desktop launcher, one-command installers, native packaging)
should not be reintroduced here.

Core invariants:

- Model selection is explicit; never silently fall back to another model or reasoning level.
- Full mode exposes local tools only through the active outer Codex registry and official MCP
  tunnel.
- Browser-only mode never creates a broker capability or attaches an MCP connector; Pro remains
  read-only in every mode.
- Browser state, API keys, tunnel IDs, cookies, Codex history, and absolute user paths never enter
  the repository.

Before opening a pull request:

1. Run `bun install --frozen-lockfile` and `bun run verify`, and check that the container
   image still builds: `docker build -f docker/Dockerfile .`.
2. Add a focused regression test for protocol, compaction, MCP, browser parsing, or Docker
   runtime changes.
3. Do not commit cookies, browser state, tunnel ids, API keys, local absolute paths, or generated logs.
4. Preserve fail-closed behavior. A UI selector failure must not pick another model or claim success.
5. Keep Terms/trademark claims factual and never market the project as quota or rate-limit bypass.

Browser UI changes should include the exact observed DOM evidence and a reproducible test fixture.
Do not broaden selectors speculatively.

Changes under `docker/` must keep both published ports bound to the host's `127.0.0.1`,
keep the bridge reachable at `http://127.0.0.1:17841/v1`, and keep shell scripts LF-ended.
