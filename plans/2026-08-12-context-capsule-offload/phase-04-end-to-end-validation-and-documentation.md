---
phase: 4
title: "End-to-end validation and documentation"
status: pending
priority: P2
dependencies: [3]
---

# Phase 4: End-to-end validation and documentation

## Overview

Run the full validation stack, get an independent review, and update `README.md` only after phases 1-3 are green. No README change is allowed before the combined end-to-end gates pass.

## Requirements

- Functional: re-run a combined Full plus `danger-full-access` smoke that exercises instruction capsules, history capsules, snapshots, oversized-task handling, and selected-skill coexistence together.
- Functional: README update must describe the feature as a browser-transport bypass only, not as model-context expansion (`README.md:46-78`).
- Non-functional: keep Browser-only/Pro behavior claims unchanged unless proven otherwise by tests and smoke.
- Non-functional: independent review must happen before README is finalized.

## Architecture

- No new architecture surface should be added here. This phase validates the prior three phases against the existing Full-mode capability flow in `docs/security-model.md:9-27` and `docs/architecture.md:30-45`.
- Documentation scope is intentionally narrow: `README.md` only, after live gates pass. If architecture/security docs also need changes, capture that as a follow-up instead of widening this experiment phase silently.

## Related Code Files

- Modify only after all prior gates are green: `README.md`
- Re-run without source changes: `tests/context-capsules.test.ts`, `tests/prompt-contract.test.ts`, `tests/selected-skill.test.ts`, `tests/luna-context-slimming.test.ts`, `tests/chatgpt-web-harness.test.ts`, `tests/turn-broker-lifecycle.test.ts`, `tests/chatgpt-web-usage.test.ts`
- Independent review target: the final implementation diff touching `src/adapters/chatgpt-web/*`, tests, and `README.md`

## Implementation Steps

1. Run the full test suite and typecheck using the repo scripts from `package.json:25-36`.
2. Run a combined live Full smoke that includes: required instruction capsules, selected-skill coexistence, older history recall, immutable snapshot recall, and an oversized current task.
3. Run an independent review over the final diff. Default review lens: bugs, regressions, unsafe gating gaps, missing tests, and README over-claims.
4. Update `README.md` only after steps 1-3 are green. Keep the text explicit that the experiment bypasses browser transport pressure and does not expand ChatGPT's true context window.
5. Record any residual limitations discovered during smoke/review; do not soften them into marketing language.

## Validation Commands

```powershell
bun test tests/*.test.ts
bunx tsc --noEmit
```

Independent review:

- Run `/ck:code-review` on the final implementation diff before touching `README.md`.

Combined live smoke:

```powershell
docker compose exec codex-chatgpt-web codex-chatgpt-web doctor
docker compose logs codex-chatgpt-web --tail=300
```

Combined semantic smoke contract:

- Use one disposable thread that exercises all four payload classes in order: instruction-only marker, selected skill, older history marker, large prior snapshot, and oversized current task.
- Pass only if every required load/ack occurs before native action, the final answer uses the offloaded markers correctly, and no README text contradicts the measured behavior.

## Success Criteria

- [ ] `bun test tests/*.test.ts` passes.
- [ ] `bunx tsc --noEmit` passes.
- [ ] Independent review finds no unresolved high-severity bug/regression in gating, transport, or docs.
- [ ] Combined live Full smoke passes with both mechanical and semantic evidence.
- [ ] `README.md` is updated only after all above gates pass and does not claim model-context expansion.

## Risk Assessment

- Medium likelihood x High impact: README could overstate the feature as a context-window increase. Mitigation: require wording review against `README.md:46-78` and the actual smoke evidence before merge.
- Medium likelihood x Medium impact: focused tests pass but combined coexistence path regresses. Mitigation: combined live smoke is mandatory and blocks README/merge if it fails.
- Low likelihood x High impact: review misses a fail-open gate. Mitigation: keep independent review after full suite and combined smoke so the reviewer sees the real final diff and evidence.

## Security Considerations

- Reconfirm that all required-capsule paths still depend on trusted outer-turn metadata and that no capsule load survives revoke/finalize (`docs/security-model.md:11-20`, `src/adapters/chatgpt-web/turn-broker.ts:239-250`).
- Reconfirm that MCP ABI stayed at the same six top-level tools (`src/adapters/chatgpt-web/mcp-server.ts:227-433`).

## Rollback

- If any full-suite, review, or combined-smoke gate fails, revert only the README change first and keep docs out of the branch until the code path is green.
- If code also needs rollback, revert the failing phase commit(s) in reverse order with `git revert`, never `reset --hard` on the shared worktree.
