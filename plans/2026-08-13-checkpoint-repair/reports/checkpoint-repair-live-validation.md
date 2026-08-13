# Recovering an omitted rolling checkpoint instead of failing the turn

Date: 2026-08-13. Triggered by a real incident in the user's Codex task, not by a plan.

## The incident

A short-answer Luna turn (`e9bee94c088b`) ran two `git config` exec calls, answered, and omitted
its private rolling checkpoint. The bridge failed the turn — the designed behaviour at the time —
so Codex re-delivered the whole turn and **ran the same exec calls again**. The user saw
`Reconnecting /5` and the same commands executing repeatedly; the third attempt succeeded.

```
07:58:44  turn e9bee94c088b sent
07:58:53  exec call
07:59:04  exec call
07:59:18  turn failed: Luna completed without the required private rolling checkpoint
07:59:19  same turn re-opened by Codex
07:59:34  exec call AGAIN
07:59:43  completed (markdownChars=181)
```

The hazard is not the wasted minute. It is that a re-delivered turn re-runs every tool call in
it. `git config` is idempotent; `git commit`, a delete, or a paid API call is not.

## Why the model omits it

Measured earlier the same day: roughly **6 in 10 short one-sentence answers** dropped the marker
while the sealed Floor block was live. Removing that block cut the rate sharply — 0 of 14
short-answer probe turns omitted it afterwards — but the incident above happened *after* the
removal, so omission is rarer now, not gone.

## What changed

When the marker is missing, the bridge no longer fails the turn. The answer has already been
streamed to Codex, so it asks the same chat for the checkpoint alone, once, and uses the reply.
Only if that also comes back empty does the turn fail as before.

- One follow-up message, one attempt. Every message counts against the account's rapid-message
  limit, and the model has already demonstrated it can ignore an instruction.
- The reply is never streamed to Codex — the answer is already delivered and cannot be replaced.
- The recovery is lenient about the marker in the reply: refusing it for the very reason the
  recovery exists would defeat the point.
- The hash is taken over the answer Codex actually received, because that pairing is what the
  store looks up later.

## Live validation

The failure is stochastic and would not reproduce on demand: four short-answer turns in a row all
produced checkpoints normally. So the branch was forced with a throwaway build (a temporary
condition, removed again afterwards; no test-only knob was left in the source) and one real turn
was run:

```
browser turn a0e87b9e9844 answered without its rolling checkpoint; asking for it in the same chat
browser diagnostic trace=a0e87b9e9844 checkpoint=15-checkpoint-missing
browser diagnostic trace=a0e87b9e9844 checkpoint=16-checkpoint-recovered
browser turn a0e87b9e9844 recovered its rolling checkpoint from a follow-up message
browser turn a0e87b9e9844 completed (markdownChars=60)
```

No turn failure, no re-delivery, the exec call ran once. The recovered checkpoint was then
confirmed **persisted**: it is the newest of 160 entries in
`/root/.codex-chatgpt-web/runtime/luna-checkpoints.json`, keyed to the forced-repair thread.

## A latent bug found while reading, not while running

The first version set the turn's final text to the delivered answer `.trim()`ed. The store rejects
a checkpoint whose hash disagrees with the answer it is committed with, and its canonical form
strips only the *trailing* end — so an answer beginning with whitespace would have produced two
different hashes and failed the turn for a reason unrelated to checkpoints. The answer is now
handed over unchanged, and a test pins that leading whitespace is significant while trailing
whitespace is not.

## Not verified

Whether a recovered checkpoint carries the same *quality* as one produced inline. It parses,
stores, and is keyed correctly; whether the model writes as good a checkpoint when asked
separately is unmeasured. If continuity degrades on long threads, that is the first thing to look at.
