---
phase: 3
title: Live smoke and docs
status: completed
effort: S
priority: P2
dependencies:
  - 2
---

# Phase 3: Live smoke and docs

## Overview

Verify the two live risks the challenge phase named — checkpoint tail survival
and procedure narration — on the real free-tier Luna account, record the token
cost, and document the feature honestly.

## Requirements

- Functional: two consecutive live Luna turns behave normally with the block
  attached.
- Non-functional: README wording must not oversell — the source repo itself
  records the Floor's benefit as unmeasured.

## Related Code Files

- Modify: `README.md` (new subsection under "What this fork changes")
- Create: `plans/2026-08-12-sealed-floor-procedure-protocol/reports/phase-03-luna-floor-live-smoke.md`

## Implementation Steps

1. Rebuild so the change is live (repo rule: repo edits require an image
   rebuild): `docker compose up -d --build`, then watch
   `docker compose logs -f codex-chatgpt-web` for the one-line
   `floor-v1 … <digest12>` load message.
2. Live smoke, turn 1 (Codex app, model **ChatGPT Web — Luna**): a small task
   with one checkable deliverable (e.g. "read <small file> and answer X").
   Verify from logs + Codex trace:
   - turn completes and streams normally;
   - the rolling-checkpoint capture still fires (checkpoint marker seen and
     stripped — same log evidence used by the preload smoke in
     `plans/2026-08-12-preload-productionization/reports/`);
   - the visible answer contains none of: "Floor", "Leftovers", "Claims",
     "Attack", "procedure", "these moves".
3. Live smoke, turn 2 (same thread): confirm the previous checkpoint was
   carried forward (Objective/Decisions survive) — this is the
   Deliver-vs-checkpoint-tail conflict check, on the turn *after* the block
   first shipped.
4. Token cost: from the logs, record the estimated input tokens of turn 1 and
   of a comparable pre-change turn (or recompute by compiling the same parsed
   request with the block disabled locally); expected delta ≈ +700.
5. If the checkpoint tail is dropped or the answer narrates the procedure:
   stop, do not commit; the pre-approved fallback order is (a) strengthen the
   final instruction line, (b) move the block before `transportContract`,
   (c) abandon per the rollback note — each retried with one smoke turn.
6. Write `reports/phase-03-luna-floor-live-smoke.md`: turns run, log excerpts,
   token numbers, narration check result.
7. README subsection (under "What this fork changes"), stating plainly:
   what the block is and where it came from (credit
   `nousai-qwen-fable-thinking`'s floor-v1), that it is digest-sealed and how
   to edit it deliberately (update `FLOOR_PROTOCOL_SHA256` in the same
   commit), the measured per-turn cost, and that the benefit is unmeasured
   upstream ("whether the Floor earns its tokens" was still an open question
   in the source repo) — verified here only as not-breaking.
8. Commit via git-manager, conventional commits, no AI references. Suggested
   shape: one commit for phases 1–2 (`feat(luna): inject the sealed Floor
   procedure contract into web turns`) and one for the smoke report + README
   (`docs(readme): document the sealed Floor procedure contract` — allowed;
   the no-docs/chore rule covers only `.claude/` changes).

## Success Criteria

- [ ] Load line with pinned digest observed in container logs after rebuild
- [ ] Two consecutive live Luna turns: normal answers, checkpoint captured
      and carried forward, zero procedure narration
- [ ] Token delta recorded in the smoke report
- [ ] README subsection merged with the honest cost/benefit wording
- [ ] Plan status flipped via `ck plan check` as phases complete

## Risk Assessment

- Free-tier live smoke consumes real turns; keep tasks tiny.
- ChatGPT product drift can change unrelated behavior mid-smoke; if failures
  look transport-shaped (selectors, submission) rather than content-shaped,
  re-run before blaming the block.
