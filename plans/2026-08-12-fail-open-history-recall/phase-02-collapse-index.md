# Phase 02: budgeted collapse index

Status: planned

## Context

The collapse marker today says only how many messages and tokens were removed. Commit 0673a91's
lesson: per-message placeholders cost tens of thousands of tokens on long threads — any index must
be bounded by construction, not by hope. Pure prompt text, so this phase also benefits read-only
Luna turns (no tools needed).

## Contract

1. `collapseOldLunaHistory()` builds a compact table of contents for the removed span and embeds it
   in the single marker message, after the existing removal sentence.
2. Chunking: contiguous runs of removed messages grouped per line. Line content is derived
   deterministically from the messages: `#<firstIndex>–<lastIndex> · <roles summary> · <tool names
   with counts> · "<first ~60 chars of the first user text in the run>"`. No model involvement.
3. Budget: index token cost measured with the existing token estimator. Per-escalation-step budget:
   step 1 → 1,000 tokens, step 2 → 600, step 3 → 300, deepest step → 0 (no index). Coarsening loop:
   start at 10 messages/line, double (20/40/80…) until within budget; if a single line still
   overflows, truncate oldest lines and append `…`.
4. Marker total (removal sentence + index + phase-01 advertisement when present) is counted by the
   normal budget estimation — an index can never push a fitting turn over 28k because the
   escalation loop recompiles with the index included.
5. When phase 01 is present, index lines give the model the `index` values it can pass to
   `__codex_load_collapsed_history_v1`; without phase 01 the index is still useful as orientation.

## Files

- Modify `src/adapters/chatgpt-web/luna-context-slimming.ts` only.
- Extend `tests/luna-context-slimming.test.ts`.

## Validation

- Index present and within budget for a 60-message synthetic collapse; references real content.
- Regression: 1,000+ removed messages → marker + index total tokens ≤ step budget + removal
  sentence cost; line count bounded by coarsening (assert ≤ removed/10 and ≤ budget-derived cap).
- Deepest escalation step emits no index (byte-identical marker to today at that step).
- Escalation still converges: the ~340k synthetic thread from the slimming tests compiles ≤ 28k
  with the index enabled.
- Read-only and tool paths share the same marker builder (no divergence beyond the phase-01 flag).

## Risks and rollback

- Index lines may leak long file paths into the prompt — lines are hard-truncated at ~120 chars.
- Risk of double-counting budget: index is built before the budget re-estimate inside the same
  escalation iteration; test asserts the final estimate includes it.
- Rollback: single-file revert; marker returns to the plain removal sentence.
