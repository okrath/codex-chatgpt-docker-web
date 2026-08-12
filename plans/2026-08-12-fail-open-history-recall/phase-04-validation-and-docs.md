# Phase 04: validation, live smoke, docs

Status: planned

## Context

README changes only after live validation (repo convention, followed by the skill loader). The
bridge container does not bind-mount src/ — live smoke needs a rebuilt image.

## Static gate

- Throwaway container: `docker run --rm -v <repo>:/app -v /app/node_modules -w /app
  oven/bun:1.3.14 sh -c "bun install --frozen-lockfile && bunx tsc --noEmit && bun test
  tests/*.test.ts"` — all green.
- Grep the built runtime image for the new wire names to confirm they shipped.

## Live smoke (user's Luna session, full mode, disposable git workspace)

1. Rebuild: `docker compose up -d --build`; `doctor` ends `ready`.
2. Seed a Luna full-mode thread past the collapse threshold (long tool-heavy synthetic or a real
   working thread). Verify in logs: collapse fired, history attached, marker carries index +
   advertisement.
3. Recall probe: ask about a verbatim detail that only exists in the collapsed span (e.g. an exact
   marker string planted in an early tool result). Pass = model calls search/load and answers with
   the exact string. Record whether tools were called at all (plan open question 2).
4. Fail-open probe: ordinary question needing no recall — turn completes with zero recall calls.
5. Skill funnel probe: `$ck:ask` turn — pre-ack recall call rejected, post-ack works.
6. Checkpoint probe: ≥3 consecutive turns; every turn captures a checkpoint; sections carry
   forward updated, not restarted.
7. Confirm no workspace writes and cancel any active browser turns afterward.

## Docs (after smoke passes)

- README: extend the Luna slimming section — collapsed history is searchable/loadable in Full
  mode, marker carries an index, checkpoint is structured; state the fail-open stance and the
  trade-off change (verbatim recall now possible on demand).
- Update this plan's statuses and record measured caps (tool-result size, index budgets) and the
  open-question answers.

## Risks and rollback

- Smoke failures map to single-phase rollbacks (phases are independent); README untouched until
  pass.
- If recall tools are never used by the model across smokes, keep phases 2–3, mark phase 1 as
  shipped-but-unproven, and carry the finding into the multi-message preload plan (plan B).
