---
title: "Preload productionization: fallback, default-on, preserve user rules"
description: "Make multi-message preload safe to enable by default — add a fallback when delivery fails, flip the default on, and preserve user-authored rule content instead of condensing it."
status: planned
priority: P1
branch: main
tags: [luna, preload, transport, policy]
created: 2026-08-12
createdBy: claude
---

# Preload productionization: A3 → A2 → A1

## Objective

Take opt-in multi-message preload (shipped off by default in
`plans/2026-08-12-multi-message-preload`) to a safe default. Three ordered steps:

1. **A3 — Fallback on preload-delivery failure.** A failed preamble delivery must not fail a turn
   that slimming could have delivered as one message.
2. **A2 — Enable preload by default.** Flip the default on once A3 makes it safe.
3. **A1 — Preserve user-authored rule content by default.** With preload on, user `## Rule:`
   sections are peeled into the preamble verbatim instead of being condensed away.

## Accurate framing (verified in code this session)

The earlier note "auto-cutting user-authored instructions overrides user intent" is only partly
true, and the fix is smaller than it first looked:

- **Rule-drop** (`LUNA_DISPOSABLE_RULE_SECTIONS` in `luna-context-slimming.ts`) removes only **five
  named harness-only sections** (`skill-domain-routing`, `skill-workflow-routing`,
  `team-coordination-rules`, `orchestration-protocol`, `CLAUDE`). A user's own custom `## Rule:`
  section is **already kept** — it is not in the list. Dropping these five is correct: they instruct
  the Claude Code harness, which the ChatGPT Web model cannot act on.
- The step that actually cuts **user** content is **condense** (`condenseLunaRuleSections`), which
  trims every remaining `## Rule:` section — including the user's own — to its first paragraph, and
  **collapse**, which summarizes history (already backed by verbatim recall).
- Preload already runs **before condense** in `compileLunaBudgetedPrompt` (rule-drop → preload →
  condense → collapse). So when preload is on and succeeds, condense never runs and user rules
  survive verbatim in the preamble.

Therefore A1 is largely delivered by A2 (default-on) plus verification; the remaining choice is
whether to keep dropping the five harness sections (recommended: yes — they are provably useless to
the Web model and cost ~4-5k tokens).

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 (A3) | [Fallback on preload-delivery failure](./phase-01-preload-failure-fallback.md) | done; live-verified end-to-end |
| 2 (A2) | [Enable preload by default](./phase-02-enable-preload-by-default.md) | done; live-exercised (preload engaged automatically) |
| 3 (A1) | [Preserve user rule content by default](./phase-03-preserve-user-rules.md) | done; static green |

## Implementation notes (2026-08-12)

- A3: preamble failures throw `ChatGptWebAdapterError(code=preload_delivery_failed, retryable)`;
  the adapter records the executionKey in a bounded `preloadDisabledTurns` set and the Codex retry
  compiles with `disablePreload`, delivering a single slimmed message. Convergence in one retry.
- A2: `lunaPreloadEnabled` defaults on (disable with `off`/`0`/`false`); compose default flipped to
  `on`; README promoted from experimental to default.
- A1: no ordering change was needed — preload already runs before condense, so a user `## Rule:`
  section is preloaded verbatim when preload is on. A regression test locks this in
  (`condensedTokens === 0`, the rule marker present in `compiled.preamble`); the five harness-only
  sections keep being dropped.
- 361 tests pass, typecheck clean. Live smoke of the A3 fallback path is the remaining gate.

## Acceptance criteria

- A failed preload delivery (throttle timeout, composer error, page error) results in the turn being
  re-delivered as a single slimmed message, not a failed turn. No infinite retry.
- With preload default-on, a turn that fits in one message is byte-identical to today (preload never
  engages under budget).
- With preload on, an over-budget turn whose user rules would otherwise be condensed instead peels
  them into the preamble verbatim; a regression test proves the user rule text reaches the model.
- The five harness-only sections stay dropped (or the decision to keep them is explicit and tested).
- Full suite + typecheck green; live smoke confirms fallback and default-on on free Luna.

## Dependencies

- `plans/2026-08-12-multi-message-preload` (delivery loop, splitter, cap) — shipped.
- Free Luna session in full mode for the live smoke.

## Out of scope

- Paid-tier part-cap measurement and inter-part delay tuning (separate reconnaissance).
- Skill-loader-into-preamble unification (plan B phase-02 deferred item A4).
- Persistent chat per thread (plan A).

## Risks

- Default-on shifts every over-budget turn onto the live-gated delivery loop; A3 is the guardrail
  that keeps it never-worse-than-today.
- Keeping user rules makes turns heavier, so more turns hit preload and its ~3-message cap; beyond
  the cap they fall back to collapse (with recall), which is today's behavior.
