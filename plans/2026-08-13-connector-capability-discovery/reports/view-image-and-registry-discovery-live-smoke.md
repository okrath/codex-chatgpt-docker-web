# Live smoke — images reach Luna in-turn, and Luna will search the tool registry

Date: 2026-08-13. Free-tier Luna (`chatgpt-web/luna`) against the running container. Both probes
emulate the outer Codex harness over `POST /v1/responses`: they advertise tools, answer the tool
calls the bridge emits, and replay the transcript each round the way Codex does.

## Question 1 — does an image in a Codex tool result reach the model inside the same turn?

Open since the connector's `codex_view_image` was written: the wiring is unit-tested, but nothing
proved that ChatGPT Web feeds an MCP image content block into the model's context.

**Answer: yes, on Free.** A PNG rendered with one unguessable word, `view_image` answered with an
`input_image` data URL, and the model read the word back exactly — twice, with a different word each
time:

| Run | Word rendered as pixels | Rounds | Model's answer |
|---|---|---|---|
| a1 | `GLYPH-7QX4` | view_image → answer | `SECRET=GLYPH-7QX4` |
| b2 | `ZEBRA-3M8V` | view_image → answer | `SECRET=ZEBRA-3M8V` |

The word existed nowhere in the prompt, so this cannot be recall or a lucky guess. The model asked
for `detail: "original"` on its own both times. The path is
`input_image` → `outputToToolResultContent` (image part) → `brokerContent` → MCP
`{type: "image", data, mimeType}` → connector result.

**Consequence.** Screenshot-based verification is available today: whatever renders a PNG locally,
the model can look at it in the same turn and report on what it sees.

## Question 2 — will the model search the tool registry instead of declaring a capability missing?

The trigger was a real refusal: asked to run game bots and screenshot them, Luna answered that no
browser or playtest tool had been provided — without ever calling the registry search that would
have listed one. The contract's local-tools branch now says to run that search before reporting a
capability as unavailable, described by behaviour because the contract never names connector tools.

Probe: advertise `browser_screenshot` (a tool the connector never mentions, so the registry search
is the only way to learn it exists) and ask for a screenshot of a URL.

**Run c1 — with an escape hatch in the request.** The task ended "if you truly cannot render a
browser page, reply SHOT=IMPOSSIBLE". The model called `codex_tool_inventory` once, then took the
escape hatch: `SHOT=IMPOSSIBLE`. The search happened; the refusal was the one the request itself
offered. Whether its query matched `browser_screenshot` is not recoverable from the logs.

**Run c2 — same probe, escape hatch removed.** Full discovery, unaided:

1. `codex_tool_inventory` — searched the registry.
2. `codex_exec` — looked for chromium/playwright binaries.
3. `codex_exec` — tried `browser_screenshot` as a shell command (exit 1; it had the name but not yet
   the shape).
4. `codex_tool_inventory` — searched again after that failure.
5. `codex_tool_call` → `browser_screenshot {"url": "https://example.com"}` — called a tool it was
   never told about, through the generic call.
6. `codex_view_image` on the returned path — verified its own output visually.
7. `SHOT=/tmp/view-image-smoke/shot.png`.

**Answer: yes.** Discovery works, `codex_tool_call` routes to the harness tool, and the model
volunteers a visual check of its own artifact. Registered MCP servers in `~/.codex/config.toml` are
reachable this way with no bridge change.

**Honest limits.** n=1 per wording. c1 says a request that pre-authorizes refusal still gets
refusal, so phrasing on the user's side still matters. Nothing here measures how often the model
searches when the capability genuinely is absent.
