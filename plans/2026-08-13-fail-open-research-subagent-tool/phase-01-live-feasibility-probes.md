---
phase: 1
title: Live feasibility probes
status: completed
effort: S
priority: P2
dependencies: []
---

# Phase 1: Live feasibility probes

## Overview

Answer the three product-behavior unknowns with live evidence before writing
feature code. Everything here is manual-plus-logs against the running
container; no repository changes except the probe report.

## Requirements

- Functional: each probe produces a recorded yes/no or a number, written to
  `reports/phase-01-subagent-feasibility-probes.md`.
- Non-functional: probes must not corrupt the stored login or leave stray
  Chromium state (close every manually opened tab; never touch the profile).

## Probes

**Probe A — second Temporary Chat while a tool call is pending (the gate).**
Start a full-mode Luna turn from the Codex app whose task forces a slow local
tool call (e.g. "run `sleep 120` with the command tool, then report done").
While the main turn is paused waiting on the tool result, open the noVNC page
(<http://localhost:7900/vnc.html?autoconnect=1&resize=scale>), open a **new
Chromium tab** → `https://chatgpt.com/?temporary-chat=true`, send a short
message, and observe whether generation runs and completes normally.
Record: works / blocked / degraded (and any UI dialog text verbatim).

**Probe B — pacing across sequential sub-chats.**
Immediately after Probe A's sub-chat completes, repeat a short message in a
fresh Temporary Chat 3 times with ~30–60 s gaps (the cadence serial sub-agents
would produce). Record where (if anywhere) responses stop being acknowledged —
the known failure shape is silent non-acknowledgement, not an error dialog.

**Probe C — wait tolerance on the pending main turn (both sides).**
Let the `sleep 120` tool call from Probe A run to completion and confirm the
main turn resumes and finishes after the ~2-minute tool wait. Then repeat with
`sleep 300`. Record: (a) does ChatGPT still consume the tool result and
continue after 2 min / 5 min; (b) does any bridge-side stall or stage timeout
fire first (`stall-timeout.ts`, `browserStageTimeouts` in browser-worker.ts —
read their current values and note them in the report); (c) Codex-side
patience if it aborts first.

## Implementation Steps

1. Confirm container healthy (`docker compose logs`, bridge listening).
2. Run probes A → B → C in that order, capturing `docker compose logs`
   excerpts and noVNC observations as they happen.
3. Write `reports/phase-01-subagent-feasibility-probes.md` with: setup, per-probe
   verbatim evidence, the three recorded answers, and the derived limits
   (max sub-agent wall time, required pacing, concurrency verdict).
4. Update `plan.md` design decisions if any probe falsifies one (timeout
   default, serial cadence, or the pending-call design itself).

## Success Criteria

- [ ] Probe A verdict recorded (gate: pass → phase 2 as designed; fail →
      redesign note in plan.md before any code)
- [ ] Probe B pacing threshold recorded
- [ ] Probe C tolerance recorded for ChatGPT, bridge, and Codex, with the
      relevant timeout constants quoted from source
- [ ] Report committed under `reports/`

## Risk Assessment

- Probes consume real free-tier turns — keep messages tiny.
- Manual browser poking via noVNC can leave a tab open; the checklist ends
  with closing manually opened tabs so the worker's page bookkeeping stays
  clean.
- Product behavior can differ day to day; date-stamp every observation.
