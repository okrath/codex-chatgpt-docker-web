# Phase 03 (A1): preserve user rule content by default

Status: done; static green.

## Context

The original ask was "stop auto-cutting user-authored instructions." Verified in code, the picture
is narrower than it sounded:

- **Rule-drop** removes only five named harness-only sections; a user's own `## Rule:` is not
  touched. Keep dropping the five — they are useless to the Web model and cost ~4-5k tokens.
- **Condense** (`condenseLunaRuleSections`) is what trims *user* rule sections to their first
  paragraph when over budget. This is the real "cutting user content."
- Preload already runs **before** condense, so when preload is on and succeeds, condense never runs
  and user rules reach the model verbatim in the preamble.

So enabling preload (phase 2) already preserves user rule content on turns where preload fits. This
phase closes the remaining gaps and proves the behavior.

## Design

1. **Prefer preload over condense (already the order) — verify and lock it in.** Add a regression
   test that an over-budget turn containing a custom `## Rule: user-guidance` section, with preload
   on, delivers that section's full text in a preamble part (not condensed) and never invokes
   condense. Guards against a future reorder.
2. **Condense only as a preload-unavailable fallback.** Confirm condense runs only when preload is
   off or `splitLunaPreamble` returned undefined (core too big / over the part cap). Document that
   condensing user rules is now a last resort, after preload and before collapse.
3. **Keep the harness-only drop, but make the list auditable.** Leave `LUNA_DISPOSABLE_RULE_SECTIONS`
   dropping the five harness sections by default (correct), and keep
   `CODEX_CHATGPT_WEB_LUNA_TRIM_RULES` as the override. Document clearly that this list is
   *harness-only* and does not touch user-authored rules, so users are not surprised.
4. **Optional (decide with the user):** a stricter mode that also preloads (rather than drops) the
   five harness sections, for users who want the Web model to see everything. Off by default —
   dropping provably-useless harness rules is the better default.

## Files

- `src/adapters/chatgpt-web/luna-context-slimming.ts`: no ordering change (already correct); add the
  invariant comment; optional strict-keep flag.
- `README.md` / the Luna slimming section: state that user-authored rules are preserved (preloaded,
  not condensed) when preload is on, and that only the named harness sections are dropped.
- Tests: `tests/luna-context-slimming.test.ts` — custom user rule survives verbatim in a preamble
  part with preload on; condense is skipped when preload succeeds; condense still runs when preload
  is off.

## Validation

- Unit: over-budget turn + custom user `## Rule:` + preload on → the rule text appears in
  `compiled.preamble`, not condensed; `condensedTokens === 0`.
- Same turn with preload off → the rule is condensed (today's behavior), proving the fallback path.
- Live smoke: a turn with a distinctive user rule and a marker inside it; confirm the model can act
  on that rule (it was delivered verbatim, not summarized).

## Risks and rollback

- Keeping user rules makes turns heavier, so more turns need preload and can hit the ~3-message cap;
  beyond it they fall back to collapse (today). This is the accepted trade of respecting user intent.
- Rollback: none needed beyond phase 2 rollback — this phase is mostly verification and docs plus an
  optional flag.
