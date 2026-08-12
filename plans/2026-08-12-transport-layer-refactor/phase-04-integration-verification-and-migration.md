---
phase: 4
title: "Integration verification and migration"
status: pending
priority: P1
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

## Implementation Steps

<!-- Detailed steps -->

## Success Criteria

- [ ] Repository-wide callers of migrated symbols are accounted for.
- [ ] No duplicate transport implementations remain.
- [ ] Focused suites pass.
- [ ] Full test suite passes.
- [ ] `bunx tsc --noEmit` passes.
- [ ] Existing live preload smoke remains valid; if live evidence is unavailable, report it as
      BLOCKED rather than treating static tests as a live PASS.
- [ ] Whole-plan consistency sweep reports zero unresolved contradictions.

## Risk Assessment

Risk: hidden public behavior changes despite typecheck passing. Mitigation: compare single-message and
preload harness outputs against existing fixtures and keep a rollback point before deleting adapters.

Risk: A4 follow-up and this refactor drift. Mitigation: keep A4 explicitly blocked until the transport
ownership table is verified, then update both plans together.

## Security Considerations

No changes to broker authorization, sandbox policy, turn tokens, or trusted environment extraction are
allowed in this phase. Any required security behavior change is a separate plan decision.
