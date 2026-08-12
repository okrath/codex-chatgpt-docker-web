---
title: "Refactor ChatGPT Web transport layer"
description: "Refactor the ChatGPT Web transport path into explicit prompt, policy, transport-plan, and browser-delivery boundaries without changing shipped behavior."
status: complete
priority: P2
branch: "main"
tags: [refactor, backend, transport, luna]
blockedBy: []
blocks: []
created: "2026-08-12T10:11:15.831Z"
createdBy: "ck:plan"
source: skill
---

# Refactor ChatGPT Web transport layer

> **Note (2026-08-12, after generation):** the selected-skill offload subsystem was reverted in
> commit `edf29f5` (both A4 preamble and the MCP loader), so references below to `selected-skill.ts`,
> "selected-skill MCP" contracts, and the A4 seams/tests no longer apply — that file and those tests
> are gone. The rest of the refactor scope (prompt / policy / transport-plan / browser-delivery
> boundaries, preload, checkpoint, streaming, retry) stands. `blocks` was cleared for the same reason.

## Overview

Refactor the ChatGPT Web transport path so prompt compilation, transport policy, browser delivery,
and turn/session state have explicit boundaries. Preserve the shipped single-message, Luna preload,
selected-skill MCP, checkpoint, streaming, and retry contracts while making future transport changes
localized and testable.

## Scope Challenge

- Existing code: transport behavior is concentrated across `prompt.ts`, `luna-context-slimming.ts`,
  `index.ts`, `browser-worker.ts`, `turn-execution.ts`, `selected-skill.ts`, and `turn-broker.ts`;
  the recent preload/A4 work already supplies useful seams and regression tests.
- Minimum change set: extract stable transport contracts and policy decisions, isolate browser
  message delivery from prompt compilation, and move orchestration glue out of the large browser
  worker/index paths. Do not redesign MCP, checkpoint storage, or the public Responses API.
- Complexity: four sequential phases; expect 7-10 production/test files to move or split, but keep
  new abstractions to a small transport contract plus focused policy/delivery modules.

## Architecture Direction

```text
Codex request
    |
    v
Turn preparation / policy
    |---- model + capability policy
    |---- Luna budget / preload decision
    |---- selected-skill mode
    v
Transport plan (immutable)
    |---- ordered preamble parts
    |---- final message
    |---- delivery metadata / accounting
    v
Browser transport runtime
    |---- composer attach + exact verification
    |---- submit + completion evidence
    |---- abort / timeout / rate-limit handling
    v
Turn execution / feeds / broker lifecycle
```

The refactor must keep semantic compilation independent from Playwright DOM details. The browser
worker consumes a transport plan and returns delivery/completion evidence; it should not decide what
context is semantically eligible for preload.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Transport contract and seams](./phase-01-transport-contract-and-seams.md) | Done |
| 2 | [Prompt compilation pipeline](./phase-02-prompt-compilation-pipeline.md) | Done (already isolated post-revert) |
| 3 | [Browser delivery runtime](./phase-03-browser-delivery-runtime.md) | Done (safe scope: preamble mechanics + contract threading) |
| 4 | [Integration verification and migration](./phase-04-integration-verification-and-migration.md) | Done; live smoke PASSED |

## Dependencies

- `2026-08-12-multi-message-preload` — shipped transport behavior is the compatibility baseline.
- `2026-08-12-preload-productionization` — shipped default-on/fallback semantics must remain intact.
- `2026-08-12-skill-preamble-unification` — this refactor blocks further A4 follow-up edits until
  the transport seams are stable; the A4 code already in main is treated as current behavior.

## Success Criteria

- [x] Single-message and multi-message transport contracts are represented by explicit types
      (`ChatGptWebTransportPlan` / `PreparedChatGptWebPrompt`) rather than implicit coupling.
- [x] Prompt/budget code contains no Playwright or DOM knowledge (unchanged; verified).
- [x] Browser delivery code contains no Luna rule/history/skill selection policy (the worker reads the
      transport plan, not policy; `deliverPreambleParts` is policy-free).
- [x] turn-broker semantics remain unchanged. (MCP selected-skill was reverted separately in
      `edf29f5`, so that clause is void.)
- [x] Transport tests cover preamble ordering, delivery-failure classification, and plan accounting;
      exact-composer/timeout/replay coverage is unchanged in the existing worker/harness suites.
- [x] Full test suite (352/0) and `bunx tsc --noEmit` pass. Live preload smoke PASSED on the rebuilt
      container (over-budget Luna turn `8872a9e37ae6` delivered a preamble part + final message).

## Validation Log

- Baseline inspected: `main` is clean and two commits ahead of `origin/main`; recent commits include
  the preload productionization and selected-skill preamble work.
- Current transport surface: `prompt.ts`, `luna-context-slimming.ts`, `index.ts`, `browser-worker.ts`,
  `turn-execution.ts`, `selected-skill.ts`, `turn-broker.ts`; regression suites include browser worker,
  Luna slimming, prompt contract, harness, selected skill, and broker lifecycle tests.
- Existing plan overlap: A4 directly shares prompt/budget/selected-skill transport seams, so it is
  explicitly blocked by this refactor plan to prevent competing structural edits.
