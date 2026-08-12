# Phase 01 (A3): fallback on preload-delivery failure

Status: done; live-verified end-to-end.

## Result

Live smoke (free Luna, budget-override to force 4 parts, part cap raised to 5, per-part timeout
lowered to 15s for a fast repro): parts 1-3 delivered, part 4 hit the Free-tier throttle and failed,
the turn was reclassified `preload_delivery_failed`, and the retry compiled a single slimmed message
(`✂️ … collapsed → ~9k tokens`, no `📨 preload split`) that completed. No loop.

Bug found and fixed during the smoke: the server builds a fresh adapter per HTTP request
(`server.ts` `adapterFactory(...)`), so a `preloadDisabledTurns` set in the adapter closure was
empty again on the retry and the fallback never engaged — the turn looped. Moving the set to module
scope (the lifetime of the shared turn-session registry) fixed it. Also added
`CODEX_CHATGPT_WEB_LUNA_PRELOAD_TIMEOUT_MS` so the failure path can be exercised without waiting the
full 180s.

## Context

Preload delivery runs in `browser-worker.ts` `run()` (the preamble loop before the final message).
A failed preamble stage throws; the adapter (`index.ts` `runTurn` catch block) retires or replays the
session, and Codex retries the turn. Because the retry recompiles the same over-budget input, it
preloads again and fails again — the loop observed in live smoke. Today this is acceptable only
because preload engages exclusively on turns that would otherwise hard-fail; once preload is default
(phase 2) and user rules are kept (phase 3), a preload failure could break a turn that slimming
would have delivered. This phase adds the guardrail.

## Design

Use Codex's existing turn retry, made convergent by remembering the failure per turn:

1. **Classify** a preamble-delivery failure in `browser-worker.ts` as
   `ChatGptWebAdapterError` with `code: "preload_delivery_failed"`, `retryable: true`. Covers the
   per-part timeout ("did not acknowledge in time"), the composer verification error, send-disabled,
   and rate-limit dialogs raised during the preamble loop. The final-message path is unchanged.
2. **Remember** the failure in the adapter. Add a bounded, TTL/LRU `Set<executionKey>`
   `preloadDisabledTurns` on the adapter closure. In the `runTurn` catch, when the error is
   `preload_delivery_failed`, add the current `executionKey`, then retire the session so the retry
   builds a fresh one.
3. **Disable on retry.** `startRuntime` / `compilePromptWithLunaBudget` reads the set and, when the
   key is present, passes `disablePreload: true` into `compileLunaBudgetedPrompt`, which skips the
   `splitLunaPreamble` branch and falls through to condense → collapse (today's single-message path).
   The retry therefore delivers one slimmed message and succeeds. Because the key stays in the set,
   there is no second preload attempt — convergence in one retry.
4. **Bound** the set (e.g. reuse the retired-handle cap style) so it cannot grow unboundedly, and
   evict on turn completion/revoke.

Alternative considered — inline recompile-and-retry within one `runTurn` (abort the browser surface,
open a new one, recompile without preload) — avoids the visible error blip but is more complex and
duplicates surface lifecycle. Deferred; the Codex-retry path is simpler and the blip is a single
retryable trace line.

## Files

- `src/adapters/chatgpt-web/browser-worker.ts`: throw a classified `preload_delivery_failed`
  `ChatGptWebAdapterError` from the preamble loop / `deliverPreambleChunk`.
- `src/adapters/chatgpt-web/index.ts`: `preloadDisabledTurns` set; mark on catch; read in
  `startRuntime`; thread `disablePreload` into `compilePromptWithLunaBudget`.
- `src/adapters/chatgpt-web/luna-context-slimming.ts`: `compileLunaBudgetedPrompt` accepts
  `disablePreload` (skip the preload branch when set).
- `src/adapters/chatgpt-web/prompt.ts`: add `disablePreload?: boolean` to
  `CompileChatGptWebPromptOptions` (or thread as a dedicated param — keep it out of the browser
  envelope).
- Tests: `tests/browser-worker-contract.test.ts` (classified error shape),
  `tests/luna-context-slimming.test.ts` (disablePreload → no preamble even when over budget),
  `tests/chatgpt-web-harness.test.ts` (a preload failure marks the key and the next compile is a
  single message).

## Validation

- Unit: `compileLunaBudgetedPrompt(..., { disablePreload: true })` on an over-budget turn produces
  `preloadParts === 0` and a collapsed single message.
- Harness: simulate a browser turn that throws `preload_delivery_failed`; assert the executionKey is
  recorded and a subsequent `runTurn` for the same key compiles without preamble.
- Live smoke: force a preload failure (lower the cap to 1 on a 2-part turn, or budget-override so a
  turn needs 4 parts); confirm the turn ultimately completes via a single slimmed message with a
  single retryable trace line, not a hard failure.

## Risks and rollback

- The set must key on the stable `executionKey` (includes the user revision) so a genuinely new turn
  is not wrongly disabled. A too-aggressive TTL could disable preload for an unrelated later turn —
  key precisely and evict on completion.
- Rollback: remove the classification + set; preload failures revert to today's hard-fail (still
  only on otherwise-over-budget turns).
