---
title: "Full-access context capsule offload experiment"
description: "Stage typed transcript-capsule offload for Full plus danger-full-access turns over the existing six-tool MCP bridge."
status: cancelled
priority: P2
effort: 4d
branch: main
tags: [feature, backend, experimental, mcp]
blockedBy: []
blocks: []
created: 2026-08-11
---

# Full-access context capsule offload experiment

## Overview

Goal: bypass the browser's single-message transport budget for Full plus `danger-full-access` turns by offloading typed immutable transcript capsules into turn-scoped broker RAM, then loading and SHA-256-acking them over the existing six-tool MCP surface before any native action or completion.

Current baseline: the browser prompt is still one inline JSON envelope in `src/adapters/chatgpt-web/prompt.ts:200-317`; selected-skill offload already proves the required fail-closed RAM -> load -> ack -> unlock pattern in `src/adapters/chatgpt-web/index.ts:206-327`, `src/adapters/chatgpt-web/turn-broker.ts:151-237`, and `src/adapters/chatgpt-web/mcp-server.ts:61-90,348-433`. Full mode and Browser-only/Pro boundaries are defined in `docs/architecture.md:19-45`; authoritative environment extraction and turn-scoped revocation are defined in `docs/security-model.md:11-20`.

## Scope Challenge

- Existing code: reuse the current prompt compiler, trusted-environment resolution, selected-skill extraction, broker token lifecycle, and reserved `codex_tool_call` wire pattern instead of inventing a new connector or prompt transport (`src/adapters/chatgpt-web/prompt.ts:200-317`, `src/adapters/chatgpt-web/selected-skill.ts:95-153`, `src/adapters/chatgpt-web/turn-broker.ts:427-514`).
- Minimum change set: add generic context-capsule manifest/load/ack flow for Full plus `dangerFullAccess` only; keep Browser-only and Pro inline and unchanged (`docs/architecture.md:21-38`).
- Complexity: four sequential phases; each later phase reuses the same core files and must stop if the prior live Full smoke fails.

## Data Flow

1. Outer Codex turn arrives; Full mode resolves trusted environment from Codex wire metadata, not user-authored XML (`docs/security-model.md:11-18`, `src/adapters/chatgpt-web/index.ts:375-385`).
2. `index.ts` already strips a selected-skill tail on a clone before prompt compilation (`src/adapters/chatgpt-web/index.ts:206-217`, `src/adapters/chatgpt-web/selected-skill.ts:95-173`). The capsule selector should run on that same cloned, post-checkpoint input so budget decisions match the real browser payload (`src/adapters/chatgpt-web/index.ts:215-258`).
3. Phase-specific selectors move eligible transcript items into broker RAM as typed immutable packets and leave only a compact inline manifest plus the current inline task contract.
4. `prompt.ts` emits the existing transport contract plus ordered required-capsule references; no connector schema change, only reserved wire names under `codex_tool_inventory` and `codex_tool_call` (`src/adapters/chatgpt-web/mcp-server.ts:348-433`).
5. `turn-broker.ts` keeps tools hidden with `tools: []` until every required capsule and any selected skill are loaded and SHA-256-acked, and rejects browser completion before that (`src/adapters/chatgpt-web/turn-broker.ts:229-237,427-514`).
6. Finalize/revoke erases per-turn state; this remains RAM-only and fail-closed (`docs/security-model.md:16-18,87-95`, `src/adapters/chatgpt-web/turn-broker.ts:239-250`).

## Mechanics vs Semantics

- Mechanical proof: exact bytes are absent from the inline browser prompt, loader returns the exact UTF-8 payload with stable `sha256/chars/bytes`, wrong hashes reject, inventory stays locked, and completion fails before all required acks.
- Semantic proof: a disposable live Full smoke must show the browser actually uses the loaded capsule contents to answer or act correctly. This is evidence of transport bypass only, not a claim that ChatGPT gained a larger model context window (`README.md:46-78`, `docs/architecture.md:74-78`).

## Experiment Result — Live Gate Failed

- Static prototype: focused capsule/broker/MCP tests and TypeScript typecheck passed.
- Text-only Full/Luna smoke: ChatGPT answered the inline task without calling manifest/load/ack. Broker correctly rejected completion on every retry.
- Tool-required Full/Luna smoke: ChatGPT attempted the required context operations, but the ChatGPT product safety layer blocked the `codex_tool_call` manifest/load path. Outer `danger-full-access`, healthy Full runtime, selected connector, and healthy tunnel did not override that product decision.
- Independent review found additional semantic risks in the prototype: checkpoint/selected-skill coexistence, superseded developer-contract resurrection, and usage accounting from the unstripped request.
- Decision: stop before Phase 2, remove the context-capsule prototype, keep system/developer/history inline, and leave README unchanged. Do not bypass ChatGPT's safety decision.
- Safe residual fix: broker finalization now rejects completion while any native invocation is still pending; regression covered.
- Final rollback baseline: 344 tests passed, 0 failed; TypeScript typecheck passed.
- Rebuilt rollback image: container healthy, doctor ready, capsule identifiers absent from the runtime image, and the regular Full/Luna smoke completed successfully with `ROLLBACK_SAFE_OK`.

Any future retry needs a product-supported dedicated read-only loader surface (likely a new public connector ABI/identity) and a new live gate. Reusing the destructive generic `codex_tool_call` reserved-wire path is rejected by this experiment.

## Execution Strategy

| Phase | Deliverable | Stop condition |
|---|---|---|
| 1 | Required system/developer instruction capsules only | Any native action or browser completion happens before required-capsule ack, or the Full smoke cannot prove instruction-capsule loading |
| 2 | Older history transcript capsules | Current inline task or current-round messages get offloaded, or the multi-turn smoke cannot recall offloaded history |
| 3 | Already-read snapshots plus oversized-user-task capsule | The exact original user task is not transported as a required capsule when oversized, or snapshot/task smoke fails |
| 4 | Full validation, independent review, README | Any focused suite, full suite, typecheck, review, or combined smoke fails; no README update before all are green |

## File Ownership

- Shared core files across sequential phases: `src/adapters/chatgpt-web/index.ts`, `src/adapters/chatgpt-web/prompt.ts`, `src/adapters/chatgpt-web/turn-broker.ts`, `src/adapters/chatgpt-web/mcp-server.ts`.
- New capsule module owned from phase 1 onward: `src/adapters/chatgpt-web/context-capsules.ts`.
- New focused tests owned from phase 1 onward: `tests/context-capsules.test.ts`.
- Existing regression suites extended phase-by-phase: `tests/prompt-contract.test.ts`, `tests/turn-broker-lifecycle.test.ts`, `tests/chatgpt-web-harness.test.ts`, with `tests/selected-skill.test.ts` and `tests/luna-context-slimming.test.ts` touched only when coexistence coverage is required.
- README is phase-4-only.

## Test Matrix

- Unit: capsule packet construction, SHA-256/byte counts, deterministic oversized-task contract extraction, selection boundaries, coexistence with selected-skill.
- Integration: broker claim/load/ack/finalize/revoke, MCP inventory/call locking, prompt contract shape, replay/session behavior, no Browser-only/Pro regression.
- End-to-end mechanical: live Full/danger-full-access smoke after phases 1-3 with log evidence that load/ack precedes tool use and completion.
- End-to-end semantic: each live smoke uses a marker that exists only in the offloaded capsule set being tested.
- Full regression before README: `bun test tests/*.test.ts` and `bunx tsc --noEmit` using the real repo scripts from `package.json:25-36`.

## Rollback Strategy

- Roll back one phase at a time only after that phase's files are isolated in a focused commit; prefer `git revert <phase-commit>` over shared-worktree resets.
- If work is uncommitted, restore only the files owned by the failed phase from the last green checkpoint; never revert unrelated edits in the dirty worktree.
- A failed phase blocks the next phase; do not carry partial capsule behavior forward.

## Dependencies

- Completed baseline only: `plans/2026-08-11-full-access-skill-loader/plan.md:7-28`. No unfinished plan blocks this work.

## Success Criteria

- [ ] Browser-only and Pro stay inline and unchanged.
- [ ] Full plus `danger-full-access` loads and SHA-256-acks required capsules before any native action and before completion.
- [ ] Selected-skill load/ack still works when capsules are absent or present.
- [ ] Current user task stays inline unless phase 3 explicitly triggers deterministic oversized-task handling.
- [ ] Live Full smokes pass after phases 1-3; phase 4 runs full suite, typecheck, independent review, and only then updates README.

## Unresolved Questions

None
