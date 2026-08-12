# Phase 03: structured rolling checkpoint

Status: implemented; static-verified (353 tests, typecheck green). Live smoke deferred to phase 4.

## Result

- `prompt.ts` `checkpointContract` only: headings are now Objective / Decisions / Files touched /
  Learned facts / Open work, plus an explicit carry-forward instruction — treat the checkpoint as a
  rolling record, carry still-relevant items forward, drop only resolved or superseded ones, never
  restart from scratch. Over-budget guidance drops the oldest already-resolved detail first.
- Capture/store/replay stay content-agnostic: no heading parsing anywhere, so freeform and legacy
  checkpoints keep working (existing issue-89 opaque test still green).
- Test: the prompt carries the new sections and the carry-forward wording when capture is enabled.

## Context

The Luna rolling checkpoint (src/adapters/chatgpt-web/rolling-checkpoint.ts, `checkpointContract`
in src/adapters/chatgpt-web/prompt.ts) is a freeform private summary the model appends each turn;
the bridge replaces completed history with it next turn. Freeform prose favors recency over
importance — decisions and file lists from earlier turns silently drop out. This phase makes the
content instruction structured while keeping capture mechanics byte-compatible.

## Contract

1. `checkpointContract` gains an advisory schema instruction: maintain four short sections —
   `Decisions`, `Files touched`, `Learned facts`, `Open work` — and **update the previous
   checkpoint's sections rather than restarting**, dropping only items that are resolved or
   superseded. Existing marker mechanics, token cap (`CHATGPT_LUNA_CHECKPOINT_MAX_TOKENS`), and
   privacy wording unchanged.
2. Capture, validation, store, and commit paths in rolling-checkpoint.ts stay content-agnostic: a
   freeform (non-schema) checkpoint is accepted exactly as today. No parsing of the sections
   anywhere in the bridge — the schema exists only in the instruction to the model.
3. No new failure modes: the only checkpoint-related failures remain the existing ones (missing
   tail, duplicate tail).

## Files

- Modify `src/adapters/chatgpt-web/prompt.ts` (checkpointContract wording only).
- Extend `tests/prompt-contract.test.ts` and `tests/rolling-checkpoint.test.ts`.

## Validation

- Prompt test: schema instruction present only when checkpoint capture is enabled; absent on
  compaction/read-only-non-Luna prompts.
- Rolling-checkpoint tests: freeform payload and schema-shaped payload both capture, store, and
  replay identically; malformed payloads keep today's opaque handling (issue-89 test still green).
- Token-cap test unchanged.

## Risks and rollback

- The larger instruction costs ~80–120 prompt tokens on every Luna turn — measure in tests; if the
  cost pushes borderline turns into slimming, that is acceptable (slimming exists for this).
- A schema instruction could reduce the model's checkpoint compliance (missing tail fails the turn
  today). Phase 4 smoke runs ≥3 consecutive turns; if compliance drops, revert wording — one-file
  rollback.
