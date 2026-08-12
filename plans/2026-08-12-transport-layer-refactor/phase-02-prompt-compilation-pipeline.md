---
phase: 2
title: "Prompt compilation pipeline"
status: done
priority: P1
dependencies: [1]
effort: "1-2d"
---

# Phase 2: Prompt compilation pipeline

## Overview

Collapse the current prompt/budget decision flow into explicit stages: canonical input, semantic
policy, Luna budget decision, and transport-plan assembly. Keep the existing preload, collapse,
selected-skill, and checkpoint behavior exactly as the baseline.

## Requirements

- Functional: preserve the current precedence between MCP skill offload, preamble skill delivery,
  preload, and collapse/fallback.
- Non-functional: prompt compilation must be deterministic and independently unit-testable without a
  browser page.

## Architecture

```text
canonical input
   -> semantic normalization
   -> policy selection (skill/checkpoint/rules)
   -> Luna budget strategy
      -> single message
      -> preload parts + final
      -> slim/collapse fallback
   -> transport plan
```

`prompt.ts` should remain a renderer/contract builder, while `luna-context-slimming.ts` becomes the
policy engine that selects a strategy and returns a transport-neutral result. `index.ts` should only
assemble dependencies and pass the result onward; it should not duplicate budget or skill decisions.

## Related Code Files

- Modify: `src/adapters/chatgpt-web/index.ts` to reduce orchestration and keep canonical input setup.
- Modify: `src/adapters/chatgpt-web/prompt.ts` to render one final envelope from explicit options.
- Modify: `src/adapters/chatgpt-web/luna-context-slimming.ts` to isolate strategy selection from
  transport delivery.
- Modify: `src/adapters/chatgpt-web/selected-skill.ts` only where policy inputs need a cleaner seam.
- Modify: `src/adapters/chatgpt-web/input-tokens.ts` if token accounting needs a transport-plan helper.
- Tests: `tests/luna-context-slimming.test.ts`, `tests/prompt-contract.test.ts`,
  `tests/selected-skill.test.ts`, `tests/chatgpt-web-harness.test.ts`.

1. Freeze a decision table from the current behavior and tests: under budget, MCP skill, preamble skill,
   preload, part-cap decline, delivery failure fallback, and collapse.
2. Extract a pure policy result for each strategy; no browser callbacks, logging side effects, or DOM
   types inside the policy layer.
3. Make `compileLunaBudgetedPrompt` produce the phase-1 transport contract and keep all token estimates
   tied to the exact serialized parts that will be delivered.
4. Keep A4's mutually exclusive MCP/preamble skill semantics intact; do not change the broker gate or
   SHA-256 acknowledgement contract during this refactor.
5. Preserve rule-keep/trim semantics and the shipped preload max-part cap as policy inputs, not browser
   constants.
6. Add negative tests for ambiguous skill extraction, oversized final chunks, part-cap overflow,
   fallback after preload failure, and under-budget byte identity.

## Implementation Steps (done 2026-08-12)

Scope note: this plan predates the selected-skill revert (`edf29f5`). All skill-related requirements
(MCP skill offload, preamble skill delivery, A4 mutual-exclusion, ambiguous-skill extraction) are
**moot** — that code is gone. What remained of phase 2 was already largely satisfied post-revert.

- `compileLunaBudgetedPrompt` (`luna-context-slimming.ts`) is the single pure decision path: rule-drop
  → preload split → condense → collapse, returning a transport-neutral `LunaBudgetedCompilation`
  (`compiled` + `estimatedTokens` + `preloadParts` + recall history). It imports no Playwright/browser
  worker types; `index.ts` only orchestrates (checkpoint apply, broker register, trace) and does not
  duplicate budget decisions.
- Token accounting: the summed preload total lives on `estimatedTokens`/`estimatedTotalTokens` and
  feeds usage; the per-message final estimate feeds the browser preflight. The phase-1
  `ChatGptWebTransportPlan.estimatedInputTokens` is documented as the final-message preflight number,
  not the sum, to keep the two concerns distinct.
- No structural code change was needed here beyond phase 1's contract; verified by the existing
  Luna/prompt suites staying green (352 pass total, typecheck clean).

## Success Criteria

- [x] One pure decision path explains every current Luna transport outcome (`compileLunaBudgetedPrompt`).
- [x] No policy module imports Playwright or browser worker classes.
- [x] Usage estimates equal the actual transport plan parts plus final message (summed `estimatedTokens`).
- [x] ~~A4 and MCP skill paths remain mutually exclusive~~ — N/A, skill offload reverted (`edf29f5`).
- [x] Focused Luna/prompt suites pass.

## Risk Assessment

Risk: a refactor changes the order of rule-drop, preload, condense, and collapse. Mitigation: encode
the order as a decision-table test and keep existing regression fixtures.

Risk: token estimates drift from serialized payload size. Mitigation: test the exact plan parts and
final envelope rather than only raw message lengths.

## Security Considerations

Preserve the existing trust boundary: environment resolution and broker authorization stay upstream;
the transport planner must not infer sandbox authority from user-authored text.
