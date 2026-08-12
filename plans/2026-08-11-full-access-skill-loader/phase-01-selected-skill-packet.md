# Phase 01: selected-skill packet

Status: complete

## Context

Codex appends an explicitly invoked skill as a separate server-owned user message after the human task. The browser bridge currently serializes that entire message inline. A previous experiment loading the whole compiled prompt through MCP was rejected as instruction laundering and could still allow tool activity when the loader was skipped.

## Contract

1. Inspect the raw Responses input and accept exactly one final current-turn skill message. Its full envelope must exactly equal the final parsed-context user message.
2. Require canonical turn metadata, a preceding real current-turn user instruction, local-tools mode, and `dangerFullAccess`. Bind by exact item `turn_id`; when Codex omits item turn IDs, require a server-owned item ID plus the same canonical-metadata adjacency fallback used for trusted initial requests.
3. Hash the exact skill inner body with SHA-256 and register it in the turn broker only.
4. Clone only the activated Full-turn request, remove the full skill item from that clone, add a compact selected-skill reference, and retain the human task inline. Never mutate the shared parsed request or the read-only paths.
5. Instruct ChatGPT to call `codex_tool_call` with `__codex_load_selected_skill_v1`, then acknowledge the returned hash with `__codex_ack_selected_skill_v1` before acting.
6. Synthesize and intercept both reserved wire names inside `mcp-server.ts`; they never enter the outer tool queue. Before acknowledgement, broker claims project `tools: []`, inventory returns only the reserved operations, and all direct and generic native paths fail closed.
7. Atomically finalize acknowledgement in the broker before either browser success path records or emits completion, then revoke. A reconnect may replay only session events whose first completion already finalized successfully.

## Files

- Create `src/adapters/chatgpt-web/selected-skill.ts`.
- Modify `src/adapters/chatgpt-web/environment.ts` to recover the trusted current environment across a selected-skill tail without changing Browser-only/Pro revision identity.
- Modify `src/adapters/chatgpt-web/prompt.ts` and `src/adapters/chatgpt-web/index.ts` for the compact reference and lifecycle.
- Modify `src/adapters/chatgpt-web/turn-broker.ts` and `src/adapters/chatgpt-web/mcp-server.ts` for load/ack and action gates.
- Extend focused tests in `tests/environment.test.ts`, `tests/prompt-contract.test.ts`, and `tests/chatgpt-web-harness.test.ts`.
- Modify `README.md` only after live validation.

## Validation

- Extraction tests: exact content/hash, wrong turn, user-authored XML, multiple skills, restricted sandbox.
- Prompt tests: task remains inline, skill body absent, compact reference present, unchanged fallback modes.
- Broker/MCP tests: load idempotence, wrong hash rejected, pre-ack inventory/action blocked, post-ack routing works, revoke erases access.
- Existing full test suite and TypeScript typecheck.
- Disposable live task invoking `ck:ask`; verify logs show load/ack and no unexpected filesystem mutations; cancel active browser turns afterward.

## Risks and rollback

- Actual Codex skill envelopes may differ by client version. Fail closed to the existing inline path if provenance or shape is not exact.
- Connector-side MCP caching may ignore new public tools. Keep the public tool list and schemas unchanged by using reserved wire names.
- If the live model refuses delegated skill content or skips the loader, revert the prototype and leave README unchanged.

## Result

- Implemented the contract with no public MCP schema change.
- Added Codex 0.145 combined-context and item-with-turn-id/no-item-id compatibility while
  preserving stricter server-owned IDs for sparse historical recovery.
- Full suite passed 343/343 and TypeScript typecheck passed.
- Live Luna smoke passed load, hash acknowledgement, completion finalization, and no-write checks.
- Later context-loader experiments were fully rolled back; selected-skill behavior revalidated at
  344/344 tests with the Native2 runtime healthy.
