# Phase 1 probe report — subagent feasibility on free-tier Luna

Date: 2026-08-13. Container: production build (Floor contract live). Probe turn:
a full-mode Luna task instructing exec `powershell -Command Start-Sleep -Seconds 300`
(trace `0dd8fe08db16`, ~28.7k tokens, delivered via preload 1 part + final).
Second-chat interactions were driven through the container's own X display
(`xdotool` on `DISPLAY=:99`), watched via noVNC.

## Probe A — second Temporary Chat while a tool call is pending: **PASS**

While broker logs showed the sleep exec delivered but not completed
(`queued call=call_mFHVVkmbqPzQ tool=exec` … no `completed`), a second Chromium
tab in the same (incognito) context opened `chatgpt.com/?temporary-chat=true`,
arrived logged-in, accepted a message, and generated a complete answer
("pong", with copy/regenerate controls) within seconds.

**Gate open:** a sub-agent chat can generate while the main turn is paused on a
pending connector call. The design's core assumption holds.

## Probe B — pacing: no throttle observed at sub-agent cadence

Within ~10 minutes the account processed ≥8 fresh-chat browser messages
(worker preload parts + final messages across delivery attempts, plus two
manual probe chats — "pong" and "two", both answered promptly) with no silent
non-acknowledgement. The known ~3-rapid-messages throttle is per-chat;
sequential *separate* temp chats at 30–60 s spacing showed no product
pushback today. Adequate for a serial, capped (≤3/turn) sub-agent design; not
a guarantee under heavier duty.

## Probe C — long tool waits: **the real finding, and it is a warning**

ChatGPT-side patience for the pending connector call itself was fine: after
the full 5-minute sleep, the tool result flowed back through the tunnel.

But the **chat that waited did not stay healthy**. Observed sequence:

1. During the 5-minute wait, the main chat displayed
   *"Connection interrupted. Waiting for the complete answer"* — observed
   **before** any probe interaction with the browser existed.
2. After the wait, generation stopped without the completed-turn action:
   `turn failed: ChatGPT stopped generating but did not expose its
   completed-turn action` (attempt 1).
3. The bridge/Codex retry re-delivered the whole turn into a fresh chat
   (attempts 2, 3, diagnostics `0dd8fe08db16-326715a6` et seq.) — attempt 2
   failed identically with hands off the browser; attempt 3 showed the same
   interruption banner while generating.

Contamination was suspected on attempt 1 (X-focus keystrokes could have hit
the worker's page) and then ruled out: post-hoc inspection of the probe tab
showed the full stray sequence — navigation to a fresh Temporary Chat and the
"Reply with exactly one word: two" → "two" exchange — landed entirely in the
probe's own tab. All three attempt failures are clean product failures. The
X-focus hazard remains worth noting for anyone probing by keyboard again; the
real implementation drives Playwright page handles, which are
focus-independent.

Comparison points: the same day's Floor smoke turns (no long tool wait)
completed normally, and the probe's own small second-chat message generated
fine — the instability correlates with the **large connector turn + minutes-
long pending call**, not with ChatGPT being globally degraded.

Bridge-side constants for reference: upstream stall budget 300 s
(`stall-timeout.ts`), browser stage timeouts 20–150 s per stage
(`browser-worker.ts:239`), preload ack timeout 180 s default.

## Consequences for the design (updates plan.md)

- **Sub-turn wall time must stay well under the instability window.** Default
  sub-agent timeout: **90 s**, hard cap 120 s — not the 240 s guess. A
  research answer that needs longer must be split by the caller into smaller
  questions.
- **The pending-call window is usable but is not a parking lot.** One serial
  sub-agent per pending call, immediately returning the result, keeps the
  main chat's wait short. The cap of 3 calls/turn stands, but each call's
  budget is what protects the parent chat.
- **Separate risk logged:** minutes-long *local* execs (nothing to do with
  sub-agents) already put the parent chat into the interrupted state on
  today's product. That failure mode exists in production now and retries
  currently churn; worth its own investigation outside this plan.

## Cleanup

- The manually opened probe tab was identified by content (it held both probe
  exchanges) and closed; the worker's in-flight page was left untouched. The
  zombie probe turn itself resolves via Codex timeout or user cancel.
- `xdotool` was installed ephemerally in the running container only (lost on
  recreate); nothing on the image changed.
