---
phase: 1
title: "Required instruction capsule"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Required instruction capsule

## Overview

Deliver a generic required-capsule mechanism for system prompt plus developer messages only. This is the smallest safe slice because selected-skill already proves the same RAM -> load -> ack -> unlock pattern for one trusted current-turn payload (`src/adapters/chatgpt-web/index.ts:206-327`, `src/adapters/chatgpt-web/turn-broker.ts:151-237`, `src/adapters/chatgpt-web/mcp-server.ts:61-90,348-433`).

## Requirements

- Functional: Full mode only; outer sandbox must be `dangerFullAccess`; Browser-only, Pro, and compaction turns stay inline and unchanged (`docs/architecture.md:21-38`, `src/adapters/chatgpt-web/prompt.ts:209-223`).
- Functional: offload typed immutable instruction capsules for `parsed.context.systemPrompt` and developer-role transcript items while keeping the current human task inline (`src/adapters/chatgpt-web/prompt.ts:224-317`).
- Functional: use only the existing six top-level MCP tools; any new behavior must surface as reserved `wire_name` values under `codex_tool_inventory` / `codex_tool_call` (`src/adapters/chatgpt-web/mcp-server.ts:227-433`).
- Non-functional: no LLM summarization; exact UTF-8 bytes, `chars`, and `sha256` must be transported.
- Non-functional: per-turn RAM only; revoke must erase state and fail closed (`docs/security-model.md:16-20`, `src/adapters/chatgpt-web/turn-broker.ts:239-250`).

## Architecture

- Create `src/adapters/chatgpt-web/context-capsules.ts` to own packet/reference types, `sha256/chars/bytes` helpers, and a phase-1 selector that converts instruction sources into ordered capsule descriptors. Keep packet shapes transcript-oriented, for example `kind`, `role`, `ordinal`, `sha256`, `chars`, `bytes`, and exact `content`.
- Hook selection after selected-skill stripping and after any Luna checkpoint application so the selector sees the same prompt input that `compileLunaBudgetedPrompt()` sees today (`src/adapters/chatgpt-web/index.ts:206-217,250-258`).
- Extend `compileChatGptWebPrompt()` to emit an inline manifest of required instruction capsules instead of their full bodies. Keep the current transport contract and `selected_skill` field intact; add a new `required_context_capsules` field rather than rebuilding the whole envelope shape (`src/adapters/chatgpt-web/prompt.ts:224-317`).
- Extend broker state from singular `selectedSkill` gating to generic required-capsule gating, but keep selected-skill as a separate protocol. Tools remain hidden via `tools: []` until all required instruction capsules are acked (`src/adapters/chatgpt-web/turn-broker.ts:415-429`).
- Add reserved wire names for generic capsule load and ack, exposed only through `codex_tool_inventory` and `codex_tool_call`. The load wire should identify one capsule by `sha256`; the ack wire should require the same `sha256`.
- Deterministic order: when required instruction capsules exist, the prompt must direct the browser to load/ack them before any selected-skill load/ack or any native tool use. This preserves instruction priority.

## Related Code Files

- Create: `src/adapters/chatgpt-web/context-capsules.ts`
- Create: `tests/context-capsules.test.ts`
- Modify: `src/adapters/chatgpt-web/index.ts`
- Modify: `src/adapters/chatgpt-web/prompt.ts`
- Modify: `src/adapters/chatgpt-web/turn-broker.ts`
- Modify: `src/adapters/chatgpt-web/mcp-server.ts`
- Verify only unless reuse proves necessary: `src/adapters/chatgpt-web/selected-skill.ts`, `src/adapters/chatgpt-web/luna-context-slimming.ts`

## Implementation Steps

1. Add capsule packet/reference types and deterministic hashing helpers in `context-capsules.ts`. Mirror the exact-byte handling used by selected-skill packet creation in `src/adapters/chatgpt-web/selected-skill.ts:76-95,175-185`.
2. Implement a phase-1 selector that extracts only system/developer instruction bodies from the post-checkpoint parsed input, preserves transcript order, and returns a stripped prompt clone plus ordered descriptors.
3. Update `index.ts` so Full plus `dangerFullAccess` turns register required instruction capsules with the broker together with any selected skill. Keep Browser-only/Pro and compaction paths untouched (`src/adapters/chatgpt-web/index.ts:279-305,306-358`).
4. Update `prompt.ts` so the inline browser contract names the capsule load/ack sequence, includes only compact descriptors, and never includes the removed instruction bodies. Keep the current user task inline.
5. Extend `turn-broker.ts` and `mcp-server.ts` so claim/inventory/call/finalize all reject native actions and browser completion until every required instruction capsule is loaded and acked.
6. Add focused regression coverage before any live smoke.

## Validation Commands

```powershell
bun test tests/context-capsules.test.ts tests/prompt-contract.test.ts
bun test tests/turn-broker-lifecycle.test.ts tests/chatgpt-web-harness.test.ts
bunx tsc --noEmit
```

Live Full smoke:

```powershell
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
docker compose logs codex-chatgpt-web --tail=200
```

Disposable semantic smoke contract:

- Add a disposable instruction marker to the same instruction surface the operator already uses for Full turns (repo `AGENTS.md` if that surface is repo-local; otherwise the operator's existing developer-instruction source). The marker text must not appear in the task text.
- Run a new Full plus `danger-full-access` thread in a disposable workspace with a harmless local action such as `Get-Location`.
- Pass only if logs show instruction-capsule load plus ack before the first native tool call, and the final answer reflects the offloaded instruction-only marker.

## Success Criteria

- [ ] Inline prompt no longer contains the exact offloaded instruction marker/body.
- [ ] `codex_tool_inventory` exposes only pending reserved wires while required instruction capsules are unacked.
- [ ] Wrong hash, skipped load, skipped ack, and browser completion before ack all fail closed.
- [ ] Browser-only, Pro, and compaction prompts remain byte-for-byte compatible where capsule offload is disabled.
- [ ] Phase-1 live Full smoke passes with both mechanical and semantic proof.

## Risk Assessment

- High likelihood x High impact: instruction priority inversion if system/developer order is lost. Mitigation: store `role` plus `ordinal`; force instruction-capsule load/ack before any other action; add ordering assertions in unit and harness tests.
- Medium likelihood x High impact: accidental ABI drift if a new top-level MCP tool is introduced. Mitigation: limit changes to reserved `wire_name` handling inside `codex_tool_inventory` and `codex_tool_call`; keep the six registered top-level tools unchanged (`src/adapters/chatgpt-web/mcp-server.ts:227-433`).
- Medium likelihood x Medium impact: prompt still over budget after phase 1. Mitigation: fail closed, inspect log byte counts, and do not begin phase 2 until the phase-1 smoke is green and the remaining overflow is understood.

## Security Considerations

- Keep authoritative environment extraction unchanged; never trust user-authored environment tags (`docs/security-model.md:11-20`, `tests/chatgpt-web-harness.test.ts:353-367`).
- Do not persist capsule RAM or hashes across revoke/finalize; revocation stays the only cleanup path (`src/adapters/chatgpt-web/turn-broker.ts:239-250`).

## Rollback

- If phase 1 is committed, revert only the phase-1 commit with `git revert <phase1-commit>`.
- If phase 1 is uncommitted, restore only `context-capsules.ts` and the phase-owned edits in `index.ts`, `prompt.ts`, `turn-broker.ts`, `mcp-server.ts`, and the new tests from the last green checkpoint.
- Do not start phase 2 until the codebase is back to a fully inline instruction path or the phase-1 smoke is green.

## Result

Live gate failed. ChatGPT skipped the loader for a text-only task and its product safety layer blocked manifest/load calls for a tool-required task. The prototype was removed, the runtime returned to inline system/developer context, Phase 2 was not started, and README was not changed. Final rollback verification: 344/344 tests and TypeScript typecheck passed.
