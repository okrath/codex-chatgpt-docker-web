---
title: "Read-only Stage 1 context loader retry"
description: "Retry system/developer offload through dedicated public read-only MCP tools."
status: cancelled
priority: P1
branch: "main"
tags: [mcp, context, experiment]
blockedBy: []
blocks: []
created: "2026-08-12"
createdBy: "codex"
source: skill
---

# Read-only Stage 1 context loader retry

## Objective

Prove or reject system/developer instruction offload through three dedicated public MCP tools instead of the destructive generic `codex_tool_call` path.

## Phase

| Phase | Name | Status |
|---|---|---|
| 1 | [Read-only context loader](./phase-01-read-only-context-loader.md) | Failed live gate; rolled back |

## Attempted design

- Full mode plus trusted `danger-full-access` only; Browser-only and Pro remain inline.
- Public tools: `codex_context_manifest`, `codex_context_load`, and `codex_context_ack`.
- All three are non-destructive, closed-world, and idempotent for one turn; `ack` mutates only ephemeral broker protocol state.
- Public `tools/list` changes require connector identity `Codex Native3`; `Codex Native` and `Codex Native2` become legacy identities.
- Only system/developer instructions are in scope. History, file snapshots, oversized user tasks, and safety bypasses are out.
- README changes only after static, review, and live gates pass. A failed live gate removes the prototype.

## Acceptance gates

- Exact capsule bytes are absent from the browser prompt and returned only by the read-only loader.
- Manifest order, capsule id, UTF-8 byte count, and SHA-256 are deterministic.
- Native actions and browser completion fail before every required capsule is loaded and acknowledged in order.
- Selected-skill load/ack still runs after context acknowledgement; stale model-switch developer contracts are not resurrected.
- Focused tests, full tests, and `bunx tsc --noEmit` pass.
- A live Full/Luna turn calls all three tools and obeys a marker present only inside a loaded capsule.

## Rollback

If ChatGPT blocks, skips, or cannot discover the read-only tools after the `Codex Native3` connector is attached, remove context-loader source/tests and restore the previous connector identity. Preserve unrelated selected-skill and broker race fixes.

## Experiment result

- Static implementation passed TypeScript typecheck and the full suite: 353 tests, 0 failures.
- `Codex Native3` was attached with `Allow all`; the public three-step loader was discoverable and Luna called `codex_context_manifest` once, but did not continue through load and acknowledgement.
- The retry collapsed the protocol into one atomic read-only bundle call. Across five live retries Luna never called it: four attempts failed the required rolling checkpoint and one valid completion was correctly rejected by the broker because context was still pending.
- A final retry also exposed duplicate cached `Codex Native3` menu rows, reinforcing that a new connector identity does not make model-side tool sequencing reliable.
- Decision: reject the loader, remove its source/tests/config and restore `Codex Native2`. Keep selected-skill offload and independent lifecycle/accounting fixes. README remains unchanged for context offload.
- Rollback verification: TypeScript typecheck passed; 344 tests passed with 0 failures; the rebuilt container is healthy; runtime-image grep found no loader identifiers; ChatGPT Plugins shows only `Codex Native2 — Connected — Allow all` after deleting the experimental Native3 connector.

## Unresolved questions

None. A future retry needs product-supported deterministic preloading rather than model-directed MCP sequencing.
