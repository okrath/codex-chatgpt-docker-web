---
phase: 3
title: "Browser delivery runtime"
status: done (safe scope)
priority: P1
dependencies: [2]
effort: "1-2d"
---

# Phase 3: Browser delivery runtime

## Overview

Extract the browser transport runtime from the large `browser-worker.ts` orchestration surface. The
runtime should execute a prepared transport plan: attach exact text, submit ordered preamble parts,
wait for completion evidence, then stream the final response.

## Requirements

- Functional: preserve exact composer verification, response completion detection, aborts, stage
  timeouts, rate-limit/session error handling, effort selection, file attachment, and final streaming.
- Non-functional: browser delivery must be reusable by launcher and managed-browser paths without
  duplicating the DOM loop.

## Architecture

```text
TransportPlan
  -> BrowserTransportSession
       -> prepare Temporary Chat
       -> deliver preamble[] (discard responses)
       -> deliver final message
       -> stream final text/events
       -> release/close
```

The new runtime boundary should expose structured delivery outcomes/errors. `browser-worker.ts` keeps
browser-specific selectors, page lifecycle, diagnostics, and model/effort handling; a focused delivery
module owns the repeated attach/submit/wait sequence.

## Related Code Files

- Create: `src/adapters/chatgpt-web/browser-transport.ts` for reusable delivery mechanics.
- Modify: `src/adapters/chatgpt-web/browser-worker.ts` to delegate delivery and retain page/session
  lifecycle responsibilities.
- Modify: `src/adapters/chatgpt-web/launcher-helper-client.ts` only if its prepared-turn boundary must
  adopt the new contract.
- Modify: `src/adapters/chatgpt-web/turn-execution.ts` only if delivery outcomes need a typed runtime
  result rather than changing session semantics.
- Tests: `tests/browser-worker-contract.test.ts`, `tests/chatgpt-web-harness.test.ts`.

1. Enumerate the current delivery sequence and all early exits in `runBrowserTurn`,
   `deliverPreambleChunk`, submission acceptance, completion tracking, and final streaming.
2. Extract the repeated "attach -> verify -> submit -> wait" primitive with an explicit stage context.
3. Extract preamble iteration so intermediate responses are discarded and never enter the Codex text
   feed or Markdown reproduction checks.
4. Keep final-answer streaming and checkpoint capture on the existing path until the new delivery
   runtime is proven; only then reduce the old method to orchestration.
5. Preserve launcher notifications, maintenance serialization, and active-run limits outside the
   delivery primitive.
6. Add deterministic tests for ordering, exact verification, intermediate-response suppression,
   abort between parts, timeout on a part, rate-limit detection, and final-message streaming.

## Implementation Steps (done 2026-08-12, safe scope)

**Scope decision (user-approved):** the full physical extraction of the entire `runBrowserTurn` DOM
loop (completion tracking, streaming, checkpoint capture) into a standalone runtime was deliberately
NOT done. That loop is the live-verified delivery path, deeply entangled with worker page/session/
diagnostics state, and can only be verified here with mocked tests — a blind full extraction risked
regressing the user's live delivery for mostly structural gain. Instead the safe, self-contained,
test-covered mechanics were extracted and the transport contract was threaded through the boundary.

- New `src/adapters/chatgpt-web/browser-transport.ts`: owns the reusable delivery *sequence and error
  policy* — `chatGptPreambleMessageText` (moved here) and `deliverPreambleParts(parts, deliverPart,
  isAborted)`, which iterates ordered parts and classifies any non-abort mid-delivery failure as the
  retryable `preload_delivery_failed`. It imports no worker/page types; the caller supplies the DOM
  `deliverPart` step.
- `browser-worker.ts`: builds `ChatGptWebTransportPlan` from the prepared prompt and now reads
  `plan.finalMessage` / `plan.preamble` / `plan.images` / `plan.estimatedInputTokens` /
  `plan.trimmedCompactionMessages` at the delivery boundary. The preamble loop is replaced by a call
  to `deliverPreambleParts` (DOM chunk delivery stays in the worker as the callback). The intricate
  completion/streaming/checkpoint code is untouched — same stage names, timeouts, evidence.
- Tests: `deliverPreambleParts` gets behavioral coverage (empty → no-op, in-order wrapped delivery,
  abort passthrough, retryable-failure classification); the brittle source-string assertion was
  replaced.

## Success Criteria

- [x] Browser delivery accepts the phase-1 transport contract (`plan.*`) without inspecting Luna policy.
- [x] Preamble delivery iteration/error policy is a single reusable primitive (`deliverPreambleParts`);
      the shared preamble+final submission primitive at the DOM level stays in the worker (see scope).
- [x] Intermediate responses never reach `ChatGptTextFeed` (unchanged; deliverPreambleChunk untouched).
- [x] Abort/timeout/error behavior remains equivalent (same classification, same stage timeouts).
- [~] Launcher and managed-browser paths: unchanged — they already share `runBrowserTurn`; no DOM loop
      was duplicated or moved, so this stays as-is (not regressed).
- [x] Browser-worker contract and harness tests pass (109 in those suites; 352 total).

## Risk Assessment

Risk: completion evidence differs for short acknowledgement responses versus final answers. Mitigation:
keep the existing `ChatGptCompletionTracker` and `responseDomSnapshot` as the source of truth.

Risk: moving code changes diagnostic timing. Mitigation: preserve stage names and trace checkpoints;
only change ownership, not the evidence or timeout values.

## Security Considerations

The delivery runtime must remain a dumb transport executor. It must never expose or reinterpret broker
tokens, sandbox policy, selected-skill authorization, or trusted environment data.
