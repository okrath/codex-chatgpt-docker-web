---
phase: 1
title: "Transport contract and seams"
status: done
priority: P1
dependencies: []
effort: "1-2d"
---

# Phase 1: Transport contract and seams

## Overview

Define the transport boundary first. Separate immutable transport intent from execution details so
the rest of the refactor can move code without changing behavior.

## Requirements

- Functional: represent final text, ordered preamble parts, delivery limits, and input-token accounting
  in one explicit transport-facing type.
- Non-functional: no browser/Playwright imports in transport-plan types; no Luna policy in browser code.

## Architecture

Introduce a small transport contract module under `src/adapters/chatgpt-web/` (exact filename chosen
to match existing naming conventions) containing the prepared-turn shape and delivery metadata. Keep
the existing `CompiledChatGptWebPrompt` as a compatibility adapter during migration, then make the
browser worker consume the new contract directly.

Key invariant: the compiler owns semantic content; the transport contract owns ordering/accounting;
the browser worker owns DOM delivery and upstream completion evidence.

## Related Code Files

- Create: `src/adapters/chatgpt-web/transport-contract.ts` for the stable transport types/helpers.
- Modify: `src/adapters/chatgpt-web/prompt.ts` to map compiled prompts into the transport contract.
- Modify: `src/adapters/chatgpt-web/luna-context-slimming.ts` to return transport-ready preload data
  without importing browser runtime concerns.
- Modify: `src/adapters/chatgpt-web/index.ts` to pass the transport contract through the turn runtime.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` only at the boundary type, not policy logic.
- Tests: `tests/prompt-contract.test.ts`, `tests/luna-context-slimming.test.ts`,
  `tests/chatgpt-web-harness.test.ts`.

1. Inventory every consumer of `CompiledChatGptWebPrompt`, `preamble`, `estimatedTokens`, and
   `release()` before changing signatures; record caller count in the implementation notes.
2. Define the minimal transport contract: final message, ordered preamble messages, token estimate,
   optional files, and release/lifecycle hook where ownership is required.
3. Add a compatibility mapper from the current compiler result to the new contract so behavior remains
   byte-for-byte equivalent for single-message turns.
4. Move only transport-neutral helpers behind the new boundary; leave skill/MCP/checkpoint semantics
   in their current policy modules.
5. Add contract tests for empty/undefined preamble, ordered parts, accounting, and lifecycle ownership.
6. Compile and run the focused suites before proceeding to the next phase.

## Implementation Steps (done 2026-08-12)

### Consumer inventory (step 1)

- `CompiledChatGptWebPrompt`: 21 references across 7 files — `prompt.ts` (owner), `index.ts`,
  `luna-context-slimming.ts`, `browser-worker.ts`, `input-tokens.ts`, `browser-helper-main.ts`,
  `launcher-helper-client.ts`.
- The real transport boundary is `prepare()` returning `CompiledChatGptWebPrompt & { release }`
  (browser-worker.ts:295). Consumed at browser-worker.ts:1874 (`.preamble`), :2080 (`.release()`),
  and the input-token estimate is computed there via `estimateCompiledChatGptWebInputTokens`
  (browser-worker.ts:1810) — it is not a field on the prepared shape today.
- `release()` producers: index.ts:342/389, browser-helper-main.ts:132, browser-worker.ts:1455
  (smoke). Consumers: browser-worker.ts:2080, launcher-helper-client.ts:195.
- `estimatedTokens`/`estimatedTotalTokens` live on `LunaBudgetedCompilation`/`LunaPreloadSplit`
  (luna-context-slimming.ts) and feed usage + the over-budget trace in index.ts.

### What landed (additive, no behavior change)

- New `src/adapters/chatgpt-web/transport-contract.ts`:
  - `PreparedChatGptWebPrompt` = the named boundary type (`CompiledChatGptWebPrompt & { release }`).
  - `ChatGptWebTransportPlan` = the immutable transport contract (final message, ordered preamble,
    images, `estimatedInputTokens`, `trimmedCompactionMessages`, `release`). Imports only compiled
    data types from `prompt.ts` — no Playwright/DOM, no Luna policy.
  - `toChatGptWebTransportPlan(prepared, estimatedInputTokens)` compatibility mapper (absent
    preamble → `[]`, absent trim → `0`).
- `browser-worker.ts`: the `prepare` signature now uses the named `PreparedChatGptWebPrompt` (pure
  type alias; structurally identical to the old inline type).
- `tests/transport-contract.test.ts`: 5 tests — field mapping, empty/undefined preamble, order
  preservation, trim default, lifecycle passthrough.
- Consumers are NOT rewired to the plan type yet; that migration is phases 2-3. `CompiledChatGptWebPrompt`
  stays as the compatibility shape.

### Verification

- `bunx tsc --noEmit` clean; full suite 349 pass / 0 fail (344 baseline + 5 new).

## Success Criteria

- [x] All current `CompiledChatGptWebPrompt` consumers are enumerated and mapped.
- [x] New transport contract has no Playwright/Luna-specific imports.
- [x] Single-message prepared output is unchanged (mapper is additive; no delivery path changed).
- [x] Preamble ordering and token accounting are explicit and tested.
- [x] `bunx tsc --noEmit` and focused transport tests pass.

## Risk Assessment

Risk: accidental ownership changes for `release()` or attached files. Mitigation: keep lifecycle
ownership explicit and retain existing release calls until the final phase.

Risk: hidden consumers in helper/launcher paths. Mitigation: repository-wide symbol search before
signature changes and a full typecheck after each boundary migration.

## Security Considerations

The contract must not weaken the distinction between trusted environment data, user-authored content,
and selected-skill packets. No new raw tool/broker fields belong in the generic transport contract.
