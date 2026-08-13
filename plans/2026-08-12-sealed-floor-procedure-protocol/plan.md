---
title: Sealed Floor procedure protocol for ChatGPT Web turns
description: >-
  Port the sealed Floor procedure prose from nousai-qwen-fable-thinking into the
  bridge's ChatGPT Web prompt contracts, digest-pinned fail-closed.
status: completed
priority: P2
branch: main
tags:
  - luna
  - prompt-contract
  - port
blockedBy: []
blocks: []
created: '2026-08-12T15:37:58.086Z'
createdBy: 'ck:plan'
source: skill
---

# Sealed Floor procedure protocol for ChatGPT Web turns

> **WITHDRAWN 2026-08-13, one day after shipping.** A controlled A/B/A over 30 live
> Luna turns measured the block failing roughly two thirds of checkpoint-capturing
> turns (13 of 20 with it, 0 of 10 without) because its Deliver section forbids exactly
> the private checkpoint tail the transport requires. Its benefit was never measured
> anywhere, including upstream. Code, prose, seal, and kill-switch were removed;
> the plan and reports are kept as the record. Measurement:
> [reports/phase-04-floor-checkpoint-omission-measurement.md](./reports/phase-04-floor-checkpoint-omission-measurement.md).

## Overview

Port the essence of `E:\Projects\nousai-qwen-fable-thinking` — the sealed Floor
procedure protocol — into this bridge. The Floor is model-facing prose (Goal /
Follow-through / Leftovers, Claims, Attack, Deliver, Deliver-with-tools) that the
Web model runs before answering. It ships as a new contract block inside
`compileChatGptWebPrompt`, between the transport contract and the checkpoint
contract, on every non-compaction ChatGPT Web turn. The prose is sealed: loaded
fail-closed against a pinned SHA-256 so editing it is a deliberate act, never a
silent behavioral drift.

Approved scope (xia challenge phase, user-confirmed): **Floor + seal only.**
- No dynamic depth gate — Floor + Claims + Attack always included; Deliver vs
  Deliver-with-tools swapped by `mode.localTools`.
- No Constraint Loop — repairs would cost browser round-trips and break the live
  answer stream into Codex; Codex's own harness already verifies via tools.
- No grounding-state port — the bridge already carries equivalent read-only and
  recall notes.

Honesty carried from the source: the Floor's *benefit* is unmeasured upstream
("Whether the Floor earns its tokens — untested"). This plan ships it as
measured-cost (~700 tokens/turn, ~2.5% of the Free ~28k budget),
unmeasured-benefit, verified-not-to-break via live smoke. Docs must say so.

## Source manifest

- Local repo: `E:\Projects\nousai-qwen-fable-thinking` (no remote)
- `protocol/floor-v1.md` — the sealed prose (five sections)
- `src/fable_thinking/protocol.py` — fail-closed loader: SHA-256 pin, CRLF
  normalization before hashing, addressable sections, explicit `ALLOW_UNPINNED`
- `src/fable_thinking/fable.py::build_system_message` — verbatim section
  assembly; header states "adds no new task and no new facts"; swaps
  Deliver → Deliver-with-tools when tools are present

## Target integration

- `src/adapters/chatgpt-web/prompt.ts::compileChatGptWebPrompt` — final message
  is joined contract blocks; the procedure block slots between
  `transportContract` and `checkpointContract`
- Only call site: `src/adapters/chatgpt-web/luna-context-slimming.ts:544` —
  slimming recompiles, so the block is rebuilt verbatim each compile and is
  never slimmed; it rides `text`, so token estimation counts it automatically
- Docker image `COPY`s only `src/`, so the prose must live under `src/`

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Sealed protocol module](./phase-01-sealed-protocol-module.md) | Completed |
| 2 | [Prompt integration](./phase-02-prompt-integration.md) | Completed |
| 3 | [Live smoke and docs](./phase-03-live-smoke-and-docs.md) | Completed |

## Dependencies

None. No unfinished plan touches `prompt.ts` (the 2026-08-11 skill-loader plan
was closed by revert `edf29f5`). Unlike the reverted skill-preamble subsystem,
this block is bridge-authored contract text delivered by the bridge itself —
the same mechanism as `sharedContract`, which demonstrably reaches the model —
so it does not depend on Codex injecting anything.

## Acceptance criteria

- [x] Editing one character of the sealed prose without updating the pin fails
      `bun test` and fails the bridge at first compile (fail-closed; tamper test
      throws, runtime path memoizes-and-rethrows every compile).
- [x] Non-compaction Web turns carry the procedure block; compaction turns omit
      it; `localTools` turns get Deliver-with-tools; read-only turns get the
      adapted plain Deliver. (5 prompt-contract tests.)
- [x] Luna live smoke: answer produced, checkpoint tail captured on two
      consecutive turns (turn 1 after its designed preload-fallback retry),
      zero procedure narration — see
      [reports/phase-03-luna-floor-live-smoke.md](./reports/phase-03-luna-floor-live-smoke.md).
- [x] `bun test` 364/364, `bunx tsc --noEmit` green; README documents the block
      with measured cost (592/667 tokens) and unmeasured benefit stated plainly.

## Rollback

Remove the `procedure/` directory and the one insertion in `prompt.ts`; no
data, schema, or transport-plan changes. Single revert commit.

## Unresolved questions

None blocking. (Sol models on paid tiers ride the same code path automatically;
this installation is Free/Luna, so only Luna is live-smokeable here.)
