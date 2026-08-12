---
title: "Skill-into-preamble unification (A4)"
description: "Deliver the explicitly invoked selected-skill body as the last preload preamble part on plain Luna over-budget turns, so skill offload works on Free-tier without danger-full-access or the MCP broker. Additive: the Full+danger MCP loader stays unchanged."
status: planned
priority: P2
branch: main
tags: [luna, preload, skill, transport]
created: 2026-08-12
createdBy: claude
---

# Skill-into-preamble unification (A4)

## Objective

Close deferred item **A4** from `plans/2026-08-12-multi-message-preload` (phase-02) and the
"skill in chunk (c)" clause of its splitter contract: when a Luna turn explicitly invokes a
registered skill and the turn is over the browser budget, deliver the **skill body as the last
preload preamble part** (right before the final task message) instead of leaving it inline where it
can blow the 28k budget with no offload path.

## Why (verified in code this session)

- The selected-skill body is offloaded **only** through the MCP/turn-broker path
  (`extractSelectedSkillPacket` → broker → `codex_tool_call` load/ack), which activates **only** when
  `mode.localTools && environment.sandboxPolicy.type === "dangerFullAccess"`
  (src/adapters/chatgpt-web/selected-skill.ts:105, index.ts:240-244).
- On a plain Luna turn (no `dangerFullAccess`), the loader never activates, so the whole
  `<skill>…</skill>` body stays inline in the **final** user message. The preload splitter
  (`splitLunaPreamble`) only peels **older** messages and always keeps the final message whole
  (luna-context-slimming.ts:473-509), so a large skill in the final chunk cannot be relieved by
  preload — it collapses history uselessly or fails.
- The MCP path is also fragile: the ChatGPT product-safety layer has been observed to block the
  `codex_tool_call` manifest/load (this is what got `plans/2026-08-12-context-capsule-offload`
  cancelled). The preamble path avoids MCP entirely and already works on Free-tier.

## Design (additive, two mutually-exclusive skill modes)

| Mode | Trigger | Transport | Ack guarantee | Status |
|---|---|---|---|---|
| **MCP** (existing) | Full localTools + `dangerFullAccess` + trusted `<skill>` | broker `codex_tool_call` load/ack | SHA-256 fail-closed | unchanged |
| **Preamble** (A4, new) | Luna turn, no MCP skill, preload on, **over budget** | ordered browser chat message | delivered-to-chat (same profile as the rest of preload) | new |

- Preamble mode engages **only when the MCP loader did not** (i.e. `mcpSkill === undefined`), so the
  two never both fire on one turn. Full+danger turns keep today's MCP offload verbatim.
- Preamble mode engages **only when over budget**. An under-budget skill turn stays byte-identical
  to today (skill inline, no preamble, no contract, no reference).
- The skill body becomes the **last** preamble part (contract order: system/rules → history → skill
  → task). The final message keeps a compact reference + a "delivered in an earlier message" contract
  variant (no MCP load/ack instructions). The body is stripped from the final chunk so it no longer
  counts against the final chunk's budget; its tokens are added to the preload total and it counts
  toward `LUNA_PRELOAD_MAX_PARTS`.
- If the skill part plus history parts would exceed the part cap, preamble mode declines: the skill
  stays inline and the turn falls through to collapse — never worse than today.

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | [Extraction refactor + preamble contract variant](./phase-01-extraction-refactor-and-contract-variant.md) | done; static green |
| 2 | [Preamble skill delivery in the budget pipeline](./phase-02-preamble-skill-delivery.md) | done; static green |
| 3 | [Docs + live smoke on Luna Free](./phase-03-docs-and-live-smoke.md) | docs done; live smoke BLOCKED — Codex not injecting skill bodies (A4 inert) |

## Implementation notes (2026-08-12)

- Phase 1: `extractSelectedSkillPacket` is now a thin `dangerFullAccess`-gated wrapper over the new
  `identifySelectedSkillPacket(parsed, {strictSingle})`. MCP guards unchanged (strictSingle throws on
  a multi-skill tail exactly as before); the preamble path uses `identify` without the sandbox gate
  and treats ambiguity as "no offloadable skill". Added a `preamble` contract variant + separate
  `preambleSkill`/`preambleSkillCandidate` options in `prompt.ts` — the MCP `selectedSkill` plumbing
  is untouched.
- Phase 2: `deliverSkillAsPreamble` in the preload branch relocates the body into the last part(s);
  `index.ts` detects the candidate but keeps `selectedSkill` bound to the MCP packet, so broker
  registration and answer-hold stay MCP-only. Mutually exclusive by construction.
- Tests: 4 new A4 tests (over-budget delivery with correct ordering + budget/usage sum, under-budget
  byte-identical, Full-localTools-with-token delivery, part-cap decline). Full suite 365 pass / 0
  fail, typecheck clean.
- Independent review (phase 1-2 diff): all 8 risk areas CLEAN, no Critical/High; Low/nit items
  addressed (naming, contract sha256 nit) or documented (rule-drop decline, max-part sizing).
- Live smoke (2026-08-12): the generic preload transport and the A3 fallback are live-proven, but
  A4's own path could not be exercised — Codex Desktop 0.147.0-alpha.6.6 is not injecting a
  `<skill>` body on any sandbox (verified non-danger and danger with the correct markdown-link
  invocation; `<skill name=` count 0 both times). The same Codex injected bodies on 2026-08-11, so a
  host-side Codex behavior changed. Both A4 and the shipped MCP loader depend on that injection and
  are therefore dormant now. A4 is kept (consistent with the MCP loader) and marked inert; it
  activates automatically if injection returns. The account-mismatch hypothesis (connector under A,
  browser under B) was tested by aligning both on account A and re-running — injection stayed 0 on
  both sandboxes, so it is ruled out; injection is neither account- nor sandbox-gated. Full detail in
  [phase-03](./phase-03-docs-and-live-smoke.md).

## Acceptance criteria

- An under-budget Luna turn that invokes a skill is byte-identical to today (skill inline, no
  preamble part, no `selected_skill` reference, no skill contract).
- An over-budget plain-Luna turn that invokes a large skill delivers the skill body as the **last**
  preamble part; the final chunk carries only a compact reference + the "earlier message" contract
  variant, and the skill body bytes are absent from the final chunk. A test proves the exact body
  reaches a preamble part and not the final message.
- Usage sums the skill part; the part count (history + skill) respects `LUNA_PRELOAD_MAX_PARTS`, and
  a turn that would exceed the cap keeps the skill inline and falls back to collapse.
- The MCP loader path (Full + `dangerFullAccess`) is unchanged: same strip, same broker
  registration, same SHA-256 ack gating, same `holdBrowserTextUntilFinalized`, verified by the
  existing selected-skill/broker/harness tests staying green untouched.
- Preamble mode never registers the broker, never holds the browser answer for an ack, and never
  requires `dangerFullAccess`.
- Full suite + typecheck green; a Luna Free live smoke shows the skill body delivered as a preamble
  message and the model following it.

## Dependencies

- `plans/2026-08-12-multi-message-preload` (splitter, part cap, delivery loop) — shipped.
- `plans/2026-08-12-preload-productionization` (default-on preload, fallback) — shipped.
- `plans/2026-08-11-full-access-skill-loader` (MCP loader, packet/guard code we refactor) — shipped.

## Out of scope

- Removing or changing the MCP loader (it stays the preferred path for Full+danger).
- Delivering the skill over preamble on Full+danger turns (those already offload via MCP).
- Paid-tier (Sol/Plus/Pro) part-cap tuning.
- Persistent chat per thread (plan A).

## Risks

- Refactoring `extractSelectedSkillPacket` could weaken the MCP guards. Mitigation: keep the MCP
  wrapper's behavior byte-identical (dangerFullAccess gate + strict single-skill throw) and prove it
  with the untouched existing tests; the new `identify` helper only removes the sandbox gate and
  turns ambiguity into "no preamble skill" (return undefined) instead of throwing.
- A preamble-delivered skill has a weaker guarantee than SHA-256 ack. Accepted: it is the same
  delivered-to-chat profile as every other preamble part, and it only applies where the MCP path is
  unavailable (otherwise the turn would fail or condense the skill anyway).

## Known limitations (from the phase 1-2 review, all Low)

- **Rule-drop can decline a legit skill.** Rule-drop runs over user messages including the skill
  tail; if a skill body literally contains a `## Rule: <disposable-name>` header, its inline text
  mutates, the strip fails its text-match, and delivery declines to inline+collapse. Real skills do
  not contain the five harness section names, so this is rare; behavior is never worse than
  pre-A4 (the skill was always inline before). Left as-is; documented rather than special-cased.
- **Max-size single-part sizing (pre-existing, not introduced by A4).** `chunkMessagesIntoPreamble`
  sizes one part to ~0.85×budget raw tokens, while each delivered message also carries the ~8,192
  platform reserve, so a maxed single part could estimate ~32k against the 28k boundary. A4 only
  reuses this shipped, live-calibrated chunker for the skill message; large skills split at the
  safer ~0.595 fraction. The live smoke must confirm a near-one-part-max skill still sends (see
  phase 3). Not changed here — reversing the calibrated fraction needs live evidence, not an
  abstract bound.
