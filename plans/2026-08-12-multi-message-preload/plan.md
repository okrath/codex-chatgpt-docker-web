---
title: "Deterministic multi-message preload"
description: "Deliver an over-budget Luna turn as ordered browser messages — system prompt, rules, skill, then the task — so nothing user-authored is auto-cut and the 28k limit applies per message, not per turn."
status: planned
priority: P1
branch: main
tags: [feature, luna, transport, browser]
created: 2026-08-12
createdBy: claude
---

# Deterministic multi-message preload

## Objective

Break the "one turn = one ≤28k browser message" coupling on ChatGPT Free. When the compiled turn
exceeds the transport budget, the bridge sends ordered preamble messages in the same Temporary
Chat — semantic order: system prompt → global rules/AGENTS.md → selected skill → current task —
each within budget, then runs the normal turn on the final message. The model accumulates
everything in its real (~1M) window.

## Why this succeeds where the loaders failed

The cancelled MCP loaders required the *model* to fetch context before acting — Luna skipped that
sequence 5/5. Preload inverts control: the *bridge* pushes context through the product's own
composer. The model's only job on preamble messages is to reply anything at all; even total
non-compliance leaves the context in the thread. This is the "product-supported deterministic
preloading" the rollback conclusion called for.

## Policy reversal that this unlocks

Today every Luna turn silently drops ClaudeKit-style `## Rule:` sections. That was a budget
decision, but it overrides user intent — users put those sections there on purpose, and the model
can follow their prose (style, workflow preferences) even where hooks cannot execute. Once preload
ships: rule sections are **kept by default** and delivered in the rules chunk;
`CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` flips to an opt-in trim. History collapse (and its recall
tools from `plans/2026-08-12-fail-open-history-recall`) remains the tool for unbounded history —
preload is for the irreducible current-turn core, not for replaying a 1M-token thread every turn.

## Skill-loader interplay

A preloaded turn carries the selected skill as its own preamble message — verbatim, no load/ack
ceremony, and it works in browser-only and Pro modes too. Precedence per turn:

1. Turn fits in one message → today's single-message path (skill offload may make it fit — keep).
2. Over budget and full+danger-full-access → try the MCP skill offload first (no latency cost).
3. Still over budget → preload path; skill goes inline as a chunk and the MCP loader is skipped.
4. Preload failure (rate limit, page error) → retry once → fall back to today's slimmed
   single-message path. Never worse than status quo.

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | [Chunked delivery mechanics](./phase-01-chunked-delivery-mechanics.md) | done; DOM loop live-verified |
| 2 | [Semantic splitter and policy integration](./phase-02-semantic-splitter-and-policy.md) | done behind opt-in flag; static green |
| 3 | [Live smoke, limits reconnaissance, docs](./phase-03-live-smoke-and-docs.md) | done; 1- and 2-part passed live, ~3-message Free-tier limit found, part cap added |

## How to live-test (phase 3)

Preload ships **off by default**. To exercise it: set `CODEX_CHATGPT_WEB_LUNA_PRELOAD=on` in the
container environment (docker-compose `environment:` or `docker compose exec … -e`), restart, then
run a Luna turn large enough to exceed ~28k after rule-drop. The bridge log shows
`📨 Luna preload split this over-budget turn into N earlier-context part(s)` and one
`preload part i/N` line per delivered message. Watch for Free-tier rate-limit dialogs between parts
(the reconnaissance this phase measures).

## Acceptance criteria

- A turn ≤ budget behaves byte-identically to today (no preamble, no policy change visible).
- An over-budget turn delivers every chunk with exact composer verification, waits out each
  intermediate response, then completes the task message with today's streaming/tool/checkpoint
  contracts intact.
- Rule sections survive by default; `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` still allows opting into
  trimming; history collapse still bounds old history.
- Preamble responses never leak into the Codex answer stream; a single trace commentary line per
  chunk narrates progress.
- Usage reports the sum of all delivered chunks.
- Preload failure falls back to the current slimmed single-message turn.
- Full suite + typecheck green; live smoke on the user's Free session passes before README changes.

## Dependencies

- Existing browser worker composer insertion, exact verification, completion detection, and
  rate-limit dialog handling (src/adapters/chatgpt-web/browser-worker.ts).
- `plans/2026-08-12-fail-open-history-recall` phase 2 index (nice-to-have, not blocking).

## Out of scope

- Persistent chat per Codex thread (plan A) — preload composes with it later (preload once per
  thread, then deltas).
- Changing Sol/Plus/Pro transports — this plan is Luna/Free first; Sol windows are larger and
  Codex compacts natively.

## Open questions (answer in phase 3)

1. Free-tier message rate limits: how many preamble messages per turn are safe, and what
   inter-message delay is needed.
2. Whether Temporary Chat has a per-conversation message cap.
3. Latency per intermediate chunk (target: acceptable at ≤4 chunks for typical over-budget turns).
4. Whether intermediate replies consume meaningful Free-tier quota.
