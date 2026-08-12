# Phase 02: preamble skill delivery in the budget pipeline

Status: done; static green (365 tests pass incl. 4 new A4 tests, typecheck clean; phase 1-2 review
all-clean).

## Implementation notes (2026-08-12)

- `index.ts`: added `preambleSkill = identifySelectedSkillPacket(canonicalToolInput)` (wrapped in
  try/catch) computed only for Luna non-compaction turns with no MCP skill; passed as
  `promptOptions.preambleSkillCandidate`. `selectedSkill` stays the MCP packet, so broker
  registration and `holdBrowserTextUntilFinalized` are untouched (both key off the MCP packet).
- `luna-context-slimming.ts`: new `deliverSkillAsPreamble` runs at the top of the preload branch.
  It strips the skill (reusing `withoutSelectedSkillMessage`; rule-drop preserves indices so the
  packet index stays valid), recompiles the final with `preambleSkill` set (reference + earlier-
  message contract, no body), and appends the skill as the last preamble part(s) via
  `chunkMessagesIntoPreamble`. Two shapes: history-fits (skill is the only preamble) and
  history-overflows (peel history with `maxParts - skillParts` reserved, skill appended last).
  Declines (skill stays inline → collapse) on strip mismatch or when parts exceed the cap.
- `prompt.ts`: added the pipeline-only `preambleSkillCandidate` option; the inner compiler only
  reads `preambleSkill` (the reference).
- Usage stays consistent: `estimateChatGptWebInputTokens` routes through the same
  `compileLunaBudgetedPrompt` with the same options, so the summed estimate matches delivery.

## Goal

Wire the preamble-skill mode end to end: on a plain Luna over-budget turn that invokes a skill,
strip the body from the final message and deliver it as the last preamble part, with correct budget
accounting and part-cap behavior. Under-budget and MCP-path turns are unaffected.

## Context

- Skill decision + upfront strip: index.ts:240-250. Broker registration: index.ts:387-392.
  `holdBrowserTextUntilFinalized: selectedSkill !== undefined`: index.ts:433.
- Budget pipeline: `compileLunaBudgetedPrompt` — luna-context-slimming.ts:536-671. Preload branch:
  :595-611. Split: `splitLunaPreamble` :473; part builder `chunkMessagesIntoPreamble` :429;
  `serializePreamblePart` :419.
- Budget accounting nuance: `estimateCompiledChatGptWebInputTokens` counts **only `compiled.text`**,
  not `preamble` (input-tokens.ts:32-52). `splitLunaPreamble` sums `estimatedTotalTokens` itself
  (:501-508). Any added preamble part must be reflected in the total or the budget undercounts.

## Changes

### index.ts (decision + no-broker for preamble mode)

1. Keep `mcpSkill = mode.localTools && environment ? extractSelectedSkillPacket(...) : undefined`.
2. When `mcpSkill === undefined` and it is a Luna turn with preload enabled, compute
   `preambleSkill = identifySelectedSkillPacket(canonicalToolInput)` (default, non-throwing).
   - Do **not** strip it upfront and do **not** set `promptOptions.selectedSkill`. Instead pass the
     full packet into the budget pipeline via a new option, e.g.
     `promptOptions.preambleSkillCandidate = preambleSkill` (full `SelectedSkillPacket`, incl. body
     and `sourceMessageIndex`).
   - `promptInput` stays `canonicalToolInput` (skill still inline; the pipeline decides).
3. Broker registration and `holdBrowserTextUntilFinalized` stay keyed to `mcpSkill` only. Preamble
   mode registers no broker state and never holds the answer for an ack.

### luna-context-slimming.ts (preload branch)

4. In the preload branch (:595-611), before/around `splitLunaPreamble`, when
   `options.preambleSkillCandidate` is present and `result.estimatedTokens > budget`:
   - Strip the skill message from `working` at `packet.sourceMessageIndex` (reuse
     `withoutSelectedSkillMessage`; guard the index/text match).
   - Recompile subsets **with** `selectedSkill: { reference, mode: "preamble" }` so the final message
     carries the compact reference + earlier-message contract but not the body.
   - Run `splitLunaPreamble` on the stripped messages.
   - Append the skill body as the **last** preamble part via `serializePreamblePart` (role can be a
     synthetic `user`/`skill` marker so the delivery wrapper reads naturally). Order: history parts
     first, skill part last.
   - `estimatedTotalTokens = split total + skill-part tokens`; set `result.preloadParts =
     split.preamble.length + 1`.
   - **Part cap:** enforce `split.preamble.length + 1 <= lunaPreloadMaxParts()`. If exceeded, decline
     preamble-skill: leave the skill inline (do not strip) and fall through to the existing
     condense/collapse path (today's behavior).
5. If `preambleSkillCandidate` is present but the turn is **within budget**, do nothing — skill stays
   inline, output byte-identical to today.

### Ordering / delivery

6. The preamble is delivered oldest-first then the final task (browser-worker.ts:1874-1893), so the
   skill part being last means the model receives history → skill → task. Confirm the delivery
   wrapper (`chatGptPreambleMessageText`, browser-worker.ts:279) reads sensibly for a skill part;
   adjust wording only if needed (a skill body is still "earlier context" for the task).

## Files

- Modify `src/adapters/chatgpt-web/index.ts`.
- Modify `src/adapters/chatgpt-web/luna-context-slimming.ts`.
- Modify `src/adapters/chatgpt-web/prompt.ts` (option type: add `preambleSkillCandidate`).
- Possibly touch `src/adapters/chatgpt-web/browser-worker.ts` (wrapper wording only, if needed).

## Tests

- Extend `tests/luna-context-slimming.test.ts`:
  - Over-budget Luna turn with a large `<skill>` in the final message → `preloadParts` includes the
    skill part; the exact skill body appears in the **last** `compiled.preamble` entry and is
    **absent** from `compiled.text`; `compiled.text` contains the compact reference + the
    earlier-message contract (no wire names).
  - Under-budget turn with a skill → no preamble, skill body present inline in `compiled.text`
    (byte-identical assertion).
  - Part-cap: a turn needing history parts + skill part beyond `LUNA_PRELOAD_MAX_PARTS` keeps the
    skill inline and collapses (assert skill inline, `preloadParts === 0` or history-only).
  - Usage: `estimatedTokens` equals the sum of all parts + final (not undercounting the skill part).
- Extend `tests/chatgpt-web-harness.test.ts`: an over-budget preamble-skill turn delivers N+1
  messages and does **not** register broker skill state / does not hold for ack.
- MCP-path harness/broker tests stay green untouched (Full+danger still uses MCP).

## Validation

- `bun test tests/*.test.ts` green; `bunx tsc --noEmit` green.
- Manual trace check: bridge log shows the preload split line with the extra skill part on an
  over-budget Luna skill turn.

## Risks / rollback

- Double-counting or under-counting the skill part in usage — covered by the explicit sum test.
- Stripping the wrong message if `sourceMessageIndex` drifted after checkpoint/rule-drop — guard with
  the same role+text match `withoutSelectedSkillMessage` already enforces; on mismatch, decline
  preamble-skill and keep inline.
- Rollback: gate the whole preamble-skill branch behind the absence of the option; not setting
  `preambleSkillCandidate` in index.ts restores today's behavior exactly.
