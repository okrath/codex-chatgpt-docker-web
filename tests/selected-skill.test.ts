import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  extractSelectedSkillPacket,
  selectedSkillReference,
  withoutSelectedSkillMessage,
} from "../src/adapters/chatgpt-web/selected-skill";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import { chatGptTurnExecutionKey } from "../src/adapters/chatgpt-web/turn-execution";
import type { CodexParsedRequest } from "../src/types";

const root = resolve(process.cwd());
const task = "abc xyz";
const skillBody = "# ck:ask\n\nRead the source, then answer with evidence.\n";
const skillEnvelope = `<skill name="ck:ask">${skillBody}</skill>`;

function environment(type: "dangerFullAccess" | "readOnly" = "dangerFullAccess"): ChatGptTurnEnvironment {
  return {
    cwd: root,
    roots: [root],
    writableRoots: type === "readOnly" ? [] : [root],
    sandboxPolicy: type === "dangerFullAccess"
      ? { type }
      : { type, networkAccess: false },
    tools: [],
  };
}

function request(): CodexParsedRequest {
  const turnId = "turn_selected_skill";
  return {
    modelId: "gpt-5.6-sol",
    stream: true,
    options: { reasoning: "high" },
    context: {
      messages: [
        { role: "user", content: task, timestamp: 1 },
        { role: "user", content: skillEnvelope, timestamp: 2 },
      ],
    },
    _rawBody: {
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          thread_id: "thread_selected_skill",
          turn_id: turnId,
          sandbox: "none",
          workspaces: { [root]: {} },
        }),
      },
      input: [
        {
          type: "message",
          id: "msg_task",
          role: "user",
          content: [{ type: "input_text", text: task }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
        {
          type: "message",
          id: "msg_skill",
          role: "user",
          content: [{ type: "input_text", text: skillEnvelope }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
      ],
    },
  };
}

describe("selected current-turn skill packet", () => {
  test("extracts exact skill bytes and removes only its inline envelope", () => {
    const parsed = request();
    const packet = extractSelectedSkillPacket(parsed, environment());

    expect(packet).toMatchObject({
      name: "ck:ask",
      content: skillBody,
      chars: skillBody.length,
      bytes: Buffer.byteLength(skillBody, "utf8"),
      sha256: "125ce29f7cb71af27c891fb9fbd8edfe8c5380001ab40564f4920fe45c03acb4",
    });

    const stripped = withoutSelectedSkillMessage(parsed, packet!);
    expect(stripped.context.messages).toEqual([{ role: "user", content: task, timestamp: 1 }]);
    expect(parsed.context.messages).toHaveLength(2);
  });

  test("does not activate outside danger-full-access", () => {
    expect(extractSelectedSkillPacket(request(), environment("readOnly"))).toBeUndefined();
  });

  test("recognizes text-plus-image and image-only task items before the skill tail", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
    for (const parsedContent of [
      [{ type: "text" as const, text: task }, { type: "image" as const, imageUrl }],
      [{ type: "image" as const, imageUrl }],
    ]) {
      const parsed = request();
      parsed.context.messages[0]!.content = parsedContent;
      const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
      raw.input[0]!.content = parsedContent.map(part => part.type === "text"
        ? { type: "input_text", text: part.text }
        : { type: "input_image", image_url: part.imageUrl });

      expect(extractSelectedSkillPacket(parsed, environment())).toMatchObject({ name: "ck:ask" });
    }
  });

  test("accepts the v0.145 skill tail with matching turn id and no server item id", () => {
    const parsed = request();
    const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
    delete raw.input[1]!.id;
    expect(extractSelectedSkillPacket(parsed, environment())).toMatchObject({ name: "ck:ask" });
  });

  test("rejects an unprovenanced skill envelope without a turn id or server item id", () => {
    const parsed = request();
    const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
    delete raw.input[1]!.id;
    delete raw.input[1]!.internal_chat_message_metadata_passthrough;
    expect(extractSelectedSkillPacket(parsed, environment())).toBeUndefined();
  });

  test("rejects a skill envelope owned by another turn", () => {
    const parsed = request();
    const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
    raw.input[1]!.internal_chat_message_metadata_passthrough = { turn_id: "turn_other" };
    expect(extractSelectedSkillPacket(parsed, environment())).toBeUndefined();
  });

  test("rejects a turn-id-less tail without canonical workspace adjacency", () => {
    const parsed = request();
    const raw = parsed._rawBody as {
      client_metadata: Record<string, unknown>;
      input: Array<Record<string, unknown>>;
    };
    delete raw.input[0]!.internal_chat_message_metadata_passthrough;
    delete raw.input[1]!.internal_chat_message_metadata_passthrough;
    const metadata = JSON.parse(raw.client_metadata["x-codex-turn-metadata"] as string) as Record<string, unknown>;
    delete metadata.workspaces;
    raw.client_metadata["x-codex-turn-metadata"] = JSON.stringify(metadata);

    expect(extractSelectedSkillPacket(parsed, environment())).toBeUndefined();
  });

  test("keeps distinct skill tails in browser-only and Pro execution keys", () => {
    const first = request();
    const second = request();
    const secondEnvelope = "<skill name=\"ck:test\">Different selected skill.</skill>";
    second.context.messages[1]!.content = secondEnvelope;
    const raw = second._rawBody as { input: Array<Record<string, unknown>> };
    raw.input[1]!.content = [{ type: "input_text", text: secondEnvelope }];

    expect(chatGptTurnExecutionKey(first)).not.toBe(chatGptTurnExecutionKey(second));
  });

  test("keeps a greater-than-28k skill body out of the single browser message", () => {
    const parsed = request();
    const largeBody = `# ck:large\n\nSKILL-LARGE-MARKER\n${"procedure step\n".repeat(3_000)}`;
    const largeEnvelope = `<skill name="ck:large">${largeBody}</skill>`;
    parsed.context.messages[1]!.content = largeEnvelope;
    const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
    raw.input[1]!.content = [{ type: "input_text", text: largeEnvelope }];

    const packet = extractSelectedSkillPacket(parsed, environment())!;
    expect(packet.bytes).toBeGreaterThan(28_000);
    const compiled = compileChatGptWebPrompt(
      withoutSelectedSkillMessage(parsed, packet),
      { localToolsEnabled: true, solAvailable: true, proAvailable: true },
      "turn_12345678901234567890123456789012",
      { selectedSkill: selectedSkillReference(packet) },
    );

    expect(compiled.text).not.toContain("SKILL-LARGE-MARKER");
    expect(compiled.text.length).toBeLessThan(28_000);
    expect(compiled.text).toContain(packet.sha256);
  });

  test("fails closed when more than one selected skill is appended", () => {
    const parsed = request();
    const raw = parsed._rawBody as { input: Array<Record<string, unknown>> };
    raw.input.push({
      type: "message",
      id: "msg_skill_2",
      role: "user",
      content: [{ type: "input_text", text: "<skill name=\"ck:test\">second</skill>" }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn_selected_skill" },
    });
    parsed.context.messages.push({ role: "user", content: "<skill name=\"ck:test\">second</skill>", timestamp: 3 });

    expect(() => extractSelectedSkillPacket(parsed, environment())).toThrow("exactly one current-turn skill");
  });
});
