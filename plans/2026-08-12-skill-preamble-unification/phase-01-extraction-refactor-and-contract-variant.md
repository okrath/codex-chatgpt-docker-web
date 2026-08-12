# Phase 01: extraction refactor + preamble contract variant

Status: done; static green (27 focused tests pass, typecheck clean). Chose the separate
`preambleSkill` option over a discriminated field — smaller diff, MCP plumbing untouched.

## Goal

Split skill identification from MCP authorization, and teach the prompt compiler to render a
"skill delivered in an earlier message" contract variant. No behavior change yet — this phase only
adds the seams phase 2 consumes. The existing MCP path must stay byte-identical.

## Context

- `extractSelectedSkillPacket(parsed, environment)` — src/adapters/chatgpt-web/selected-skill.ts:101
  — today bundles two concerns: (1) authorization for the MCP path
  (`sandboxPolicy.type === "dangerFullAccess"`, line 105) and (2) identifying/validating the skill
  body (envelope regex, trusted-tail, exactly-one-skill throw, preceding-task, byte-match; lines
  106-159).
- `CompileChatGptWebPromptOptions.selectedSkill?: SelectedSkillReference` — prompt.ts:33-38 — drives
  the `selected_skill` envelope field (prompt.ts:312) and the MCP `selectedSkillContract`
  (prompt.ts:264-272), which references `turnToken`, `SELECTED_SKILL_LOAD_WIRE_NAME`, and
  `SELECTED_SKILL_ACK_WIRE_NAME`.

## Changes

### selected-skill.ts

1. Add `identifySelectedSkillPacket(parsed: CodexParsedRequest, opts?: { strictSingle?: boolean }):
   SelectedSkillPacket | undefined` holding the current identification/validation logic **minus** the
   `dangerFullAccess` check. Ambiguity handling depends on `strictSingle`:
   - `strictSingle: true` (MCP path): more-than-one current-turn skill **throws** (today's behavior).
   - `strictSingle` unset/false (preamble path): more-than-one → **return undefined** (skill stays
     inline; a plain-Luna turn must never be failed by A4).
   Keep `_compactionRequest` → undefined in the shared helper (it applies to both paths).
2. Rewrite `extractSelectedSkillPacket` as a thin wrapper: return undefined unless
   `environment.sandboxPolicy.type === "dangerFullAccess"`, then delegate to
   `identifySelectedSkillPacket(parsed, { strictSingle: true })`. Net behavior identical to today.

### prompt.ts

3. Extend the skill option to carry a mode. Preferred shape:
   `selectedSkill?: { reference: SelectedSkillReference; mode: "mcp" | "preamble" }`
   (or keep `selectedSkill` for MCP and add `preambleSkill?: SelectedSkillReference` — pick the
   smaller diff; a discriminated single field is cleaner). Update the one MCP call site
   (index.ts:248) to pass `mode: "mcp"`.
4. `selectedSkillContract` gains a `preamble` branch. It must:
   - State the human explicitly invoked skill `name` for the latest task, and that its body was
     delivered in an **earlier message in this same chat** (not via a tool call).
   - Instruct the model to follow that skill body as the procedure for the latest task, subject to
     the inline system/developer instructions and this transport contract.
   - Include **no** `codex_tool_call`, wire-name, ack, or `turn_token` text.
5. `selected_skill` envelope field (prompt.ts:312): include the compact reference in both modes so
   the model can cross-check name/sha256; only the contract text differs.

## Files

- Modify `src/adapters/chatgpt-web/selected-skill.ts`.
- Modify `src/adapters/chatgpt-web/prompt.ts`.
- Modify `src/adapters/chatgpt-web/index.ts` (only the option call site at :248, to pass `mode:"mcp"`).

## Tests

- Extend `tests/selected-skill.test.ts`: `identifySelectedSkillPacket` returns the same packet as
  `extractSelectedSkillPacket` for the happy path; without `dangerFullAccess`, `extract` returns
  undefined but `identify` returns the packet; two current-turn skills → `identify({strictSingle:true})`
  throws while `identify()` (default) returns undefined.
- Extend `tests/prompt-contract.test.ts`: `mode:"preamble"` renders the earlier-message contract and
  contains none of `codex_tool_call` / the wire-name constants / `turn_token`; `mode:"mcp"` renders
  today's load/ack contract unchanged.

## Validation

- `bun test tests/selected-skill.test.ts tests/prompt-contract.test.ts` green.
- `bunx tsc --noEmit` green.
- The untouched MCP tests (`turn-broker-lifecycle`, `chatgpt-web-harness` skill flow) stay green,
  proving the wrapper preserved MCP behavior.

## Risks / rollback

- Risk: the refactor changes MCP-path validation subtly. Mitigation: the wrapper keeps the exact
  gate + `strictSingle:true`; run the full selected-skill/broker/harness suites unchanged.
- Rollback: revert to the single `extractSelectedSkillPacket`; the new option branch is inert
  until phase 2 sets `mode:"preamble"`.
