---
title: Fail-open research subagent tool for ChatGPT Web turns
description: >-
  Let the main Web-model turn spawn a scoped research sub-turn in a second
  Temporary Chat via an optional broker tool — each sub-chat brings a fresh ~28k
  transport budget.
status: pending
priority: P2
branch: main
tags:
  - luna
  - full-mode
  - subagent
  - broker-tool
blockedBy: []
blocks: []
created: '2026-08-13T02:28:43.271Z'
createdBy: 'ck:plan'
source: skill
---

# Fail-open research subagent tool for ChatGPT Web turns

## Overview

When a full-mode Web turn (Luna) needs research — reading a source slice, weighing
an algorithm, checking a fact — it MAY call a reserved broker tool
`__codex_research_subagent_v1(question)`. The bridge then opens a **second
Temporary Chat** in the same container Chromium, delivers a bridge-authored,
browser-only prompt carrying the question, captures the answer, closes the
sub-chat, and returns the answer as an ordinary tool result. The main turn is
paused waiting on that tool result the whole time, so at most one generation runs
at once.

**Why this shape and no other.** User decisions (2026-08-13): sub-agent is a tool
the model calls; free-tier quota burn accepted. Repo evidence dictates the rest:

- Mandatory model-directed sequencing failed 5/5 live retries (cancelled capsule
  offload / read-only context loader) — so the tool is **fail-open**: a turn that
  never calls it is byte-identical to today.
- Fail-open recall tools were called spontaneously when the answer genuinely
  needed them (phase 5 live smoke, `history search matches=2/8`) — the pattern
  this plan copies, including discovery via contract sentence only, **no public
  tools/list change** (the Native3 connector lesson).
- ChatGPT Free throttles ~3 rapid messages per chat — sub-chats are separate
  chats, serial, spaced by generation time; probes must still confirm pacing.

**The payoff:** each sub-chat gets a fresh ~28k transport budget. This is the
only way to multiply usable context per Codex turn on the Free tier.

## Design decisions (fixed unless probes falsify them)

| Decision | Choice |
|---|---|
| Wire name | `__codex_research_subagent_v1`, reserved `codex_tool_call` name beside the recall tools |
| Discovery | One sentence in the full-mode transport contract; no schema/inventory change |
| Question contract | Self-contained: the caller quotes whatever context the sub-agent needs into `question` (the main model already holds the context). Bridge-side slicing of broker RAM is explicitly deferred. |
| Sub-agent prompt | Bridge-authored browser-only contract + sealed Floor block (read-only Deliver) + the question. No tools, no turn token, no checkpoint contract, no Codex context envelope. |
| Budget guards | `question` capped so contract + Floor + question ≤ the Luna transport budget; answer capped at 32,000 chars (mirrors `HISTORY_LOAD_RESPONSE_CHAR_CAP`), truncation flagged in the result |
| Concurrency | Serial only; one sub-chat at a time; max `3` calls per turn (counter in turn-scoped broker state) |
| Rollout | Behind `CODEX_CHATGPT_WEB_SUBAGENT` **default off**; flipped on only after phase-4 live smoke (the preload-productionization precedent) |
| Scope guard | Sub-agent is read-only browser-only: it can use ChatGPT-native web search but has no Codex Native tools — the feature adds zero local-access surface |
| Failure mode | Sub-chat failure/timeout returns a structured error tool result to the main turn (fail-open there too); it must never fail the outer turn |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Live feasibility probes](./phase-01-live-feasibility-probes.md) | Completed |
| 2 | [Sub-chat delivery machinery](./phase-02-sub-chat-delivery-machinery.md) | Pending |
| 3 | [Broker tool and turn integration](./phase-03-broker-tool-and-turn-integration.md) | Pending |
| 4 | [Live smoke and docs](./phase-04-live-smoke-and-docs.md) | Pending |

Phase 1 is a **gate**: if probe A fails (no second chat while a tool call is
pending), the design falls back to running the sub-chat *between* rounds rather
than inside a pending tool call — which changes phase 2's shape — and if ChatGPT
Free rejects that too, the plan stops with a written null result.

## Dependencies

- Builds on committed machinery: turn-broker reserved wire names + turn-scoped
  state (`history-recall.ts` precedent), browser-worker Temporary Chat
  preparation, `buildFloorProcedureBlock` (2ef97d7).
- No unfinished plan touches these files; `2026-08-12-sealed-floor-procedure-protocol`
  is completed.

## Acceptance criteria

- [ ] Probes answered with recorded numbers (concurrency, pacing, wait tolerance
      both ChatGPT-side and bridge-side).
- [ ] With the env flag off, every existing behavior is byte-identical
      (regression suite green, no contract text change).
- [ ] With the flag on: a full-mode turn that ignores the tool is unchanged; a
      turn that calls it gets a real answer produced in a second Temporary Chat,
      serially, capped, and the outer turn survives sub-chat failure.
- [ ] Live smoke on the real free Luna account: model calls the tool
      spontaneously on a research-shaped task, answer flows back, outer turn
      completes with checkpoint intact.
- [ ] README documents the tool honestly (quota burn, latency, fail-open,
      probe-measured limits).

## Rollback

Env flag off restores today's behavior without a deploy; full removal is
deleting the subagent module + the contract sentence + browser-worker sub-chat
path. No schema, storage, or transport-plan changes.

## Unresolved questions

- ~~Probe C bounds the per-sub-agent timeout~~ **Measured 2026-08-13** (see
  [reports/phase-01-subagent-feasibility-probes.md](./reports/phase-01-subagent-feasibility-probes.md)):
  a 5-minute pending connector call left the parent chat in a *"Connection
  interrupted"* state and the turn failed its completion watch across clean
  retries. Sub-agent timeout is therefore **default 90 s, hard cap 120 s** —
  the 240 s guess is dead. A question needing more time must be split by the
  caller.
- Whether one research tool is enough or task-shaped variants (read-source vs
  web-research) earn their place — deferred until real usage shows a need.
- Separate production issue surfaced by the probe, independent of subagents:
  minutes-long local execs already destabilize the parent chat on today's
  product (interrupted stream → completion action never rendered → retry
  churn). Needs its own investigation.
