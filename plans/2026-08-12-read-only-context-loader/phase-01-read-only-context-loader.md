---
phase: 1
title: "Read-only context loader"
status: failed
effort: "bounded experiment"
---

# Phase 1: Read-only context loader

## Files

- Create `src/adapters/chatgpt-web/context-capsules.ts` and `tests/context-capsules.test.ts`.
- Extend `src/adapters/chatgpt-web/index.ts`, `prompt.ts`, `turn-broker.ts`, `mcp-server.ts`, and focused tests.
- Migrate public connector identity in `src/config.ts` and connector contract tests.
- Update README/setup docs only after the live gate passes.

## Implementation

1. Canonicalize model-switch developer contracts, build ordered system/developer packets, and clone-strip only those packets from Full/danger-full-access browser input.
2. Store packets in broker RAM with manifest/load/ack state; expose no packet content from claim/resolve; gate all native actions and completion until ordered acknowledgement finishes.
3. Register public top-level tools with strict schemas and read-only annotations. Keep the generic tool contract unchanged for ordinary native actions and selected skills.
4. Compile a compact contract naming only the public tools, turn token, capsule count, and protocol order.
5. Add unit/integration tests for exact-byte stripping, hash mismatch, order errors, idempotence, lifecycle cleanup, selected-skill coexistence, Browser-only/Pro behavior, and the new public ABI hash.
6. Run focused tests, typecheck, full suite, independent debugger/reviewer/tester gates, rebuild, doctor, connector migration, and a marker-only live Full/Luna smoke.

## Stop conditions

- Any trusted instructions are lost, reordered, leaked inline, or revived after supersession.
- Any native action or completion succeeds before acknowledgement.
- ChatGPT safety blocks the dedicated read-only tools or the live model skips them after bounded retries.
- Existing public behavior regresses.

## Success criteria

- [x] Static mechanical tests and full regression suite passed.
- [x] `Codex Native3` was attached to the same tunnel and visible to ChatGPT.
- [ ] Live broker logs prove the required loader call before task execution.
- [ ] Live answer proves use of capsule-only content.
- [x] Failed prototype rolled back; README does not claim context offload.
