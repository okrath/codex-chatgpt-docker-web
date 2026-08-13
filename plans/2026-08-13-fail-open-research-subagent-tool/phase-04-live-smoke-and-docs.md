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
