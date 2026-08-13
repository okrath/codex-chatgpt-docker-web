---
phase: 4
title: "Live smoke and docs"
status: pending
effort: "S"
priority: P2
dependencies: [3]
---

# Phase 4: Live smoke and docs

## Overview

Prove the tool live on the real free Luna account — including the one thing
tests cannot show, whether the model calls it **spontaneously** — then flip the
default on, document honestly, and commit.

## Requirements

- Functional: three live scenarios pass (below).
- Non-functional: README wording keeps the fail-open framing and states quota
  and latency costs plainly; default flips on only after the smoke passes.

## Checks the phase-2 review says only a live run can settle

Fold these into the scenarios below; each one is a condition no unit test in
this repository can reach, because the worker has no DOM double.

1. **Throttle at send.** Drive sub-turns until ChatGPT's rapid-message dialog
   appears; the sub-turn must fail fast rather than spin. This is the live proof
   that the send stage is bounded.
2. **Parent liveness while the sub tab is foreground.** `context.newPage()`
   focuses the new tab; confirm the parent keeps streaming and heart-beating,
   and record the parent's total pending-call duration against the 300 s
   probe.
3. **Sub-turn wall time with web search engaged** — the prompt invites search,
   and searching Luna turns run long. Is 180 s enough?
4. **Two-tab selector behaviour.** `activeComposer` requires exactly one visible
   composer; confirm that holds with two ChatGPT tabs open, along with the
   send-button ancestor lookup and the stop-button locator.
5. **Model assertion in the sub tab** — `selectModelAndEffort` throws if a model
   selector appears; confirm the second tab renders the Luna-only composer.
6. **Markdown transient.** Watch a long multi-paragraph answer for
   "removed a completed text block"; that string would mean the completion-time
   observe still sees an empty snapshot.
7. **Storage-state hygiene.** The sub Temporary Chat must leave no history entry
   and no changed model preference in the persisted state.
8. **How long a real sub-turn takes**, including one that searches the web. The
   180 s default and 240 s cap were derived from what is safe, never from what
   is needed; measure the distribution and retune.
9. **Total pending-call duration of the parent** while a sub-turn runs, against
   the 300 s that probe C actually verified. Refusing to queue keeps the worst
   case at one sub-turn's runtime, but only a live run confirms it.
10. **Abort on revoke.** A parent that finishes while its sub-turn still runs
    leaves that chat generating; today only cancellation stops it. Watch for an
    orphan sub-chat after a completed turn and decide whether `revoke()` must
    abort in flight.
11. **Diagnostics retention.** Each sub-turn takes one of the ten retained trace
    directories; confirm the parent's own directory survives a 3-sub-turn turn,
    or nest sub-turn artifacts under it.

## Live smoke scenarios

Rebuild first (`docker compose up -d --build`), run with
`CODEX_CHATGPT_WEB_SUBAGENT=on`.

1. **Ignored tool (regression).** A trivial full-mode Luna task that needs no
   research: turn completes normally, no sub-chat opened, checkpoint intact.
2. **Spontaneous call (the point).** A research-shaped task whose answer the
   context cannot contain (e.g. "so sánh hai thuật toán X/Y cho bài toán Z,
   nêu nguồn"): expect broker log for `__codex_research_subagent_v1`, a
   `-sub1` diagnostics directory, an answer that visibly uses the sub-agent's
   findings, outer checkpoint captured. If the model never calls the tool
   across 3 differently-shaped research tasks, record that honestly as the
   fail-open trade-off showing up — the feature stays, expectations in README
   get calibrated (this is measurement, not failure of the turn).
3. **Failure containment.** Force a sub-turn failure (temporarily set the
   sub-turn timeout very low via the probe-derived knob): the tool result
   carries the structured error, the outer turn still completes.

Record all evidence (log excerpts, trace ids, timings, quota observations) in
`reports/phase-04-subagent-live-smoke.md`.

## Implementation Steps

1. Rebuild, run scenarios 1–3, write the smoke report.
2. If smoke passes: flip `chatGptSubagentEnabled()` default to on, update the
   compose comment, rerun scenario 1 once on defaults.
3. README: new subsection describing the tool — what it does, fail-open (the
   model may not use it), serial + cap 3, measured latency per sub-turn from
   the smoke, quota burn note, probe-measured limits, env kill-switch.
4. Memory-worthy operational facts recorded in the plan report (pacing limits,
   tolerance numbers) for future sessions.
5. Commits via git-manager (conventional, no AI references): one `feat(luna)`
   for phases 2–3 code, one `docs` for README + this plan directory. No push
   unless asked.

## Success Criteria

- [ ] Scenario 1: no behavior change when unused (live)
- [ ] Scenario 2: spontaneous call observed with end-to-end answer flow — or
      the honest null recorded after 3 shaped attempts
- [ ] Scenario 3: sub-turn failure contained, outer turn completes
- [ ] Default flipped only after pass; README merged; commits created

## Risk Assessment

- Scenario 2 is model-behavior-dependent — the fail-open design's known
  trade-off; the smoke measures it rather than guaranteeing it.
- Free-tier product drift mid-smoke: if failures look transport-shaped
  (selectors, submission), re-run before blaming the feature.
