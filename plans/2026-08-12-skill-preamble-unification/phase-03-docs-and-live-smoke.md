# Phase 03: docs + live smoke on Luna Free

Status: docs done. Live smoke BLOCKED — the trigger (an injected `<skill>` body) does not occur in
the user's current Codex Desktop (0.147.0-alpha.6.6). A4 is correct and statically green but inert
in this environment. See "Live smoke findings" below.

## Live smoke findings (2026-08-12)

Ran repeatedly on the user's Free Luna via the rebuilt full-mode container. Result: **A4's activation
condition is never met in the current Codex setup, so A4 could not be exercised live.** Evidence:

- The generic preload transport works live at the real 28k budget: `📨 Luna preload split ... 1
  part`, final message under budget, then normal tool rounds — no MCP. The A3 delivery-failure
  fallback also fired once (preamble timeout → collapse → fit) and recovered the turn. So the shared
  delivery loop A4 rides on is live-proven.
- But **Codex is not injecting a `<skill name="X">…</skill>` body** into the request. It surfaces
  skills as a catalog (`<skills_instructions>`) and expects the model to read `SKILL.md` on demand.
  Verified across turns with the correct markdown-link invocation
  `[$ck:ck-plan](C:\Users\trung\.agents\skills\ck-plan\SKILL.md)`:
  - `workspace-write` (non-danger): `<skill name=` count 0 → A4 has no body to relocate.
  - `danger-full-access`: `<skill name=` count 0 too → so injection is NOT sandbox-gated; it is
    simply absent. (SKILL.md files contain no `<skill name=` text, so this is real, not file-read
    noise.)
- Same Codex version on 2026-08-11 DID inject skill bodies (65 `<skill name=` markers in a session),
  so a **host-side Codex behavior/config changed** between 08-11 and now and turned injection off.
  This is outside the bridge's control.

### Consequence

Both A4 (preamble path) and the pre-existing MCP loader depend on Codex injecting a `<skill>` body.
With injection off, **both are dormant**. A4 is kept (consistent with the shipped MCP loader) and
marked inert; it will activate automatically if/when injection returns.

### Account hypothesis — tested and ruled out (2026-08-12)

The user suspected an account mismatch (connector/tunnel under ChatGPT account **A**, Docker Chromium
under **B**) as the cause. We reset the Docker browser login (cleared only
`browser/storage-state.json` + `.verified.json` + `login-profile`; kept the tunnel), re-logged the
browser and Codex Desktop onto account **A**, and re-tested with the correct link-form invocation on
both sandboxes. Result: `<skill name=` count still 0 across 4 rollouts (2 `workspace-write` + 2
`danger-full-access`), no `user_selected_skill` in the log. **Injection is not account- or
sandbox-gated — it simply does not occur.** The earlier belief that 08-11 injected was wrong: those
markers were build-time test fixtures. No retained rollout contains a real injected `<skill>` tail.

### Standing question — CLOSED (2026-08-12): injection does not occur in this setup

Resolved by an exhaustive check:

- Scanned **all 543 retained Codex session rollouts** → **zero** real standalone
  `<skill name="X">…</skill>` user-item tails (the shape the bridge detects).
- The full-access-loader plan keeps **no captured request evidence** (no `reports/`); its
  `<skill>` / `codex_tool_call` mentions are plan *descriptions*, and its test fixtures are
  hand-authored (`<skill name="ck:ask">…` in `tests/selected-skill.test.ts`), not captured Codex
  output.
- Live confirmation the same day: the bridge log detected **no** skill tail across four tests
  (2 `workspace-write` + 2 `danger-full-access`, browser + Codex Desktop + connector all on account
  A).

**Conclusion:** Codex Desktop 0.147.0-alpha.6.6 does not inject a `<skill>` body in this setup, and
there is no retained proof it ever did (the 2026-08-11 "smoke" left no trace and cannot be trusted).
Both A4 and the shipped MCP selected-skill loader depend on that injection, so **both are inert /
effectively dead code here** — kept per the user's decision and documented; neither has runtime
effect unless Codex's skill mechanism starts emitting `<skill>` bodies. Skills themselves work fine
via the catalog + on-demand `SKILL.md` read (e.g. the ck:plan run that produced
`plans/2026-08-12-transport-layer-refactor`).

## Docs (done)

### README.md

- Updated the "Selected skill offload" section to describe the two modes (MCP loader on
  Full+`danger-full-access`; preamble delivery on plain over-budget Luna).
- Updated the "Multi-message preload" section to note the skill body can be the last preload part and
  counts toward `LUNA_PRELOAD_MAX_PARTS`.
- Security framing kept precise: preamble mode is instructions-only.

## Deferred live-smoke checklist (run if injection is restored)

Preconditions: skill-body injection restored (see hypothesis above), container rebuilt, Luna signed
in, preload default-on.

1. Invoke a **large** skill on a turn already near/over budget (e.g. a big `$ck:` skill plus enough
   history to exceed ~28k after rule-drop) on a plain Luna turn (no `danger-full-access`).
2. Expect the bridge log to show the preload split with an extra part and one
   `preload part i/N` line for the skill part; the browser receives the skill body as an earlier
   message, then the task.
3. Confirm the model's answer follows the skill procedure (semantic proof it received the body).
4. Confirm no broker skill registration / no ack handshake occurred for this turn (it is the
   preamble path, not MCP).
5. Control: a small skill on an under-budget turn stays inline (no preamble part) — byte-identical
   to today.
6. Max-size part check (from review): run a skill sized near one preload part
   (~20-23k tokens, big enough to fill a single part but not split). Confirm ChatGPT accepts the
   part message rather than rejecting it near the ~28k boundary (the part's ~0.85 fraction plus the
   hidden platform reserve is the risk). If it rejects, tighten the per-part fraction — but only
   with this live evidence, since the fraction was calibrated by the shipped preload smoke.

## Validation

- `bun test tests/*.test.ts` full suite green.
- `bunx tsc --noEmit` green.
- Independent review (code-reviewer) on the phase 1-2 diff before the live smoke, given it touches
  the prompt contract and the budget pipeline.
- Live smoke evidence recorded in `./reports/`.

## Exit

- On green + live smoke pass: set `plan.md` status to `complete`, mark phases done, and record the
  smoke result in the plan implementation notes.

## Risks / rollback

- If the live smoke shows the model ignoring a preamble-delivered skill (weaker than ack), tighten
  the contract wording or, as a fallback, keep the skill inline and rely on collapse — never worse
  than today. Rollback is the phase-2 option gate.
