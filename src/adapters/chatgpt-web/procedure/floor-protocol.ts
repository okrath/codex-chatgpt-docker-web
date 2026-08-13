import { createHash } from "node:crypto";
import floorText from "./floor-v1.md" with { type: "text" };

/**
 * The sealed Floor procedure protocol, ported from nousai-qwen-fable-thinking's floor-v1.
 *
 * The prose *is* the behaviour: it ships verbatim inside every non-compaction ChatGPT Web turn,
 * so a silent edit changes what every answer does without changing a line of code and without
 * failing a test. It is therefore loaded fail-closed against a pinned digest — editing
 * `floor-v1.md` requires updating the pin in the same commit, which makes changing the protocol
 * a deliberate act rather than a typo that shipped.
 */
export const FLOOR_PROTOCOL_VERSION = "floor-v1";

/**
 * SHA-256 of `floor-v1.md` after CRLF normalization. Update it in the same commit that edits the
 * prose, never afterwards to make a failure go away.
 */
export const FLOOR_PROTOCOL_SHA256 = "acbb497f224f82dba13f9df1f5ec937b7c18961510adddf23a68e3232061ece6";

/**
 * Set only while deliberately editing the prose. An explicit switch rather than a warn-and-continue,
 * so an unpinned protocol cannot become the normal state without someone choosing it and a reviewer
 * seeing the diff.
 */
const ALLOW_UNPINNED = false;

/** The protocol text is missing a required section or is not the pinned one. */
export class FloorProtocolError extends Error {}

/**
 * Normalized before hashing so a checkout with CRLF line endings is the same protocol as one with
 * LF. Otherwise the digest pins the git config rather than the text.
 */
export function normalizeFloorProtocolText(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

export function floorProtocolDigest(normalizedText: string): string {
  return createHash("sha256").update(normalizedText, "utf8").digest("hex");
}

/** Verify arbitrary protocol prose against the pin; returns the normalized text. */
export function verifyFloorProtocolText(raw: string): string {
  const text = normalizeFloorProtocolText(raw);
  const digest = floorProtocolDigest(text);
  if (digest !== FLOOR_PROTOCOL_SHA256 && !ALLOW_UNPINNED) {
    throw new FloorProtocolError(
      "floor-v1.md does not match the pinned protocol digest.\n"
      + `  pinned: ${FLOOR_PROTOCOL_SHA256}\n  found:  ${digest}\n`
      + "Either restore the text or update FLOOR_PROTOCOL_SHA256 deliberately.",
    );
  }
  return text;
}

/** `{heading (casefolded) → body}` for the top-level `# ` sections of the protocol prose. */
export function parseFloorProtocolSections(normalizedText: string): Map<string, string> {
  const sections = new Map<string, string>();
  // String.split with a capture group yields [pre, heading, body, heading, body, ...].
  const parts = normalizedText.split(/^#\s+(.+)$/m);
  for (let index = 1; index < parts.length - 1; index += 2) {
    sections.set(parts[index]!.trim().toLowerCase(), parts[index + 1]!.trim());
  }
  if (!sections.has("the floor")) {
    throw new FloorProtocolError("the protocol text has no 'The Floor' section");
  }
  return sections;
}

let loadedSections: Map<string, string> | undefined;

function sections(): Map<string, string> {
  if (!loadedSections) {
    loadedSections = parseFloorProtocolSections(verifyFloorProtocolText(floorText));
    console.info(
      `[chatgpt-web] sealed Floor procedure ${FLOOR_PROTOCOL_VERSION} loaded`
      + ` (sha256 ${FLOOR_PROTOCOL_SHA256.slice(0, 12)}…)`,
    );
  }
  return loadedSections;
}

export function floorProtocolSection(name: string): string {
  const body = sections().get(name.toLowerCase());
  if (body === undefined) {
    throw new FloorProtocolError(`the protocol text has no '${name}' section`);
  }
  return body;
}

/**
 * Kill-switch for the procedure block. On by default; `off`/`0`/`false` ships the turn without it.
 *
 * The block's cost is measured but its benefit is not, so turning it off has to be one env var
 * rather than a rebuild — both to recover instantly if it is ever implicated in a live failure,
 * and because an A/B measurement of its effect is impossible without an arm that omits it.
 */
export function chatGptFloorProcedureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CODEX_CHATGPT_WEB_FLOOR?.trim().toLowerCase();
  if (value === undefined || value === "") return true;
  return value !== "off" && value !== "0" && value !== "false";
}

/**
 * The procedure contract for one ChatGPT Web turn, assembled from the sealed prose. Verbatim
 * sections, not a paraphrase — the source project measured what compressing the Floor to one line
 * cost, and the answer was that it stopped being the Floor. With local tools attached the Deliver
 * section is swapped: the plain one is right for a person reading a reply and wrong for an agent
 * that needs a file written.
 */
export function buildFloorProcedureBlock(options: { localTools: boolean }): string[] {
  return [
    `[Fable procedure ${FLOOR_PROTOCOL_VERSION}] Apply the following procedure to the latest`
    + " active user request in the Codex task context below. This contract adds no new task and"
    + " no new facts.",
    floorProtocolSection("the floor"),
    floorProtocolSection("claims"),
    floorProtocolSection("attack"),
    floorProtocolSection(options.localTools ? "deliver with tools" : "deliver"),
  ];
}
