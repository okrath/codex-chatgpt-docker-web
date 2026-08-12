import { createHash } from "node:crypto";
import type { CodexContentPart, CodexParsedRequest } from "../../types";
import {
  extractChatGptTurnIdentity,
  isTrustedCurrentTurnAuxiliaryUserTail,
  type ChatGptTurnEnvironment,
} from "./environment";

export const SELECTED_SKILL_LOAD_WIRE_NAME = "__codex_load_selected_skill_v1";
export const SELECTED_SKILL_ACK_WIRE_NAME = "__codex_ack_selected_skill_v1";

const MAX_SELECTED_SKILL_BYTES = 5_000_000;
const SKILL_ENVELOPE = /^<skill\s+name=(['"])([^'"<>]{1,256})\1>([\s\S]+)<\/skill>$/;

export interface SelectedSkillReference {
  name: string;
  sha256: string;
  chars: number;
  bytes: number;
}

export interface SelectedSkillPacket extends SelectedSkillReference {
  content: string;
  /** Exact raw/parsed envelope used only to remove this one message from a cloned request. */
  sourceText: string;
  sourceMessageIndex: number;
}

export interface LoadedSelectedSkill extends SelectedSkillReference {
  kind: "user_selected_skill";
  content: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function rawMessageText(value: Record<string, unknown>): string | undefined {
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return undefined;
  const parts = value.content.map(part => record(part));
  if (parts.some(part => typeof part?.text !== "string")) return undefined;
  return parts.map(part => part!.text as string).join("\n");
}

function parsedMessageText(content: string | CodexContentPart[]): string | undefined {
  if (typeof content === "string") return content;
  if (content.some(part => part.type !== "text")) return undefined;
  return content.map(part => part.type === "text" ? part.text : "").join("\n");
}

function itemTurnId(value: Record<string, unknown>): string | undefined {
  const turnId = record(value.internal_chat_message_metadata_passthrough)?.turn_id;
  return typeof turnId === "string" && turnId.length > 0 ? turnId : undefined;
}

function serverOwnedForTurn(value: Record<string, unknown>, turnId: string): boolean {
  const ownedId = typeof value.id === "string" && value.id.length > 0;
  const ownedTurn = itemTurnId(value);
  return ownedTurn === turnId || (ownedTurn === undefined && ownedId);
}

function parseEnvelope(text: string): { name: string; content: string } | undefined {
  const match = SKILL_ENVELOPE.exec(text);
  if (!match) return undefined;
  return { name: match[2]!, content: match[3]! };
}

function isContextOnlyUserText(text: string): boolean {
  const trimmed = text.trim();
  return /^<environment_context>[\s\S]*<\/environment_context>$/.test(trimmed)
    || /^<skill\s+name=(['"])[^'"<>]+\1>[\s\S]+<\/skill>$/.test(trimmed);
}

function packetOf(
  sourceText: string,
  sourceMessageIndex: number,
  envelope: { name: string; content: string },
): SelectedSkillPacket {
  const bytes = Buffer.byteLength(envelope.content, "utf8");
  if (bytes > MAX_SELECTED_SKILL_BYTES) {
    throw new Error(`Selected skill exceeds the ${MAX_SELECTED_SKILL_BYTES.toLocaleString("en-US")}-byte broker limit`);
  }
  return {
    name: envelope.name,
    content: envelope.content,
    sourceText,
    sourceMessageIndex,
    chars: envelope.content.length,
    bytes,
    sha256: createHash("sha256").update(envelope.content, "utf8").digest("hex"),
  };
}

/**
 * Identify and validate one Codex-generated skill tail, independent of sandbox authorization. A
 * typed `<skill>` inside the human's real message cannot satisfy the separate final-item shape.
 *
 * `strictSingle` selects the multi-skill response: the MCP loader (fail-closed) throws on an
 * ambiguous tail, while the preamble delivery path treats ambiguity as "no offloadable skill"
 * (undefined) so a plain Luna turn is never failed by skill detection.
 */
export function identifySelectedSkillPacket(
  parsed: CodexParsedRequest,
  opts?: { strictSingle?: boolean },
): SelectedSkillPacket | undefined {
  if (parsed._compactionRequest) return undefined;
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!turnId) return undefined;
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];

  let finalUserIndex = -1;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    if (item?.type === "message" && item.role === "user") {
      finalUserIndex = index;
      break;
    }
  }
  if (finalUserIndex < 0) return undefined;
  const selectedItem = record(input[finalUserIndex])!;
  const sourceText = rawMessageText(selectedItem);
  const envelope = sourceText === undefined ? undefined : parseEnvelope(sourceText);
  if (!envelope || !isTrustedCurrentTurnAuxiliaryUserTail(parsed, finalUserIndex)) return undefined;

  let boundary = -1;
  for (let index = finalUserIndex - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    if ((item?.type === "message" && item.role === "assistant")
      || item?.type === "function_call"
      || item?.type === "reasoning") {
      boundary = index;
      break;
    }
  }
  const selectedInCurrentTail = input.slice(boundary + 1, finalUserIndex + 1).filter(value => {
    const item = record(value);
    if (item?.type !== "message" || item.role !== "user" || !serverOwnedForTurn(item, turnId)) return false;
    const text = rawMessageText(item);
    return text !== undefined && parseEnvelope(text) !== undefined;
  });
  if (selectedInCurrentTail.length !== 1) {
    if (opts?.strictSingle) {
      throw new Error("ChatGPT Web selected-skill loading requires exactly one current-turn skill");
    }
    return undefined;
  }

  let precedingTaskFound = false;
  for (let index = finalUserIndex - 1; index > boundary; index -= 1) {
    const item = record(input[index]);
    if (item?.type !== "message" || item.role !== "user" || !serverOwnedForTurn(item, turnId)) continue;
    const text = rawMessageText(item);
    if (text === undefined || !isContextOnlyUserText(text)) {
      precedingTaskFound = true;
      break;
    }
  }
  if (!precedingTaskFound) return undefined;

  const parsedTail = parsed.context.messages.at(-1);
  if (parsedTail?.role !== "user" || parsedMessageText(parsedTail.content) !== sourceText) return undefined;
  return packetOf(sourceText!, parsed.context.messages.length - 1, envelope);
}

/**
 * Extract one Codex-generated skill tail for the Full + danger-full-access MCP loader. The sandbox
 * gate authorizes serving the body over the broker and unlocking native actions after the ack; an
 * ambiguous multi-skill tail fails closed. Preamble delivery uses `identifySelectedSkillPacket`
 * directly, which needs no sandbox authorization because it only relocates instruction text.
 */
export function extractSelectedSkillPacket(
  parsed: CodexParsedRequest,
  environment: ChatGptTurnEnvironment,
): SelectedSkillPacket | undefined {
  if (environment.sandboxPolicy.type !== "dangerFullAccess") return undefined;
  return identifySelectedSkillPacket(parsed, { strictSingle: true });
}

/** Remove exactly the validated skill message from a shallow request clone. */
export function withoutSelectedSkillMessage(
  parsed: CodexParsedRequest,
  packet: SelectedSkillPacket,
): CodexParsedRequest {
  const messages = parsed.context.messages;
  const source = messages[packet.sourceMessageIndex];
  if (source?.role !== "user" || parsedMessageText(source.content) !== packet.sourceText) {
    throw new Error("Validated selected skill no longer matches its parsed context position");
  }
  return {
    ...parsed,
    context: {
      ...parsed.context,
      messages: messages.filter((_message, index) => index !== packet.sourceMessageIndex),
    },
  };
}

export function selectedSkillReference(packet: SelectedSkillPacket): SelectedSkillReference {
  return {
    name: packet.name,
    sha256: packet.sha256,
    chars: packet.chars,
    bytes: packet.bytes,
  };
}

export function loadedSelectedSkill(packet: SelectedSkillPacket): LoadedSelectedSkill {
  return { kind: "user_selected_skill", ...selectedSkillReference(packet), content: packet.content };
}
