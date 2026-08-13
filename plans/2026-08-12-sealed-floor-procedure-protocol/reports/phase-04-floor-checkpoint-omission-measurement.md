# The Floor block breaks Luna's rolling checkpoint — measured, and the feature is withdrawn

Date: 2026-08-13. Controlled A/B/A against the live free-tier Luna account, one build,
one env var (`CODEX_CHATGPT_WEB_FLOOR`), 30 turns total. Harness: the probe client from
`plans/2026-08-13-long-exec-connection-interruption/reports/long_pending_exec_probe.py`
(`--hold 0`), which drives one small full-mode tool-loop turn per run.

## Result

| Arm | Floor | Turns | Failed on checkpoint omission |
|---|---|---|---|
| A | on | 10 | **7** |
| B | **off** | 10 | **0** |
| C | on | 10 | **6** (one further turn failed on an unrelated connector-menu drift) |

Pooled: **13 of 20 with the block, 0 of 10 without.** Fisher's exact test on those
counts gives p ≈ 0.0004; the A/B/A ordering rules out product drift over the ~50-minute
window, and an independent earlier block measured 6 of 10 with the Floor on
(`plans/2026-08-13-long-exec-connection-interruption/`, 10:15–10:40).

Arm B's absence of the block was verified rather than assumed: zero
`sealed Floor procedure floor-v1 loaded` lines in the container log for that window.

Note on counting: the probe's own `outcome` field undercounts, because it truncates the
terminal detail at 600 characters and so labels a multi-round omission as a plain
`failed`. The table counts the bridge's own log line
(`turn failed: ChatGPT Luna completed without the required private rolling checkpoint`).

## Why this is severe rather than cosmetic

An omitted checkpoint fails the whole Codex turn. Codex then re-delivers the entire turn
immediately, and on a large preload turn those re-deliveries are what die with ChatGPT's
delivery timeout — the retry storm reconstructed in the sibling plan burned 23 minutes
and six attempts on a single request. The Floor block was arming that loop on roughly
two thirds of checkpoint-capturing turns.

## Mechanism

The Floor's Deliver section instructs *"Answer the original request and nothing else in
the user-facing answer … do not append a summary of your own reasoning."* The rolling
checkpoint is precisely a thing appended after the answer, and precisely a summary of
task state. The two contracts contradict each other, and the model resolves the conflict
in favour of the section it read last and most emphatically.

This exact conflict was raised in review before the feature shipped (finding "High #1")
and was answered with one added paragraph exempting "transport obligations". That
mitigation is now measured as insufficient. The shipping smoke saw one omission in two
turns and recorded it as a watch item; two turns could not distinguish that from noise.

## Decision: remove the feature

The Floor's *benefit* has never been measured anywhere — the upstream project that
originated it records "whether the Floor earns its tokens" as untested, and this fork
never tested it either. What is now measured is that it costs ~600 tokens per turn and
breaks about two thirds of checkpoint turns. An unmeasured benefit does not justify a
measured failure rate, so the block, its prose, its seal, and its kill-switch are
removed rather than left disabled — matching the precedent set when the selected-skill
offload subsystem was deleted rather than kept dormant. Git history holds it if anyone
later wants to demonstrate a benefit first.

What survives, and is worth keeping in mind: the digest-pinned fail-closed loader
pattern (sealed prose that cannot drift silently) was sound and is preserved in history
at commit `2ef97d7`; the probe harness that produced these numbers is committed under
the sibling plan and can measure any future prompt-contract change the same way.

## Open question this measurement does not answer

Checkpoint omission at **0 of 10** without the Floor is better than the pre-Floor state
was ever shown to be, but no pre-Floor baseline was ever recorded — the earliest
omission data on record already had the block. If omissions reappear without it, they
have a different cause and need their own measurement.
