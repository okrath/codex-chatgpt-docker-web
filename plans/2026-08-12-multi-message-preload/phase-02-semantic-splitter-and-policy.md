# Phase 02: semantic splitter and policy integration

Status: implemented behind an opt-in flag; static-verified (359 tests, typecheck green).

## Result

- `luna-context-slimming.ts`: `splitLunaPreamble` peels the oldest messages into preload parts until
  the remaining messages compile within budget (returns undefined when the irreducible core alone
  overflows, so the caller falls back to collapse); `chunkMessagesIntoPreamble` groups older
  messages into parts each within a per-part budget and splits a single oversized message.
- Integration: after dropping the harness-only rule sections, when the turn still exceeds budget and
  `CODEX_CHATGPT_WEB_LUNA_PRELOAD` is on, preload the older span instead of collapsing it; otherwise
  the existing collapse path runs unchanged. Usage sums the parts (`estimatedTokens`).
- **Default off.** The delivery loop is live-gated, so preload ships behind the env flag: off = the
  exact current behavior (zero risk); on = over-budget turns preload verbatim history. Once phase 3
  proves the loop live, the intended policy flip — keep `## Rule:` sections by default and make
  `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` opt-in — lands as a follow-up.
- Tests: flag parsing; per-part budget bound and oversized-message split; an over-budget Luna turn
  producing parts (each within budget, final within budget) with the flag on, and collapsing with it
  off.

## Deferred to a follow-up (after live proof)

- Flip the rule-drop default to keep-by-default (the user-intent policy change).
- Fallback-on-preload-failure retry (recompile as a slimmed single message if delivery fails);
  currently a preload-delivery failure fails the turn, which is no worse than today because preload
  only engages on turns that would otherwise hard-fail.

## Context

`compileChatGptWebPrompt` (src/adapters/chatgpt-web/prompt.ts) emits one text envelope;
`compileLunaBudgetedPrompt` (luna-context-slimming.ts) escalates slimming until it fits. This
phase decides when to preload instead, and what goes in which chunk.

## Contract

1. Splitter: when the compiled single message exceeds the Luna budget, produce ordered chunks —
   (a) system prompt + global rules/AGENTS.md content, (b) collapsed/kept history envelope,
   (c) selected skill body when present, (d) final message: current task, transport contract, tool
   contract, checkpoint contract, turn token. Each chunk ≤ a target of ~24k tokens (headroom under
   28k) and within the composer character limit; an oversized semantic unit splits by size with
   `(tiếp theo …)` continuation headers.
2. Precedence per turn (decided in index.ts prepare):
   fits single → today's path; else full+danger-full-access skill offload if that alone fits →
   today's path with offload; else preload. Preload failure → retry once → fall back to the
   current slimmed single-message path.
3. Policy change with preload available: rule sections are no longer dropped by default.
   `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` becomes opt-in trimming (env semantics documented; `off`
   keeps meaning "never trim"). History collapse still applies to keep chunk (b) bounded — preload
   does not replay unbounded history.
4. Usage estimation sums all chunks; the Luna preflight reject
   (`context_length_exceeded`) now fires only when even the *final* chunk alone cannot fit —
   preload removes the practical per-turn ceiling for splittable text.
5. Read-only and tool-capable paths both support preload; compaction turns are out of scope
   (Luna rejects separate compaction already).

## Files

- Modify `src/adapters/chatgpt-web/luna-context-slimming.ts` (splitter, budget decision, policy
  default change).
- Modify `src/adapters/chatgpt-web/prompt.ts` (chunk-aware envelope assembly, continuation
  headers).
- Modify `src/adapters/chatgpt-web/index.ts` (precedence decision, fallback wiring, trace).
- Modify `src/adapters/chatgpt-web/usage.ts` (summed estimation).
- Extend `tests/luna-context-slimming.test.ts`, `tests/prompt-contract.test.ts`,
  `tests/chatgpt-web-harness.test.ts`.

## Validation

- Under-budget turn: no preamble, prompt byte-identical to today.
- Over-budget turn with rules: rules present verbatim in chunk (a); no `## Rule:` section dropped;
  skill in chunk (c) verbatim; task+contracts complete in final chunk.
- Precedence tests: skill offload preferred when it suffices; preload engaged otherwise; fallback
  reproduces today's slimmed prompt.
- The real ~1.12M-token regression thread: history chunk stays bounded by collapse; total chunk
  count small (assert ≤ configured max, e.g. 6); over-max fails with actionable guidance.

## Risks and rollback

- Chunk-count blowup on pathological turns — hard cap with explicit error naming the oversized
  part.
- Rules kept by default could regress users who relied on silent trimming — env override retained
  and README documents the new default.
- Rollback: revert splitter integration; phase 1 mechanics stay dormant.
