# Phase 03: live smoke, limits reconnaissance, docs

Status: live smoke passed on free Luna; reconnaissance complete; two fixes landed.

## Live smoke result (2026-08-12, free Luna, preload on, lowered budget to force splits)

- **1-part (2 messages):** full end-to-end pass — part delivered and acknowledged, final task answered.
- **2-part (3 messages):** full pass — `preload part 1/2` and `2/2` each completed in ~7-8s, then
  the final task message answered. Repeated cleanly across several turns.
- **4-part (5 messages):** parts 1-3 completed in ~6.5s each; **part 4 never acknowledged and timed
  out at 180s**, failing the turn. No rate-limit dialog appeared — a silent throttle. The per-chat
  limit resets per turn (each retry replayed parts 1-3 fine).

## Findings and fixes

1. **Composer preservation (fixed):** a raw-text preload part failed the exact after-insertion
   verification (multi-line text becomes many Lexical blocks). Fix: serialize each part as the same
   escaped JSON envelope the main prompt uses, and size parts by the serialized length.
2. **Free-tier per-chat message limit ≈ 3 (fixed):** the 4th rapid message stalls. Fix:
   `LUNA_PRELOAD_MAX_PARTS` (default 3, env-overridable); a turn needing more parts falls back to
   collapse instead of failing.

## Reconnaissance conclusions

- Safe preload depth on Free Luna is ~3 messages total (so ~2 context parts + the final). At the
  real 28k budget each part is ~20k tokens, so preload covers turns up to roughly 2×20k of peelable
  older context before the cap forces a fallback — beyond that, collapse (with verbatim recall)
  handles it.
- Part delivery is ~6.5-8s each; no inter-part delay was needed below the cap.
- Rate limiting here is silent (no dialog), so the 180s per-part timeout is the backstop.

## Deferred

- README stays minimal (an experimental opt-in note) until preload is enabled by default; enabling
  by default depends on the rule-keep policy flip (phase 2 deferred item).
- A future paid-tier pass could measure a higher part cap.

## Context

Everything product-dependent lands here: Free-tier rate limits, Temporary Chat message caps,
intermediate-response latency and quota cost. README changes only after this passes.

## Reconnaissance (before enabling by default)

1. Manual probe on the user's Free session: send N short messages back-to-back in one Temporary
   Chat via the bridge's delivery loop; record where rate limiting or dialogs appear; derive safe
   chunk pacing (delay or dialog-handling) and a practical max chunk count.
2. Verify completion evidence on minimal "OK" responses (copy action present?) — adjust phase 1
   evidence handling if the product renders trivial responses differently.

## Live smoke

1. Rebuild container; `doctor` ready.
2. Over-budget read-only Luna turn (system prompt + rules + big pasted context): verify chunks
   delivered in order, rules followed by the model (probe: a distinctive style rule from
   AGENTS.md is obeyed), answer streams normally, usage sums chunks.
3. Over-budget full-mode turn with `$ck:...` skill: skill delivered as chunk (no MCP load/ack in
   logs), tool loop works, checkpoint captured.
4. Fallback probe: force a chunk failure (e.g. abort mid-preamble in a test harness or via
   restart) and confirm the retry/fallback path produces today's slimmed turn.
5. Quota observation: note Free-tier usage consumption across the smoke; document per-turn cost.

## Docs (after smoke passes)

- README: rewrite the Luna slimming section around the new default — nothing user-authored is cut;
  over-budget turns are delivered in parts; slimming remains as fallback and for history bounding;
  `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` documented as opt-in.
- Update both this plan and `plans/2026-08-12-fail-open-history-recall` cross-references and
  statuses; record measured limits.

## Risks and rollback

- If reconnaissance shows tight Free-tier message limits (e.g. <4 chunks safe), keep preload
  gated to turns that slimming cannot save (today's hard-fail cases only) — still a strict
  improvement.
- If Temporary Chat caps conversation length, cap preload accordingly and document.
- Rollback: disable the preload decision (phase 2), keeping mechanics dormant; README reverts.
