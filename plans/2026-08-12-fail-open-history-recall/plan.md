---
title: "Fail-open history recall and checkpoint upgrade"
description: "Give Luna turns verbatim access to collapsed history through optional broker tools, and densify what survives slimming: a budgeted collapse index and a structured rolling checkpoint."
status: planned
priority: P1
branch: main
tags: [feature, mcp, luna, context]
created: 2026-08-12
createdBy: claude
---

# Fail-open history recall and checkpoint upgrade

## Objective

Reduce the information loss the user experiences after Luna context slimming, without repeating
the failed fail-closed loader designs. Three independent improvements:

1. **Recall (C):** collapsed history stays available verbatim through optional MCP tools.
2. **Index (C/D bridge):** the collapse marker carries a budgeted table of contents.
3. **Checkpoint (D):** the rolling checkpoint gets an advisory structure so decisions, touched
   files, facts, and open work survive turns.

## Design stance (from evidence)

- The cancelled loaders (`plans/2026-08-12-context-capsule-offload`,
  `plans/2026-08-12-read-only-context-loader`) failed because loading was **mandatory before
  acting**; Luna skipped model-directed sequences 5/5 live retries.
- Full-mode tool loops DO work (skill loader smoke, exec/patch turns) — Luna calls tools when the
  task motivates it.
- Therefore: every new capability here is **fail-open**. A model that never calls the new tools
  gets today's behavior exactly. No new gate, no new completion requirement, no connector change
  (`Codex Native2` untouched, public tools/list unchanged — the Native3 lesson).

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | [Fail-open history tools](./phase-01-fail-open-history-tools.md) | implemented; static green, live smoke pending |
| 2 | [Budgeted collapse index](./phase-02-collapse-index.md) | planned |
| 3 | [Structured rolling checkpoint](./phase-03-structured-checkpoint.md) | planned |
| 4 | [Validation, live smoke, docs](./phase-04-validation-and-docs.md) | planned |

Phases 1–3 are independent; each can ship or roll back alone. Phase 4 gates README changes.

## Acceptance criteria

- Fail-open invariant: a turn in which the model never calls the new wire names produces the same
  events, usage, and prompt as today except for the marker/advertisement text.
- `__codex_load_collapsed_history_v1` returns the exact UTF-8 text of removed messages; state is
  turn-scoped RAM and disappears on revoke.
- In a skill-gated turn the new wire names are rejected before the skill ack (existing funnel
  unchanged).
- Public MCP schema, connector identity, and inventory contract unchanged.
- Marker + index token cost is bounded at every slimming escalation step; a 1,000+-collapsed-message
  thread cannot regress into per-message placeholder costs (regression test).
- Checkpoint schema is advisory: capture/commit mechanics accept freeform payloads unchanged; live
  smoke shows ≥3 consecutive Luna turns still produce checkpoints.
- Full suite + typecheck green in the throwaway bun container; browser-only and Pro turns unchanged.

## Dependencies

- Existing turn broker channel lifecycle and reserved-wire-name interception (skill loader).
- Existing collapse mechanism in `luna-context-slimming.ts` (single-marker design, commit 0673a91).
- Live smoke needs the user's signed-in Luna session and full mode (`Codex Native2` connected).

## Out of scope

- Multi-message deterministic preload (plan B) and persistent chat per thread (plan A) — separate
  plans; this plan must not block them. Related policy question deferred to plan B: stop dropping
  `## Rule:` sections by default once budget pressure is solved by transport, since auto-cutting
  user-authored instructions overrides user intent.
- Any mandatory pre-answer protocol.
- Persisting history beyond the turn (RAM only).

## Safety invariants

- History served through the broker is exactly what Codex already sent in the request — no new data
  authority, no filesystem access, read-only.
- Reserved wire names are synthesized and intercepted inside `mcp-server.ts`; they never become
  outer Codex tool batches.
- Skill-gate funnel order preserved: pre-ack inventory and actions stay minimal.
- Caps fail soft: an over-cap history store skips attachment and logs; the turn proceeds as today.

## Open questions (resolve during phase 4 smoke)

1. How large an MCP tool result renders reliably in ChatGPT web before the product truncates it —
   sets the per-call payload cap (start 32k chars, adjust from evidence).
2. Does Luna spontaneously use optional recall tools when the marker advertises them? If never,
   phases 2–3 still stand alone; note the finding for plan B prioritization.
3. Whether the checkpoint schema instruction changes checkpoint compliance rate (must not fail
   turns more than today).
