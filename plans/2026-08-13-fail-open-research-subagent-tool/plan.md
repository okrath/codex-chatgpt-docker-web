---
title: Fail-open research subagent tool for ChatGPT Web turns
description: >-
  Let the main Web-model turn spawn a scoped research sub-turn in a second
  Temporary Chat via an optional broker tool — each sub-chat brings a fresh ~28k
  transport budget.
status: completed
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

> **WITHDRAWN 2026-08-13, hours after phase 4 shipped it disabled. The code is deleted.**
>
> The feature was redundant, and the evidence was in this repository the whole time.
> Codex has its own delegation mechanism, and this fork's own setup already enables it —
> `multi_agent = true`, with `multi_agent_v2 = false` so the bridge can read cross-backend
> payloads ([src/codex-integration.ts](../../src/codex-integration.ts)). Upstream's
> architecture doc calls the result a "routed Web subagent", and `index.ts` already had a
> branch rejecting V2 payloads for exactly this scenario.
>
> Confirmed live before deleting anything: one delegated task produced **three concurrent
> browser turns** (parent plus two subagents, traces `fbe9ef26614b`, `8a6519803b35`,
> `78af1f2cf743`), and both subagent turns completed. Every payoff this plan chased — a
> separate chat, a fresh per-message budget — is already there, and a Codex subagent is a
> full agent with real local tools rather than a browser-only research chat.
>
> **The process failure worth remembering:** the plan asked "what problem does this solve"
> and answered it correctly, but never asked "has the platform already solved it". One grep
> for `multi_agent` at the start would have closed the plan on day one. Same shape as the
> Floor: a sound mechanism built on an unexamined premise.
>
> One genuine difference is recorded rather than acted on: a native subagent copies nearly
> the whole parent context (measured ~32.1k tokens, needing slimming to fit), while the
> deleted sub-chat sent ~1.4k. If a cheap-question niche is ever demonstrated rather than
> assumed, the implementation is in git history at commits `10cb099`, `ce662c4`, `baa9e97`.
>
> Kept from the work: the probe findings in `reports/` are all still true and load-bearing
> — pending connector calls are safe to at least 300 s, and Chromium's anti-throttling flags
> mean a second tab cannot starve the parent. And the smoke turned up the fact now in the
> README: on a free account, **Luna slimming is what makes native multi-agent fit at all**.

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
| Sub-agent prompt | Bridge-authored browser-only contract + the question, fenced. No tools, no turn token, no checkpoint contract, no Codex context envelope. (The sealed Floor block was originally planned here; it was measured harmful and removed from the repo on 2026-08-13, so the sub-turn prompt carries no procedure block — and, per that lesson, must never carry prose that contradicts another contract in the same message.) |
| Budget guards | `question` capped at 16,000 characters, chosen so even the densest script stays inside the per-message budget without a separate token guard; answer capped at 32,000 chars (mirrors `HISTORY_LOAD_RESPONSE_CHAR_CAP`), truncation flagged in the result |
| Concurrency | One sub-chat at a time and **no queueing**: a request either starts now or is refused, because the parent's pending call would otherwise cover the wait plus the run, past the only window measured safe (300 s). Max `3` calls per turn, counted in turn-scoped broker state, reserving before the run and releasing again when nothing was spent. |
| Rollout | Behind `CODEX_CHATGPT_WEB_SUBAGENT` **default off**; flipped on only after phase-4 live smoke (the preload-productionization precedent) |
| Scope guard | Sub-agent is read-only browser-only: it can use ChatGPT-native web search but has no Codex Native tools — the feature adds zero local-access surface |
| Failure mode | Sub-chat failure/timeout returns a structured error tool result to the main turn (fail-open there too); it must never fail the outer turn |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Live feasibility probes](./phase-01-live-feasibility-probes.md) | Completed |
| 2 | [Sub-chat delivery machinery](./phase-02-sub-chat-delivery-machinery.md) | Completed |
| 3 | [Broker tool and turn integration](./phase-03-broker-tool-and-turn-integration.md) | Completed |
| 4 | [Live smoke and docs](./phase-04-live-smoke-and-docs.md) | Completed |

Phase 1 is a **gate**: if probe A fails (no second chat while a tool call is
pending), the design falls back to running the sub-chat *between* rounds rather
than inside a pending tool call — which changes phase 2's shape — and if ChatGPT
Free rejects that too, the plan stops with a written null result.

## Dependencies

- Builds on committed machinery: turn-broker reserved wire names + turn-scoped
  state (`history-recall.ts` precedent) and the browser worker's Temporary Chat
  preparation, model assertion, prompt attachment, and submission-acceptance
  helpers, which the sub-turn composes rather than copies.
- No unfinished plan touches these files. `2026-08-12-sealed-floor-procedure-protocol`
  is closed as withdrawn, and its lesson is a constraint here: the sub-turn
  prompt must never contradict another contract in the same message.

## Acceptance criteria

- [x] Probes answered with recorded numbers (concurrency, pacing, wait tolerance
      both ChatGPT-side and bridge-side).
- [x] With the env flag off, every existing behavior is byte-identical
      (regression suite green, no contract text change).
- [~] With the flag on: a full-mode turn that ignores the tool is unchanged; a
      turn that calls it gets a real answer produced in a second Temporary Chat,
      serially, capped — **all confirmed live**. The outer turn surviving a
      sub-chat failure is **not** confirmed: the one observed failure ended with
      the parent turn dying after the model rewrote already-streamed prose.
- [x] Live smoke on the real free Luna account: the model called the tool
      spontaneously on 3 of 5 research-shaped tasks, answers flowed back, and
      those turns completed with checkpoints intact.
- [x] README documents the tool honestly (quota burn, latency, fail-open,
      measured adoption rate, and why the default stays off).

**Status: the default stays off.** See
[reports/phase-04-subagent-live-smoke.md](./reports/phase-04-subagent-live-smoke.md)
for the evidence and the short list that would flip it.

## Rollback

Env flag off restores today's behavior without a deploy; full removal is
deleting the subagent module + the contract sentence + browser-worker sub-chat
path. No schema, storage, or transport-plan changes.

## Unresolved questions

- ~~Probe C bounds the per-sub-agent timeout~~ **Resolved 2026-08-13, and the
  first answer was wrong.** The incident that produced the "90 s / 120 s cap"
  had no long pending call in it at all; controlled holds found **no failure
  threshold between 120 s and 300 s**, so the pending-call window is not the
  constraint. Sub-agent timeout is **180 s default / 240 s hard cap**, chosen
  as a bound on a stuck sub-chat rather than as protection for the parent. See
  the correction in
  [reports/phase-01-subagent-feasibility-probes.md](./reports/phase-01-subagent-feasibility-probes.md)
  and the full reconstruction in
  `plans/2026-08-13-long-exec-connection-interruption/`.
- Whether one research tool is enough or task-shaped variants (read-source vs
  web-research) earn their place — deferred until real usage shows a need.
- **Checkpoint omission is the live reliability problem** (measured 6/10 on
  short answers) and it is what arms the retry storm that kills turns. It is
  not caused by this plan, but a sub-agent tool result makes the parent's
  answer longer and more structured, which may interact with it either way.
  Worth re-measuring once sub-agent turns exist.
