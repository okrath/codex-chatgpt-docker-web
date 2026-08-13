# Phase 4 live smoke — the research sub-turn on free-tier Luna

Date: 2026-08-13. Container rebuilt from this branch with
`CODEX_CHATGPT_WEB_SUBAGENT=on`; six turns driven against the live bridge with the
probe client from the sibling plan, adapted to take a task string. Evidence below is
from `docker compose logs` and the probe's own event logs.

## Verdict: the mechanism works and the model uses it. The default stays **off**, because one observed sub-turn failure took the parent turn with it.

## Scenario 1 — a turn that does not need research is unchanged

A trivial `git rev-parse HEAD` task completed in 31.6 s with no sub-turn requested and
the rolling checkpoint captured. Switching the tool on costs nothing when it is unused.

## Scenario 2 — the model calls it, unprompted: **3 of 5 research-shaped tasks**

This is the question no unit test could answer, and the one the cancelled context-offload
experiments failed 5/5. Here the model reached for the tool on its own:

| Task | Called? | Sub-answer | Parent answer | Total |
|---|---|---|---|---|
| rate-limiting algorithm choice | **yes** | 2,267 chars | 698 chars | 30.4 s |
| Raft vs Viewstamped Replication | **yes** | timed out (15 s budget, see scenario 3) | — | 51.1 s |
| Raft vs VR, default budget | **yes** | 7,336 chars | 11,310 chars | 56.5 s |
| Raft vs Paxos | no | — | 10,635 chars | 54.2 s |
| Raft vs VR, repeated | no | — | 15,615 chars | 45.7 s |

Fail-open is doing exactly what it promised: the model asks when it wants to and answers
unaided when it does not, and neither case fails. The two that did not call still produced
long, complete answers, so nothing was lost by their choice.

**A real sub-turn is fast.** The successful one broke down as chat preparation 2,379 ms,
prompt attachment 327 ms, send 735 ms, and roughly 8 s of generation — about **11.5 s end
to end**, against a 180 s default budget. The budget was derived from what is safe, never
from what is needed; this is the first measurement of the latter, and it says the default
could come down a long way.

## Scenario 3 — containment holds at the tool, and fails at the turn

With the budget forced to 15 s, the sub-turn timed out and the tool result came back
exactly as designed:

```
research sub-turn 1 failed: The research sub-turn could not answer:
The research sub-turn did not answer within its 15s budget. Continue without it.
```

That sentence is correctly aimed at the model — no "retry the turn", no launcher
instructions. But the parent turn then died:

```
turn failed: ChatGPT changed a completed text block that was already streamed to Codex
```

**What that means.** The model had already streamed prose to Codex before calling the
tool. Receiving the failure, it rewrote that prose, and the main-turn Markdown buffer
refuses a committed block changing under deltas the caller has already received. So the
error reached the model cleanly and the model's *reaction* to it killed the turn —
defeating the feature's central promise that a sub-chat can never fail the turn that
asked.

**It is the error path, not the feature.** The identical task with the default budget
completed normally (sub-answer 7,336 chars, parent 11,310 chars), so merely having a
sub-turn in flight is fine.

**Honest limit on this finding: n = 1.** Two reproduction attempts failed to reach the
error path at all, because on those runs the model chose not to call the tool. So it is
not known whether the parent reliably dies on a sub-turn failure, or whether that once
was a coincidence of how the model happened to be composing.

## Decision

`CODEX_CHATGPT_WEB_SUBAGENT` stays **off by default**. A single unexplained parent-turn
death on the failure path is not something to ship on, and the same evidence is far too
thin to call it systematic — which is precisely why the answer is "not yet" rather than
either "ship it" or "abandon it".

Nothing about this decision reflects on the mechanism, which worked on every axis it was
tested: spontaneous adoption, isolation from the parent page, speed, capping, and error
wording.

## What has to happen before the default flips

1. **Reproduce or refute the parent-turn death.** Force the error path repeatedly — the
   surest way is a question the model reliably delegates plus a very low budget. If it
   reproduces, the fix is upstream of this feature: either the Markdown buffer tolerates a
   rewrite that follows a tool result, or the turn survives it some other way.
2. **Retune the budget** from 180 s toward what scenario 2 measured (~12 s typical),
   leaving headroom for a sub-turn that searches the web.
3. Work through the remaining live checks already listed in the phase file — parent
   liveness while the sub tab is foreground, two-tab selector behaviour, storage-state
   hygiene, abort-on-revoke, and diagnostics retention.
