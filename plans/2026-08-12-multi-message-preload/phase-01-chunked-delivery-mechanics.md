# Phase 01: chunked delivery mechanics

Status: planned

## Context

The browser worker (src/adapters/chatgpt-web/browser-worker.ts) currently delivers exactly one
composer message per turn: insert as contiguous bounded edits, verify exact text, select effort,
submit, then stream the single assistant response to completion (response-scoped copy action).
Preload needs the same machinery in a loop, with intermediate responses awaited and discarded.

## Contract

1. The prepared turn payload gains an optional ordered `preamble: string[]` alongside the existing
   final message text. Absent/empty preamble → the current single-message flow, byte-identical.
2. For each preamble chunk, in order: insert with the existing bounded-edit path, verify exact
   composer text, submit, wait for the assistant response to reach the same completion evidence
   used today, then continue. Intermediate response text is never parsed as answer, never streamed
   to Codex, and never fed to the Markdown reproduction check.
3. Each chunk ends with a fixed one-line instruction telling the model to reply with a minimal
   acknowledgement and wait; the turn does not depend on compliance — any completed response
   advances the loop.
4. Existing guards run between chunks: rate-limit dialog acknowledgement, terminal error alerts,
   abort signal, stage timeouts (each chunk gets its own submission/response stage budget).
5. Trace: one commentary line per chunk (`nạp ngữ cảnh phần i/N…` equivalent in the existing trace
   language) so the Codex trace shows preload progress; no reasoning/text deltas from preamble
   responses.
6. Effort selection happens once (first submitted message), matching today's flow on the model
   picker; subsequent messages reuse the chat's state.
7. A chunk failure surfaces a structured retryable error naming the failed chunk index; the caller
   (phase 2) decides retry/fallback. This phase adds no fallback logic.

## Files

- Modify `src/adapters/chatgpt-web/browser-worker.ts` (delivery loop, per-chunk stages, trace
  hooks).
- Modify `src/adapters/chatgpt-web/turn-execution.ts` only if the prepared-payload type lives
  there.
- Extend `tests/browser-worker-contract.test.ts` with the mocked-page harness: multi-chunk
  delivery order, exact verification per chunk, intermediate responses discarded, rate-limit
  dialog between chunks, abort mid-preamble, single-message path unchanged.

## Validation

- All new mocked-page tests green; every existing browser-worker contract test unchanged.
- No change to completion evidence requirements for the final message.

## Risks and rollback

- Completion detection on trivial "OK" responses may differ from long responses (copy action
  presence) — the mocked harness encodes today's evidence; live confirmation belongs to phase 3.
- Composer readiness after an assistant response may need an explicit wait — reuse the existing
  active-composer resolution helper.
- Rollback: the preamble field is optional; removing callers restores today's flow. Single-file
  revert plus tests.
