---
phase: 3
title: "Snapshot and oversized task capsule"
status: pending
priority: P1
dependencies: [2]
---

# Phase 3: Snapshot and oversized task capsule

## Overview

Add the last two experiment slices: immutable already-read snapshots and deterministic oversized-user-task handling. The goal is still browser transport bypass, not model-window expansion (`README.md:46-78`, `docs/architecture.md:74-78`).

## Requirements

- Functional: offload already-read file/tool-result snapshots only after they are settled immutable evidence from prior rounds. Do not capsuleize outstanding tool calls from the active loop (`src/adapters/chatgpt-web/index.ts:441-457,478-533`).
- Functional: keep the current user task inline when it fits under the initial browser-message budget.
- Functional: when the current user task is itself oversized, keep only a deterministic structured task contract inline and make the exact original task a required capsule. No LLM summarization.
- Functional: selected-skill and earlier capsule types must coexist in one turn.
- Non-functional: deterministic structured task contract must be mechanically derived from the original user text, for example `sha256`, `chars`, `bytes`, `line_count`, exact section headings, referenced paths, and referenced commands.

## Architecture

- Extend `context-capsules.ts` with `tool_result_snapshot`, `file_read_snapshot`, and `oversized_user_task` packet kinds. The packet payload remains exact UTF-8 text/JSON already present in the transcript; no new live reads are introduced by the selector itself.
- Snapshot selection should operate only on already-materialized transcript/tool-result entries that precede the current round. This preserves the active broker loop from `index.ts:462-533`.
- For oversized current tasks, emit a compact inline `current_user_task_contract` object and a required `oversized_user_task` capsule. The contract is a locator, not a summary; the browser must load/ack the exact original task capsule before acting.
- Keep the phase-1/2 generic capsule wires and gating. Finalize still rejects if any required capsule is unacked.
- Verify that Luna slimming still works on the remaining inline prompt after snapshot/task offload. Only touch `luna-context-slimming.ts` if tests show manifest corruption or unsafe boundary handling.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/context-capsules.ts`
- Modify: `src/adapters/chatgpt-web/index.ts`
- Modify: `src/adapters/chatgpt-web/prompt.ts`
- Modify: `src/adapters/chatgpt-web/turn-broker.ts`
- Modify: `src/adapters/chatgpt-web/mcp-server.ts`
- Modify: `tests/context-capsules.test.ts`
- Modify: `tests/prompt-contract.test.ts`
- Modify: `tests/chatgpt-web-harness.test.ts`
- Modify as needed for coexistence and overflow coverage: `tests/selected-skill.test.ts`, `tests/luna-context-slimming.test.ts`, `tests/chatgpt-web-usage.test.ts`

## Implementation Steps

1. Extend capsule selectors to identify immutable snapshot messages from prior rounds and exclude active pending tool-loop state.
2. Implement the deterministic oversized-task contract builder. It must be purely mechanical and must always retain the original exact task as a required capsule.
3. Update prompt manifest generation so snapshots and oversized-task references appear as typed descriptors while the raw oversized task body leaves the inline prompt.
4. Reuse broker/MCP load/ack gating so snapshots and oversized tasks stay locked until acknowledged.
5. Add focused tests for: exact original task absent from inline prompt, deterministic contract fields, snapshot boundaries, coexistence with selected-skill, and remaining Luna overflow handling.
6. Run a disposable Full smoke with both large prior snapshots and an oversized current task before phase 4.

## Validation Commands

```powershell
bun test tests/context-capsules.test.ts tests/prompt-contract.test.ts
bun test tests/chatgpt-web-harness.test.ts tests/selected-skill.test.ts
bun test tests/luna-context-slimming.test.ts tests/chatgpt-web-usage.test.ts
bunx tsc --noEmit
```

Live Full smoke setup:

```powershell
$smoke = Join-Path $env:TEMP "cgw-phase3-smoke"
Remove-Item $smoke -Recurse -Force -ErrorAction Ignore
New-Item -ItemType Directory -Force $smoke | Out-Null
1..4000 | ForEach-Object { "LINE $_ PHASE3-SNAPSHOT-MARKER" } | Set-Content (Join-Path $smoke "large.txt")
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
docker compose logs codex-chatgpt-web --tail=200
```

Disposable semantic smoke contract:

1. Turn 1 in Full plus `danger-full-access`: read `large.txt` and confirm the marker, so a large immutable snapshot enters transcript history.
2. Turn 2: send an intentionally oversized current task whose text includes many exact constraints and paths, then ask for the marker from `large.txt` plus one harmless local action.
3. Pass only if logs show both snapshot and oversized-task capsule load plus ack before any native action, the inline browser prompt omits the exact oversized task body, and the final answer uses the exact snapshot marker.

## Success Criteria

- [ ] Exact oversized current-task text leaves the inline browser prompt and survives only as a required capsule plus deterministic inline contract.
- [ ] Already-read snapshots offload only from settled prior-round evidence, never from outstanding active-loop tool calls.
- [ ] Selected-skill plus required capsules still lock inventory/actions until every required ack is complete.
- [ ] Phase-3 live Full smoke proves mechanical transport and semantic use of both snapshot and oversized-task content.

## Risk Assessment

- High likelihood x High impact: the inline task contract could silently summarize instead of deterministically locating the original task. Mitigation: contract builder is purely mechanical, unit-tested, and phase fails if the exact original task is not also a required capsule.
- Medium likelihood x High impact: snapshot selection may steal current-loop tool results and break continuation. Mitigation: select only prior-round settled evidence and add harness coverage around `index.ts:441-533`.
- Medium likelihood x Medium impact: even after offload the model may still not semantically manage the loaded content. Mitigation: document this explicitly as a semantic limitation, require live smoke evidence, and never market it as context-window expansion.

## Security Considerations

- Snapshots are replay evidence, not new authority; they must not modify the current tool registry or sandbox policy (`docs/security-model.md:19-23`).
- Oversized-task capsules must be treated like user text at the original user priority. They cannot alter transport rules, connector permissions, or the selected-skill boundary.

## Rollback

- Revert only the phase-3 commit if committed; otherwise restore the phase-owned edits from the last green phase-2 checkpoint.
- If phase 3 fails, keep phases 1-2 intact and stop before README or broader rollout claims.
