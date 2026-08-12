# Phase 01: fail-open history tools

Status: implemented; static-verified (349 tests, typecheck green in the throwaway bun container). Live smoke deferred to phase 4.

## Result

- New module `src/adapters/chatgpt-web/history-recall.ts` holds the two reserved wire names, caps,
  and the `RemovedHistoryMessage` type (shared by slimming, broker, mcp-server without a cycle).
- `compileLunaBudgetedPrompt` accumulates every collapsed message as `removedHistory` and derives
  the marker advertisement from `mode.localTools`, so usage estimation and delivery stay identical.
- `TurnBroker` gained `attachCollapsedHistory` (50MB fail-soft cap, single-attach guard), the
  `search_history`/`load_history` dispatch (query/limit/index caps, 32k response cap), the skill-ack
  gate as a second defense layer, and a revoke-time wipe.
- `mcp-server.ts` intercepts both wire names inside `codex_tool_call`, after the skill-ack gate;
  no inventory or public-schema change.
- `index.ts` attaches the collapsed history right after compiling the tools prompt.
- Tests: slimming returns verbatim removed messages + conditional advertisement; broker search/load
  /caps/revoke-wipe/skill-gate; MCP stdio interception with no public inventory leak.

## Context

`collapseOldLunaHistory()` (src/adapters/chatgpt-web/luna-context-slimming.ts) deletes the older
span and leaves one marker; the removed text is unavailable to the Web model afterwards. Full mode
already has a per-turn broker channel plus reserved-wire-name interception proven by the skill
loader (src/adapters/chatgpt-web/selected-skill.ts, mcp-server.ts, turn-broker.ts). The removed
messages are already in bridge memory each turn — Codex resends the whole thread.

## Contract

1. `compileLunaBudgetedPrompt()` additionally returns the removed messages from the final
   escalation step as `removedMessages: Array<{ index: number; role: string; text: string }>`
   (text-only; non-text parts serialize as `[image]`/`[part]` placeholders). Counts-only fields
   (`collapsedMessages`, `collapsedTokens`) stay unchanged.
2. `TurnBroker` gains `attachCollapsedHistory(token, messages)`; state lives on the existing
   `TurnChannel`, is absent by default, and is wiped by `revoke()`. Store cap 50,000,000 bytes:
   over cap → skip attach, `console.warn`, turn proceeds without recall.
3. `index.ts` `prepare()` (tools path only): after `compilePromptWithLunaBudget(turnToken)`, when
   `mode.localTools && removedMessages.length > 0`, call `attachCollapsedHistory`. Read-only path
   never attaches.
4. Marker advertisement: only when history was attached, the collapse marker text appends one
   sentence naming both wire names and instructing `codex_tool_call` with the existing
   `turn_token`. Read-only turns keep today's marker verbatim.
5. `mcp-server.ts` intercepts inside the `codex_tool_call` handler (same pattern and position as
   the selected-skill wire names), guarded by `requireSelectedSkillAcknowledged`:
   - `__codex_search_collapsed_history_v1` `{ query: string, limit?: number }` — case-insensitive
     substring match over stored texts; query 2..500 chars; limit default 5, max 8; returns
     `{ matches: [{ index, role, snippet, chars }] }`, snippet ±200 chars around first hit.
   - `__codex_load_collapsed_history_v1` `{ indexes: number[] }` — max 5 indexes/call; returns
     `{ messages: [{ index, role, text }], truncated }` with a 32,000-char response cap
     (`truncated: true` when the cap cut content; remaining text reachable by narrower calls).
   - Unknown index / no attached history → explicit error naming the condition.
   - Both are broker methods (`search_history`, `load_history`) mirroring `load_skill` dispatch.
6. No public tools/list or inventory change; discovery is the marker sentence only.

## Files

- Modify `src/adapters/chatgpt-web/luna-context-slimming.ts` (return removed messages; marker
  advertisement flagged by an option, default off, so read-only compiles stay identical).
- Modify `src/adapters/chatgpt-web/index.ts` (attach after compile in tools prepare; pass the
  advertisement flag).
- Modify `src/adapters/chatgpt-web/turn-broker.ts` (channel state, attach, two dispatch methods,
  revoke wipe).
- Modify `src/adapters/chatgpt-web/mcp-server.ts` (two reserved wire names).
- Extend `tests/luna-context-slimming.test.ts`, `tests/turn-broker-lifecycle.test.ts`,
  `tests/chatgpt-web-harness.test.ts`.

## Validation

- Slimming test: removed messages returned exactly; marker advertisement present only with the
  flag; read-only compile byte-identical to today.
- Broker tests: attach → search finds by substring; load returns verbatim text; caps enforced
  (query length, limit, indexes, 32k response, 50MB store-skip); revoke wipes; second attach on
  same token rejected.
- Harness test: skill-gated turn rejects both wire names pre-ack and serves them post-ack.
- Fail-open regression: full-mode Luna turn with collapse, zero recall calls → identical event
  stream and usage vs today (marker text aside).

## Risks and rollback

- ChatGPT may truncate large tool results in the web UI — cap starts at 32k chars; phase 4 smoke
  adjusts. Worst case: smaller cap, more pagination.
- Model may ignore the tools entirely — acceptable by design (fail-open); phase 4 records the
  observation.
- Rollback: remove the two wire names, the attach call, and the marker flag; slimming reverts to
  returning counts only. No persisted state anywhere.
