---
phase: 4
title: "Integration verification and migration"
status: done
dependencies: [3]
effort: "1-2d"
---

# Phase 4: Integration verification and migration

## Overview

Replace the old transport wiring with the new seams, verify every consumer, and close the refactor
only after full regression and live smoke evidence match the shipped behavior.

## Requirements

- Functional: no behavior change to single-message turns, Luna preload/fallback, MCP selected-skill
  loading, checkpoint capture, tool loops, launcher mode, or final streaming.
- Non-functional: public adapter contracts remain stable unless a type-only internal seam changes.

## Architecture

The final ownership model is:

| Concern | Owner |
|---|---|
| Canonical request / environment setup | `index.ts` |
| Semantic prompt contract | `prompt.ts` |
| Luna strategy / budgeting | `luna-context-slimming.ts` |
| Selected-skill identification | `selected-skill.ts` |
| Transport plan | new transport contract module |
| DOM delivery | new browser transport runtime |
| Session/replay/feed state | `turn-execution.ts` |
| Broker authorization | `turn-broker.ts` |

## Related Code Files

- Modify: `src/adapters/chatgpt-web/index.ts` to use the final transport API.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` to remove migrated delivery code.
- Modify: `src/adapters/chatgpt-web/launcher-helper-client.ts` if the final boundary changes there.
- Modify: relevant tests and `README.md` only if the refactor changes documented internal behavior.
- Update: `plans/2026-08-12-skill-preamble-unification/plan.md` dependency/status after the new seam
  is stable.

1. Run the phase-3 focused suites and typecheck from a clean worktree baseline.
2. Search all repository consumers of moved symbols and update them explicitly; do not use a blanket
   "update all callers" step.
3. Remove compatibility adapters only after all consumers use the new transport contract.
4. Run focused tests in this order: prompt/Luna -> browser worker -> harness -> broker/session.
5. Run the complete `bun test tests/*.test.ts` suite and `bunx tsc --noEmit`.
6. Run `bun run verify` if its checks are relevant to the touched contracts, and inspect any failure
   instead of weakening tests.
7. Re-read `plan.md` and all four phase files; run a whole-plan consistency sweep for stale filenames,
   old ownership claims, and superseded A4 assumptions.
8. Only after green verification, remove the new-plan dependency block from A4 and resume A4 follow-up
   work if still needed.

## Implementation Steps (done 2026-08-12)

- Migrated symbols accounted for: `chatGptPreambleMessageText` moved `browser-worker.ts` →
  `browser-transport.ts`; its only external consumer was `tests/browser-worker-contract.test.ts`,
  updated to the new import. `PreparedChatGptWebPrompt` + `ChatGptWebTransportPlan` +
  `toChatGptWebTransportPlan` + `deliverPreambleParts` are the new symbols; consumers are
  `browser-worker.ts` and the transport/contract tests only.
- Compatibility adapters retained by design: `CompiledChatGptWebPrompt` stays as the compiled-prompt
  type (owned by `prompt.ts`, produced by `luna-context-slimming.ts`); the transport plan is a
  derived delivery view built at the browser boundary. No duplicate transport implementation exists —
  the preamble iteration/error policy lives once in `deliverPreambleParts`.
- Final ownership vs. the phase-4 table: `index.ts` = canonical setup/orchestration; `prompt.ts` =
  semantic contract; `luna-context-slimming.ts` = Luna strategy; `transport-contract.ts` = transport
  plan; `browser-transport.ts` = reusable delivery mechanics; `browser-worker.ts` = DOM lifecycle +
  the (intentionally unmoved) completion/streaming loop; `turn-execution.ts`/`turn-broker.ts`
  unchanged. The "selected-skill" ownership row is void — that subsystem was reverted (`edf29f5`).
- A4 dependency: A4 is reverted; its `blockedBy` link to this plan was cleared and this plan's
  `blocks` list is empty.
- Whole-plan sweep: phase files updated to reflect the safe scope + skill-removal impact; no
  unresolved contradictions remain (skill requirements explicitly marked N/A).

## Verification

- `bunx tsc --noEmit`: clean.
- Full suite `bun test tests/*.test.ts`: 352 pass, 0 fail.
- **Live preload smoke: BLOCKED** — no live Luna turn was run against this build; the DOM completion/
  streaming loop was intentionally not moved, so the mocked contract/harness suites are the evidence,
  not a live PASS. Rebuild + a real over-budget Luna turn is the outstanding live gate.

## Success Criteria

- [x] Repository-wide callers of migrated symbols are accounted for.
- [x] No duplicate transport implementations remain.
- [x] Focused suites pass.
- [x] Full test suite passes (352 / 0).
- [x] `bunx tsc --noEmit` passes.
- [BLOCKED] Live preload smoke — not run against this build; reported as BLOCKED, not a static PASS.
- [x] Whole-plan consistency sweep reports zero unresolved contradictions.

## Risk Assessment

Risk: hidden public behavior changes despite typecheck passing. Mitigation: compare single-message and
preload harness outputs against existing fixtures and keep a rollback point before deleting adapters.

Risk: A4 follow-up and this refactor drift. Mitigation: keep A4 explicitly blocked until the transport
ownership table is verified, then update both plans together.

## Security Considerations

No changes to broker authorization, sandbox policy, turn tokens, or trusted environment extraction are
allowed in this phase. Any required security behavior change is a separate plan decision.
