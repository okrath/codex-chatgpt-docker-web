---
phase: 2
title: "Sub-chat delivery machinery"
status: pending
effort: "M"
priority: P2
dependencies: [1]
---

# Phase 2: Sub-chat delivery machinery

## Overview

Teach the browser worker to run one scoped, browser-only sub-turn in a second
Temporary Chat page while the main turn's page sits pending on a tool call —
prompt in, markdown answer out, page closed — without disturbing the main
turn's completion watcher.

## Requirements

- Functional: `runResearchSubTurn({ promptText, timeoutMs, abortSignal })`
  returns `{ markdown, truncated }` or a typed failure; runs strictly serially
  (an internal lock; a second concurrent request queues or rejects).
- Non-functional: zero change to the main-turn state machine when the feature
  is unused; the sub-chat reuses existing stage helpers instead of forking
  copies of selector logic.

## Architecture

- New method on the browser worker (or a small collaborator class it owns)
  that: `context.newPage()` (the same call the main path uses at
  browser-worker.ts:900) → Temporary Chat preparation (reuse the existing
  navigation/composer-ready/session-verified stage helpers) → attach + send the
  prompt (single message, no preload, no attachments) → watch for completion
  with the existing markdown-capture machinery → close the page.
- No effort selection, no connector mention, no checkpoint stream, no tool
  wiring in the sub-chat: it is the read-only path minus Codex context.
- Diagnostics: reuse the browser-turn diagnostics writer with a distinct trace
  suffix (`<parentTrace>-sub<N>`), so live smokes can be audited the same way
  as main turns.
- Timeout: **180 s default, 240 s hard cap** (Probe C's original 90/120 s
  figure was withdrawn — no failure threshold exists between 120 s and 300 s;
  see the report's correction). The timeout bounds a stuck sub-chat; it is not
  protecting the parent turn, which tolerates long waits.
- The main turn's watcher keeps polling its own page unaffected (separate
  `Page` objects). Guard: while a sub-turn runs, the worker must not treat the
  new page's DOM events as main-turn evidence — sub-turn logic operates only on
  its own `Page` handle and never queries `context.pages()`.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/browser-worker.ts` (sub-turn entry point +
  lock; expected to stay a thin composition of existing stage helpers)
- Create: `src/adapters/chatgpt-web/research-subagent.ts` (prompt assembly +
  caps + result shaping; keeps worker changes minimal)
- Create: `tests/research-subagent.test.ts` (prompt assembly, caps,
  serialization of concurrent requests, failure shaping — source-level, no DOM
  mock exists in this repo)

## Implementation Steps

1. Extract the sub-turn-relevant stage sequence into reusable helpers where the
   main path doesn't already expose them (navigation → composer → send →
   completion watch), without changing main-path behavior (regression suite
   must stay green before the new entry point is added).
2. Implement `research-subagent.ts`: prompt = short browser-only contract +
   fenced question; answer cap 32,000 chars with a truncation flag.
   **Amended during implementation:** the Floor block this step originally
   called for no longer exists (measured harmful, removed 2026-08-13), and the
   separate token guard was dropped as unreachable — a question at the 16,000
   character cap compiles to well under half the per-message budget, and a test
   pins that relationship instead, so raising the cap too far fails the build
   rather than the composer.
3. Implement the worker entry point with the serial lock, timeout, diagnostics
   suffix, and page cleanup on every exit path.
4. Unit tests per above; full suite + typecheck in the throwaway bun container.

## Carried into phase 3 by review

Raised in the phase-2 review and deliberately left for the phase that wires the
tool up, because each one is about the caller's contract rather than the
delivery mechanics:

- **Queue latency belongs to somebody.** The worker is a per-config singleton,
  so one `SerialQueue` serves every concurrent Codex turn. With 3 calls per turn
  and 5 turn slots the worst case is a long serial backlog, and the wait is
  currently charged to no deadline. Phase 3 should cap queue depth (refusing
  fail-open when deeper) and decide whether the timeout bounds time-in-sub-chat
  or time-the-parent-waits.
- **Typed browser errors must not escape as parent-turn failures.** Shared
  helpers throw retryable `ChatGptWebAdapterError`s (rate limit, subscription,
  "Something went wrong"). If those propagate, a *sub*-chat rate limit fails the
  parent turn and re-arms the retry storm. Phase 3 converts them to structured
  tool results.
- **Error text names the wrong subject.** Shared helpers say "the Codex turn was
  terminated" / "Retry the turn"; inside a sub-turn that is false and the parent
  model would read it as its own turn dying. Wrap or relabel at the tool-result
  boundary.
- **Diagnostics retention.** Each sub-turn takes one of the 10 retained trace
  directories, so a parent with 3 sub-turns evicts history roughly four times
  faster. Nest sub-turn artifacts under the parent trace or raise the limit for
  the smoke.

## Success Criteria

- [ ] Full suite green with the feature completely unused (no behavior change)
- [ ] Sub-turn entry point exercises only its own page; lock enforces serial
      execution under a concurrent-call test
- [ ] Prompt assembly tests pin the contract text, Floor inclusion, and both
      caps
- [ ] `bunx tsc --noEmit` clean

## Risk Assessment

- browser-worker is ~2,100 lines with single-turn assumptions; the mitigation
  is composing existing helpers and never sharing `Page` state between main
  and sub turns.
- Selector drift affects sub-chats exactly as main chats — acceptable, same
  failure mode, same fix point.
- If Probe A forced the between-rounds fallback, this phase's entry point is
  invoked at a different moment but its internals are unchanged.
