import { expect, test } from "bun:test";
import type { ChatGptWebPromptImage } from "../src/adapters/chatgpt-web/prompt";
import {
  toChatGptWebTransportPlan,
  type PreparedChatGptWebPrompt,
} from "../src/adapters/chatgpt-web/transport-contract";

const image: ChatGptWebPromptImage = { ref: "img_1", imageUrl: "data:image/png;base64,AAAA", detail: "auto" };

function prepared(overrides: Partial<PreparedChatGptWebPrompt> = {}): PreparedChatGptWebPrompt {
  return {
    text: "FINAL MESSAGE",
    images: [image],
    preamble: ["part 1", "part 2"],
    trimmedCompactionMessages: 3,
    release: () => {},
    ...overrides,
  };
}

test("maps a compiled prompt into the transport plan field for field", () => {
  const plan = toChatGptWebTransportPlan(prepared(), 12_345);
  expect(plan.finalMessage).toBe("FINAL MESSAGE");
  expect(plan.preamble).toEqual(["part 1", "part 2"]);
  expect(plan.images).toEqual([image]);
  expect(plan.estimatedInputTokens).toBe(12_345);
  expect(plan.trimmedCompactionMessages).toBe(3);
});

test("an absent preamble becomes an empty ordered list (single-message turn)", () => {
  const plan = toChatGptWebTransportPlan(prepared({ preamble: undefined }), 100);
  expect(plan.preamble).toEqual([]);
});

test("preamble order is preserved exactly", () => {
  const parts = ["a", "b", "c", "d"];
  const plan = toChatGptWebTransportPlan(prepared({ preamble: parts }), 0);
  expect(plan.preamble).toEqual(parts);
});

test("an absent trimmedCompactionMessages becomes 0", () => {
  const plan = toChatGptWebTransportPlan(prepared({ trimmedCompactionMessages: undefined }), 0);
  expect(plan.trimmedCompactionMessages).toBe(0);
});

test("the lifecycle release hook is carried through and invocable", () => {
  let released = 0;
  const plan = toChatGptWebTransportPlan(prepared({ release: () => { released += 1; } }), 0);
  expect(released).toBe(0);
  plan.release();
  expect(released).toBe(1);
});
