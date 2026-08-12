# Phase 05: recall the history the checkpoint replaced

Status: implemented; static-verified (354 tests, typecheck green). Live smoke deferred to phase 4.

## Context

Live smoke of phases 1–3 confirmed the finding the design predicted: under healthy rolling-checkpoint
operation the Luna thread never accumulates raw history (each turn is `[checkpoint, ...currentTurn]`,
see `rolling-checkpoint.ts` `apply`), so history-collapse — and therefore the phase-1/2 recall — stays
dormant. Cross-turn memory is entirely the checkpoint, which is a model-authored summary and loses
exact detail (an exact string like a deploy tag will not survive unless the model wrote it into the
summary). This is the "why doesn't it remember" the user observed, and it is inherent to a fresh
Temporary Chat per turn plus summary compression.

Recall as built in phases 1–2 only backs the collapse path, which is the wrong path for this regime.

## Contract

1. When the checkpoint applies, keep the raw span it replaced (`input.slice(0, boundary)`) verbatim
   and return it as `replacedHistory: RemovedHistoryMessage[]` — out-of-band, never inside the
   compiled messages.
2. In Full mode, the checkpoint context message advertises the existing recall wire names so the
   model can search/load an exact earlier detail the summary omitted; the advertisement is present
   only when there is replaced history and only in Full mode.
3. `index.ts` attaches `[checkpointReplacedHistory, ...collapseRemovedHistory]` (reindexed) to the
   broker. Checkpoint-apply and history-collapse are mutually exclusive — collapse fires only when
   no checkpoint applied — so the concatenation keeps the collapse marker's indexes aligned.
4. Everything stays fail-open: a turn that never calls recall is byte-for-byte unchanged except for
   the ~50-token advertisement line inside the checkpoint context. Read-only and Pro are untouched.
5. Usage estimation passes the same advertise option through the per-round checkpoint apply so the
   reported token count matches the delivered prompt.

## Files

- `src/adapters/chatgpt-web/rolling-checkpoint.ts`: `apply(parsed, { advertiseHistoryRecall })`
  returns `replacedHistory`; `checkpointContext` gains the recall advertisement; converters
  `rawInputItemText` / `replacedHistoryRecall`.
- `src/adapters/chatgpt-web/index.ts`: pass the advertise option, capture `replacedHistory`, attach
  the combined recall set, keep usage estimation consistent, log `replacedHistory=N`.
- `tests/rolling-checkpoint.test.ts`: replaced history kept verbatim and out-of-band; advertisement
  present only in Full mode with replaced history.

## Result

- 354 tests, 0 fail, typecheck clean in the throwaway bun container.
- Broker log now prints `replacedHistory=N` on every applied checkpoint, so the live smoke can see
  the store populate even when collapse never fires.

## Live smoke (folds into phase 4)

1. Rebuild; on a Luna Full-mode thread, plant an exact marker in turn 1, then several turns later ask
   for that exact marker.
2. Pass = the log shows `applied=true replacedHistory=N`, the model calls `history search`/`history
   load`, and reproduces the exact marker the summary had dropped.
3. Fail-open probe: an ordinary turn completes with zero recall calls.
