# Phase 3 live smoke — sealed Floor procedure on free-tier Luna

Date: 2026-08-13. Container rebuilt from this branch (`docker compose up -d --build`),
bridge `2.1.6 listening on http://127.0.0.1:17841/v1 (full)`. Two real Luna turns
were run from the Codex app in one thread; all evidence below is from
`docker compose logs` and the browser-turn diagnostics inside the container.

## Verdict: PASS, with one recorded incident recovered by the designed fallback

## Evidence

**Seal loaded fail-closed at first compile:**

```
[chatgpt-web] sealed Floor procedure floor-v1 loaded (sha256 acbb497f224f…)
```

**Turn 1 (trace `163ca3898c68`) — the incident.** The turn was over budget, so it
went out on the preload path (1 earlier-context part + final message,
`estimatedInputTokens=25001`). The model answered (~503 chars) but omitted the
private checkpoint marker, so the bridge failed the turn:

```
[chatgpt-web] turn failed: ChatGPT Luna completed without the required private rolling checkpoint
```

The designed preload fallback then re-delivered the turn once as a single
slimmed message (`disablePreload`, `estimatedInputTokens=19801`), which
completed with the checkpoint captured (`markdownChars=235`).

**Turn 2 (trace `c2b23047383f`) — clean pass.** Single message,
`estimatedInputTokens=9920`; turn 1's checkpoint was carried forward and
applied:

```
[chatgpt-web] Luna rolling checkpoint applied=true replacedHistory=8
[chatgpt-web] browser turn c2b23047383f completed (markdownChars=268)
```

**Zero procedure narration in all three deliveries.** The final page snapshots
(`19-turn-completed.json` / `18-response-visible.json`) of the failed attempt,
the retry, and turn 2 were grepped case-insensitively for `the floor`,
`leftovers`, `follow-through`, `[fable procedure`, and `these moves`: no
matches anywhere. The Deliver section's no-narration rule held even on the
attempt that dropped the tail.

## Measured cost of the block

Using the repo's own `estimateTokens` over `buildFloorProcedureBlock(...).join("\n")`:

| Variant | Chars | Tokens | Share of the Free 28k budget |
|---|---|---|---|
| read-only Deliver | 2,799 | **592** | ~2.1% |
| Deliver-with-tools | 3,133 | **667** | ~2.4% |

## The incident, honestly

One preload-delivered checkpoint turn dropped the private tail on its first
delivery. That is the exact failure mode flagged as High risk in review; it is
also a failure mode the bridge already anticipates (the retry that recovered it
is the pre-existing preload fallback, not new code). What this smoke cannot
decide is attribution: the only pre-Floor preload+checkpoint sample on record
(trace `8872a9e37ae6`, 2026-08-12) succeeded, and this post-Floor sample failed
once then succeeded — one sample each, no rate for either arm. Recorded as an
open watch item rather than absorbed: if preload turns keep failing their first
delivery, suspect the Floor block's size or its Deliver wording, and re-test
with `CODEX_CHATGPT_WEB_LUNA_PRELOAD=off`.

## Success criteria mapping

- Load line with pinned digest observed — yes (`acbb497f224f…`).
- Two consecutive live turns with checkpoint captured and carried forward —
  yes (turn 1 after its designed one-shot retry; turn 2 first try).
- Zero procedure narration — yes, verified against page snapshots, not just
  the streamed answer.
- Token delta recorded — yes, measured exactly (592/667 tokens per turn).
