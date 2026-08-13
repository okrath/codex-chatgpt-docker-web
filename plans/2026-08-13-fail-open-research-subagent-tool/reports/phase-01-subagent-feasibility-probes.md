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

## Probe C — long tool waits: **WITHDRAWN, this section's conclusion was wrong**

> **Correction 2026-08-13.** Everything in this section rests on the belief
> that a connector call was pending for ~5 minutes. It was not. Codex
> Desktop's exec harness yields after ~11 s ("Script running with cell ID N"),
> so the pending window was 11 s, and the failing attempts 2-6 had **no tool
> call pending at all** — they were Codex re-deliveries after attempt 1 failed
> on an omitted rolling checkpoint. Controlled probes that really do hold a
> connector call open measured **no failure threshold anywhere between 120 s
> and 300 s**: the 240 s and 300 s holds both completed with the checkpoint
> captured (container logs: `browser turn 4f1800e5b178 completed
> (markdownChars=60)`, `193314a74d8d completed (markdownChars=62)` —
> independently verified here). The real failure is a retry storm of large
> (~27k-token) preload connector re-deliveries, not duration.
>
> Full reconstruction, the 120/180/240/300 s probe table, and the implemented
> watcher recovery:
> `plans/2026-08-13-long-exec-connection-interruption/reports/phase-01-incident-reconstruction-and-pending-call-probes.md`.
>
> **Consequence for this plan:** the 90 s / 120 s sub-agent cap derived below
> is unfounded and is lifted — see the design-consequences section.

The original (superseded) observations are kept below for the record.

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

### Source-level diagnosis of the failure (read 2026-08-13, no code changed)

The failing check is `ChatGptTurnDomHealthTracker.update` in
`browser-worker.ts:395-405`: when a response is present, the stop button is
gone, some text exists, and the completed-turn footer action never appears —
for `CHATGPT_COMPLETION_ACTION_GRACE_MS = 60_000` with the text unchanged —
it returns *"ChatGPT stopped generating but did not expose its completed-turn
action; the ChatGPT DOM may have changed"*, which line 1990 throws.

The message misattributes the cause. Nothing in `src/adapters/chatgpt-web`
knew about the interruption banner (grep for "interrupted" matched nothing),
so a dead stream was reported as selector drift. What actually happens — per
the reconstruction linked above, which read the Codex rollout and every
attempt's diagnostics — is that ChatGPT's own delivery fails on the
re-delivered turn: the assistant stream dies within 30 s of send, the banner
appears, ChatGPT gives up ~245 s later with *"Message delivery timed out.
Please try again."* plus an unused in-page **Retry** button, and the watcher's
60 s completion-action grace then throws. The grace resets whenever the text
changes (`:401-402`), so a stream that genuinely recovers is already tolerated;
what was missing was any reaction to the product's own give-up state.

Backgrounding was considered as a confound for attempts 2–3 (a probe tab was
open) and **ruled out**: the container's Chromium runs with Playwright's
`--disable-background-timer-throttling`,
`--disable-backgrounding-occluded-windows`, and
`--disable-renderer-backgrounding` (verified on the live process). This also
removes a risk from the subagent design itself — opening a second tab cannot
throttle the parent tab.

## Consequences for the design (updates plan.md)

Rewritten 2026-08-13 after the Probe C correction above.

- **The pending-call window is wide, measured, and not the constraint.**
  Controlled holds of 120/180/240/300 s all parked the ChatGPT turn in a
  healthy working state (status line + stop button) and resumed instantly when
  the result arrived; the broker holds the tunneled MCP call unbounded
  (`mcp-server.ts` `invocationTimeout` → `null`). A sub-turn that finishes in
  the tens of seconds sits far inside proven-safe territory.
- **Sub-agent timeout: 180 s default, 240 s hard cap.** Chosen as roughly half
  the longest proven-safe hold rather than derived from an instability
  threshold, because no threshold was found. It bounds a stuck sub-chat, it
  does not protect the parent.
- **Opening a second tab cannot throttle the parent tab** (anti-throttling
  flags verified on the live process, above).
- **The real production risk is elsewhere and now has an owner:** an omitted
  rolling checkpoint fails the turn, Codex re-delivers the whole ~27k-token
  preload turn immediately, and those re-deliveries are what die. Watcher
  recovery for the give-up state is implemented on branch
  `claude/vigilant-matsumoto-987485`; damping the retry storm at its source is
  an open recommendation there.
- **Watch item that grew teeth:** checkpoint omission was measured at **6 of
  10** completed probe turns (short one-sentence answers). Every one of those
  samples is post-Floor, so whether the Floor block changed that rate is
  untested — and there is now a cheap reproducer to test it with.

## Cleanup

- The manually opened probe tab was identified by content (it held both probe
  exchanges) and closed; the worker's in-flight page was left untouched. The
  zombie probe turn itself resolves via Codex timeout or user cancel.
- `xdotool` was installed ephemerally in the running container only (lost on
  recreate); nothing on the image changed.
