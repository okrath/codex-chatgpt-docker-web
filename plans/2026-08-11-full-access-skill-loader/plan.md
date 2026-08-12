# Full-access selected-skill loader

Status: complete

## Objective

Move only the explicitly invoked current-turn skill body out of the browser prompt. Keep the active human task inline, load the selected skill through the existing Codex Native MCP ABI, and fail closed until ChatGPT acknowledges the exact skill hash.

## Phases

- [x] Implement and test current-turn skill extraction and prompt replacement.
- [x] Add turn-scoped broker load/ack state and gate every native action.
- [x] Expose the loader through reserved `codex_tool_call` wire names without changing the connector schema.
- [x] Run static verification and independent review.
- [x] Run an isolated Full/danger-full-access browser smoke.
- [x] Update README only after the live smoke passes.

## Acceptance criteria

- Activation requires a trusted, server-owned, current-turn `<skill>` item, Full local tools, and `dangerFullAccess`.
- The latest human task remains inline; the full skill body does not.
- The loader returns the exact UTF-8 skill body plus name, byte count, and SHA-256.
- Broker claims project `tools: []` before acknowledgement; native inventory and every direct or generic action are therefore unavailable until the same SHA-256 is acknowledged.
- Skill state is turn-scoped and disappears on revoke.
- Both browser success paths atomically finalize the acknowledged skill before revoking the broker turn; only already-finalized session replay may bypass the retired token.
- No-skill, Browser-only, Pro, and compaction behavior remains unchanged.
- Focused tests, full test suite, and typecheck pass.
- Live smoke proves load and acknowledgement in a disposable workspace without unexpected writes.

## Dependencies

- Existing Responses raw-message provenance and turn metadata.
- Existing per-turn broker token and Codex Native `codex_tool_call` schema.
- Full harness with the connector set to Allow all; outer Codex sandbox set to danger-full-access.

## Out of scope

- Loading the complete system/developer/history prompt through MCP.
- Persisting generated skills under the user's home or repository.
- Enabling local skill loading in Browser-only or Pro read-only turns.
- Supporting more than one selected skill in the initial prototype.

## Safety invariants

- The raw skill must be the final server-owned current-turn user item and must exactly match the final parsed-context user message.
- When item turn IDs are omitted, activation uses the same canonical-metadata adjacency fallback as trusted environment recovery.
- Reserved skill wire names are synthesized and intercepted in the MCP process; they never become outer Codex tool batches.
- Prompt stripping occurs on a Full-turn clone only. The shared parsed request remains unchanged.

## Detail

See [phase-01-selected-skill-packet.md](./phase-01-selected-skill-packet.md).

## Validation result

- Full suite: 343 passed, 0 failed; TypeScript typecheck passed.
- Static regression: a selected skill body larger than 28K is absent from the single browser message.
- Live Luna smoke: `$ck:ask` loaded and acknowledged through `Codex Native2` in an isolated
  `danger-full-access` Git workspace, completed successfully, and created no workspace file.
- Independent review findings for multimodal task activation and empty-final replay were fixed
  and covered by regression tests before the live smoke.
- Post-context-loader rollback revalidation: 344 passed, 0 failed; TypeScript typecheck passed;
  the selected-skill loader remained enabled under `Codex Native2`.
- Post-review hardening: the completion gate's pending-action check now applies only to
  skill-gated turns (turns without a selected skill keep the historical
  finalize-despite-abandoned-call behavior); per-round usage estimation falls back to the
  compiled first-round prompt instead of failing the turn; the unused precomputed
  `inputTokens` runtime field was removed; and a completion that skips the loader handshake
  now surfaces a structured retryable error naming the skill. Revalidated in the Docker bun
  runtime at 345 passed, 0 failed, with a clean typecheck.
