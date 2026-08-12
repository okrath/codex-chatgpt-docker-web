---
phase: 2
title: "History capsule"
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: History capsule

## Overview

Extend the generic capsule path to older transcript history after phase 1 passes. Keep the active user task and current round inline; move only older immutable history that currently bloats the single browser message (`src/adapters/chatgpt-web/prompt.ts:292-304`, `src/adapters/chatgpt-web/luna-context-slimming.ts:198-203,225-262`).

## Requirements

- Functional: keep the latest active user task inline, unchanged.
- Functional: keep the current round inline; history offload starts only before the current round boundary, mirroring the safety boundary already used by Luna history collapse (`src/adapters/chatgpt-web/luna-context-slimming.ts:198-203,225-262`).
- Functional: selected-skill protocol must still work when history capsules are absent or present.
- Functional: history phase offloads older user/assistant transcript messages only; tool-result and file snapshots stay for phase 3.
- Non-functional: no silent summarization; older history is transported as exact typed transcript capsules, not as a compiled mega-summary.

## Architecture

- Reuse `context-capsules.ts` and extend the selector to classify older history messages into ordered `history_message` capsules.
- Maintain an inline keep-window that preserves: current user task, current round, any selected-skill reference, required instruction-capsule manifest, and recent minimal context needed for continuity.
- Use the same generic `load_context_capsule` / `ack_context_capsule` wires from phase 1. History capsules become additional required capsules for the turn; no extra top-level MCP tool or connector schema.
- Capsule selection must happen before any later Luna slimming so the slimmer works on the already-reduced inline message set. `luna-context-slimming.ts` should remain unchanged unless a regression proves it mishandles the manifest.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/context-capsules.ts`
- Modify: `src/adapters/chatgpt-web/index.ts`
- Modify: `src/adapters/chatgpt-web/prompt.ts`
- Modify: `src/adapters/chatgpt-web/turn-broker.ts`
- Modify: `src/adapters/chatgpt-web/mcp-server.ts`
- Modify: `tests/context-capsules.test.ts`
- Modify: `tests/prompt-contract.test.ts`
- Modify: `tests/chatgpt-web-harness.test.ts`
- Modify only if coexistence coverage is needed: `tests/selected-skill.test.ts`, `tests/luna-context-slimming.test.ts`

## Implementation Steps

1. Extend capsule selectors so only messages older than the current-round boundary can become `history_message` capsules; keep the latest user task inline even if it is large enough to matter.
2. Update prompt manifest generation to include ordered history descriptors without reintroducing their bodies inline.
3. Reuse broker/MCP gating from phase 1 so history capsules are required and acknowledged before native actions/completion.
4. Add targeted regression coverage for boundary handling: current-round messages stay inline, older history moves to capsules, selected-skill coexists, and Browser-only/Pro stay unchanged.
5. Run a focused multi-turn Full smoke before phase 3.

## Validation Commands

```powershell
bun test tests/context-capsules.test.ts tests/prompt-contract.test.ts
bun test tests/chatgpt-web-harness.test.ts tests/selected-skill.test.ts
bun test tests/luna-context-slimming.test.ts
bunx tsc --noEmit
```

Live Full smoke:

```powershell
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
docker compose logs codex-chatgpt-web --tail=200
```

Disposable semantic smoke contract:

1. Start a disposable Full plus `danger-full-access` thread.
2. Turn 1: ask for a deliberately long assistant reply that contains one exact marker near the end, for example `HISTORY-CAPSULE-MARKER-7419`.
3. Turn 2: ask, without repeating the marker, for the exact prior marker and one harmless local action.
4. Pass only if logs show history-capsule load plus ack before the tool call, and the second-turn answer recalls the exact marker from offloaded history.

## Success Criteria

- [ ] Older transcript history leaves the inline prompt while the current user task and current round stay inline.
- [ ] History capsules reuse the same reserved-wire and fail-closed gating path from phase 1.
- [ ] Selected-skill load/ack still passes when history capsules are also pending.
- [ ] Phase-2 live Full smoke proves both load/ack ordering and semantic recall from offloaded history.

## Risk Assessment

- High likelihood x High impact: offloading current-round or latest-task content would break immediate tool loops. Mitigation: reuse the explicit current-round boundary concept from `luna-context-slimming.ts:198-203`; add boundary tests before live smoke.
- Medium likelihood x High impact: history manifest grows but still does not fit. Mitigation: fail closed, keep phase 2 limited to transcript history only, and carry snapshot/user-task offload to phase 3 instead of widening scope early.
- Medium likelihood x Medium impact: Luna slimming may collapse a new manifest unexpectedly. Mitigation: keep `luna-context-slimming.ts` untouched unless targeted tests demonstrate a real regression.

## Security Considerations

- History capsules remain immutable replay evidence only; they do not authorize new local actions beyond the current outer turn's tool registry (`docs/security-model.md:19-23`).
- Revoke/finalize semantics from phase 1 remain mandatory; do not let replayed or retired handles reload history capsules (`src/adapters/chatgpt-web/turn-broker.ts:438-447,475-482`).

## Rollback

- Revert only the phase-2 commit if committed; otherwise restore the phase-owned edits in `context-capsules.ts`, the shared core files, and the touched tests from the last green phase-1 checkpoint.
- If phase-2 live smoke fails, keep phase 1 intact and do not start phase 3.
