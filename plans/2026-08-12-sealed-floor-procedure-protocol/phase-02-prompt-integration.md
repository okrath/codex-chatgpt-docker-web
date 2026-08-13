---
phase: 2
title: Prompt integration
status: completed
effort: S
priority: P2
dependencies:
  - 1
---

# Phase 2: Prompt integration

## Overview

Attach the sealed procedure block to every non-compaction ChatGPT Web turn
inside `compileChatGptWebPrompt`, swap the Deliver variant by tool mode, and
emit one load-time log line with the digest.

## Requirements

- Functional: block present between `transportContract` and
  `checkpointContract`; omitted on `_compactionRequest` turns (a summarization
  contract needs no answer procedure); Deliver-with-tools exactly when
  `mode.localTools` is true.
- Non-functional: zero changes to `transport-contract.ts`, the browser worker,
  slimming policy, or preload mechanics — the block rides `text`, so the
  existing token estimator and budget pipeline count it with no new code.

## Architecture

In `compileChatGptWebPrompt` (`src/adapters/chatgpt-web/prompt.ts`):

```ts
const procedureContract = parsed._compactionRequest
  ? []
  : buildFloorProcedureBlock({ localTools: mode.localTools });
```

and in the `build()` join, insert between the transport and checkpoint blocks:

```ts
const text = [
  ...sharedContract,
  ...transportContract,
  ...procedureContract,     // ← new
  ...checkpointContract,
  ...
```

Rationale for the position: the shared and transport contracts establish what
the context *is* and what capabilities exist; the procedure governs how the
answer is produced; the checkpoint contract then appends its private tail —
and the adapted Deliver section explicitly defers to later transport
obligations, so order and prose agree.

Logging: one line at first successful protocol load (not per compile — the
slimming pipeline recompiles the same turn repeatedly), through the same
logging pathway the adapter's routine slimming drops use, including
`FLOOR_PROTOCOL_VERSION` and `floorProtocolDigestPrefix()`. Attachment itself
is deterministic (all non-compaction Web turns) and documented rather than
logged.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/prompt.ts`
- Modify: `tests/prompt-contract.test.ts`

## Implementation Steps

1. Import `buildFloorProcedureBlock` in `prompt.ts`; add `procedureContract`
   and the join insertion as above.
2. Add the load-time log line in `floor-protocol.ts`'s memoized loader using
   the adapter's existing logging idiom (match how `luna-context-slimming.ts`
   reports routine drops; keep it to one line).
3. Extend `tests/prompt-contract.test.ts` with four cases using the existing
   fixtures/builders in that file:
   - read-only (no `turnToken`) turn: compiled `text` contains the header
     `[Fable procedure floor-v1]` and the adapted plain Deliver, positioned
     after the transport-contract lines and before any checkpoint/context
     lines;
   - `localTools` turn (with `turnToken`): contains Deliver-with-tools
     ("Call the tools.") and not the plain-Deliver tail paragraph;
   - compaction turn (`_compactionRequest`): `text` contains no
     `[Fable procedure` header;
   - Luna checkpoint turn (`captureLunaCheckpoint: true`): both the procedure
     block and the checkpoint contract are present, procedure first.
4. Run `bun test` (full suite — slimming and browser-worker contract tests
   assert on compiled text and may need their expected fixtures refreshed if
   they snapshot whole prompts; adjust only expectations, never behavior).
5. `bunx tsc --noEmit`.

## Success Criteria

- [ ] Four new prompt-contract assertions green
- [ ] Full `bun test` suite green (any fixture refreshes reviewed as
      expectation-only diffs)
- [ ] `bunx tsc --noEmit` green
- [ ] `git diff` shows no edits under `transport-contract.ts`,
      `browser-transport.ts`, or `browser-worker.ts`

## Risk Assessment

- Existing tests that snapshot full compiled prompts will shift — expected;
  the diff review rule is "expectations only".
- Per-turn token cost (~700) moves near-ceiling Free turns into slimming
  slightly earlier — accepted at scope approval; phase 3 records the measured
  delta.
