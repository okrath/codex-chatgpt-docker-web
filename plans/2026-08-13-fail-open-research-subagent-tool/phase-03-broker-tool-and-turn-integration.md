---
phase: 3
title: Broker tool and turn integration
status: completed
effort: M
priority: P2
dependencies:
  - 2
---

# Phase 3: Broker tool and turn integration

## Overview

Expose the sub-turn as the reserved wire name `__codex_research_subagent_v1`
on the turn broker, advertise it with one sentence in the full-mode transport
contract, and enforce the per-turn call cap — all behind
`CODEX_CHATGPT_WEB_SUBAGENT` (default off until phase 4 passes).

## Requirements

- Functional: a full-mode turn may call the tool up to 3 times; each call runs
  one serial sub-turn and returns `{ answer, truncated }` or
  `{ error, reason }`; calls 4+ return a structured refusal, never a thrown
  turn failure.
- Non-functional: flag off ⇒ byte-identical contracts and broker behavior
  (regression-locked); no public tools/list or schema change (the Native3
  connector-identity lesson — discovery is contract prose only).

## Architecture

- **Broker** (`turn-broker.ts`): register the wire name beside the recall
  tools' dispatch; turn-scoped state gains `subagentCallsUsed`. Validation:
  `question` string, min/max chars (max derived from the phase-2 token guard);
  over-cap or malformed input returns a structured error result (fail-open
  posture: the model can correct and retry within its cap).
- **Advertisement** (`prompt.ts`): one sentence appended to the full-mode
  transport contract when the flag is on, mirroring the recall tools' fail-open
  phrasing — "when the task genuinely needs focused research beyond this
  context, you MAY call `codex_tool_call` with `__codex_research_subagent_v1`
  and a self-contained question; the result arrives as an ordinary tool
  result." Exact wording drafted in implementation, tested by substring.
- **Turn runtime** (`index.ts`): wire the broker dispatch to the phase-2 entry
  point with the probe-derived timeout; sub-turn failures map to the structured
  error result. Any state that must survive a Codex retry lives at module
  scope, not adapter closure (the preloadDisabledTurns lesson, commit c3e888c).
- **Env flag**: `chatGptSubagentEnabled()` beside the preload flag helpers;
  compose file gains the commented-out knob.
- **Result hygiene**: the answer is data. The tool result wraps it with the
  same data-not-instructions framing the recall tools use.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/turn-broker.ts`
- Modify: `src/adapters/chatgpt-web/prompt.ts` (one conditional contract line)
- Modify: `src/adapters/chatgpt-web/index.ts`
- Modify: `src/adapters/chatgpt-web/research-subagent.ts` (env flag helper,
  request validation shared with the broker)
- Modify: `docker-compose.yml` (commented knob), `tests/prompt-contract.test.ts`
  (flag on/off contract assertions), `tests/turn-broker.test.ts`-adjacent suite
  (cap, validation, refusal shapes)

## Implementation Steps

1. Flag helper + regression test: flag off ⇒ compiled prompt and broker
   claims byte-identical to today.
2. Broker wire name, validation, per-turn cap, structured refusals.
3. Runtime wiring with timeout + failure mapping; module-scope state audit.
4. Contract sentence behind the flag; prompt-contract tests for both flag
   states and for read-only turns (never advertised — tool-capable turns only).
5. Full suite + typecheck in the throwaway container.

## Success Criteria

- [ ] Flag off: zero diffs in compiled contracts and broker behavior (tests)
- [ ] Flag on: cap enforced (4th call refused structurally), malformed input
      refused structurally, sub-turn failure returns an error result and the
      outer turn still completes in tests
- [ ] Read-only and compaction turns never see the advertisement
- [ ] Full suite + `bunx tsc --noEmit` green

## Risk Assessment

- The broker's skill-ack gating interacts with tool exposure; the subagent
  tool must be reachable in plain full-mode turns (it is not part of the
  selected-skill flow) — verify against the finalize/pending-action gate fixed
  in the skill-loader review (e971a21) so an abandoned subagent call cannot
  hold the answer hostage.
- Prompt-injection surface: a hostile page summarized by the sub-agent flows
  back as a tool result. Mitigation: data-not-instructions framing plus the
  existing sharedContract rule that fenced content is conversation data; noted
  in README rather than treated as newly introduced (web search in the main
  turn already carries this class of risk).
