# Phase 02 (A2): enable preload by default

Status: done; live-exercised (preload engaged automatically).

## Context

Preload ships off behind `CODEX_CHATGPT_WEB_LUNA_PRELOAD` (`lunaPreloadEnabled` in
`luna-context-slimming.ts`). With phase 1's fallback in place, a preload failure can no longer break
a turn slimming would have carried, so preload can become the default over-budget path.

## Design

1. **Flip the default.** `lunaPreloadEnabled` returns true unless the env explicitly disables it
   (`off`/`0`/`false`). Keep the env as the override in both directions.
2. **Compose default.** Update `docker-compose.yml` so the tracked default is on (or leave it
   unset and let the code default decide; document either way). The budget-override knob stays empty
   (real 28k).
3. **Scope check.** Preload still engages only when the compiled single message exceeds the budget
   after rule-drop, so a turn that fits is unchanged. Confirm the `preloadParts === 0` path for
   under-budget turns is byte-identical.
4. **Part cap interplay.** Default-on relies on `LUNA_PRELOAD_MAX_PARTS` (default 3, from live smoke)
   to bound Free-tier throttling; turns needing more parts fall back to collapse. No change here,
   just documentation that it is now on the default path.
5. **Docs.** Update the README section from "experimental, opt-in" to default behavior with the env
   as a disable switch; keep the ~3-message Free-tier caveat.

## Files

- `src/adapters/chatgpt-web/luna-context-slimming.ts`: default of `lunaPreloadEnabled`.
- `docker-compose.yml`: default value + comment.
- `README.md`: promote the preload section from experimental to default.
- Tests: `tests/luna-context-slimming.test.ts` — default-on when env unset; explicit `off` disables;
  under-budget turn produces no preamble.

## Validation

- Unit: env unset → preload engages on an over-budget turn; `off` → collapse path; under-budget →
  no preamble regardless.
- Live smoke on free Luna with **no env overrides**: an ordinary large turn (near the real 28k
  boundary) preloads and completes; a normal small turn shows no preload lines. Because the rolling
  checkpoint keeps most turns ~27k, capture at least one genuinely over-budget turn (e.g. a large
  freshly pasted instruction) to exercise the default path.

## Risks and rollback

- Most turns fit ~27k under the checkpoint, so default-on changes little day to day; the risk is
  concentrated on the rare over-budget turn, which phase 1 protects.
- Rollback: restore the default to off (one-line change + compose + README).
