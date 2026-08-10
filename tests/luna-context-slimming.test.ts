import { expect, test } from "bun:test";
import {
  condenseLunaRuleSections,
  describeLunaSlimming,
  elideOldLunaHistory,
  LUNA_DISPOSABLE_RULE_SECTIONS,
  lunaDisposableRuleSections,
  stripLunaRuleSection,
  trimOldLunaToolResults,
} from "../src/adapters/chatgpt-web/luna-context-slimming";
import type { CodexMessage } from "../src/types";

const BIG = "x ".repeat(400);

function toolResult(id: string, text: string): CodexMessage {
  return { role: "toolResult", toolCallId: id, toolName: "sh", isError: false, content: text } as CodexMessage;
}

function assistantMessage(text: string): CodexMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 0 } as CodexMessage;
}

function userMessage(text: string): CodexMessage {
  return { role: "user", content: text, timestamp: 0 };
}

const RULE_BUNDLE = [
  "## Rule: CLAUDE",
  "",
  "Claude Code specific hook protocol and skills catalog guidance.",
  "",
  "Use the AskUserQuestion tool for privacy blocks.",
  "---",
  "",
  "## Rule: development-rules",
  "",
  "Prefer YAGNI, KISS, and DRY in that order.",
  "",
  "- Run the narrowest useful test first.",
  "- Never commit secrets.",
  "---",
  "",
  "## Rule: skill-domain-routing",
  "",
  "Decision trees for /ck: slash-command skills.",
  "",
  "Frontend goes to /ck:frontend-design and so on for many more lines.",
  "Backend goes to /ck:backend-development.",
  "---",
].join("\n");

function developerMessage(text: string): CodexMessage {
  return { role: "developer", content: text, timestamp: 0 };
}

test("stripping a named rule section removes only that section", () => {
  const messages = [developerMessage(RULE_BUNDLE)];
  const result = stripLunaRuleSection(messages, "skill-domain-routing");
  expect(result).toBeDefined();
  const text = result!.messages[0]!.content as string;
  expect(text).not.toContain("## Rule: skill-domain-routing");
  expect(text).not.toContain("/ck:frontend-design");
  expect(text).toContain("## Rule: development-rules");
  expect(text).toContain("Prefer YAGNI, KISS, and DRY in that order.");
  expect(result!.estTokensRemoved).toBeGreaterThan(0);
});

test("stripping an absent section reports nothing to remove", () => {
  const messages = [developerMessage(RULE_BUNDLE)];
  expect(stripLunaRuleSection(messages, "team-coordination-rules")).toBeUndefined();
});

test("assistant history and tool results are never touched", () => {
  const messages: CodexMessage[] = [
    { role: "assistant", content: [{ type: "text", text: RULE_BUNDLE }], timestamp: 0 } as never,
    developerMessage(RULE_BUNDLE),
  ];
  const result = stripLunaRuleSection(messages, "CLAUDE");
  expect(result).toBeDefined();
  expect(result!.messages[0]).toBe(messages[0]);
  expect((result!.messages[1]!.content as string)).not.toContain("## Rule: CLAUDE");
});

test("text content parts are stripped while other part types survive", () => {
  const messages: CodexMessage[] = [{
    role: "user",
    content: [
      { type: "text", text: RULE_BUNDLE },
      { type: "image", imageUrl: "data:image/png;base64,AAAA" } as never,
    ],
    timestamp: 0,
  }];
  const result = stripLunaRuleSection(messages, "CLAUDE");
  expect(result).toBeDefined();
  const parts = result!.messages[0]!.content as Array<{ type: string; text?: string }>;
  expect(parts[0]!.text).not.toContain("## Rule: CLAUDE");
  expect(parts[1]!.type).toBe("image");
});

test("condensing keeps each section header and first paragraph only", () => {
  const messages = [developerMessage(RULE_BUNDLE)];
  const result = condenseLunaRuleSections(messages);
  expect(result).toBeDefined();
  const text = result!.messages[0]!.content as string;
  expect(text).toContain("## Rule: development-rules");
  expect(text).toContain("Prefer YAGNI, KISS, and DRY in that order.");
  expect(text).toContain("condensed: full text omitted");
  expect(text).not.toContain("- Never commit secrets.");
  expect(result!.estTokensRemoved).toBeGreaterThan(0);
});

test("condensing a bundle of single-paragraph sections is a no-op", () => {
  const short = "## Rule: tiny\n\nOnly one paragraph here.";
  expect(condenseLunaRuleSections([developerMessage(short)])).toBeUndefined();
});

test("the disposable section list honours its environment override", () => {
  expect(lunaDisposableRuleSections({})).toEqual(LUNA_DISPOSABLE_RULE_SECTIONS);
  expect(lunaDisposableRuleSections({ CODEX_CHATGPT_WEB_LUNA_TRIM_RULES: "off" })).toEqual([]);
  expect(lunaDisposableRuleSections({ CODEX_CHATGPT_WEB_LUNA_TRIM_RULES: "alpha, beta" }))
    .toEqual(["alpha", "beta"]);
});

test("trimming replaces only older completed tool results, keeping recent ones and the current round", () => {
  // Layout: [tr1, tr2, tr3, assistant, tr4(current round)].
  const messages: CodexMessage[] = [
    toolResult("t1", `one ${BIG}`),
    toolResult("t2", `two ${BIG}`),
    toolResult("t3", `three ${BIG}`),
    assistantMessage("done"),
    toolResult("t4", `four ${BIG}`),
  ];
  const result = trimOldLunaToolResults(messages, undefined, 1);
  expect(result).toBeDefined();
  // keepRecent=1 keeps t3 (newest completed); t4 is current-round (after the assistant).
  expect(result!.trimmedCount).toBe(2);
  expect(result!.messages[0]!.content).toContain("trimmed by the bridge");
  expect(result!.messages[1]!.content).toContain("trimmed by the bridge");
  expect(result!.messages[2]!.content).toBe(`three ${BIG}`);
  expect(result!.messages[4]!.content).toBe(`four ${BIG}`);
  expect(result!.estTokensRemoved).toBeGreaterThan(0);
});

test("trimming is a no-op when there are no older completed tool results", () => {
  const messages: CodexMessage[] = [toolResult("t1", `one ${BIG}`), toolResult("t2", `two ${BIG}`)];
  expect(trimOldLunaToolResults(messages, undefined, 4)).toBeUndefined();
});

test("history elision keeps recent messages and every developer message verbatim", () => {
  const dev = { role: "developer", content: `contract ${BIG}`, timestamp: 0 } as CodexMessage;
  const messages: CodexMessage[] = [
    userMessage(`old user ${BIG}`),
    dev,
    assistantMessage(`old answer ${BIG}`),
    userMessage(`recent ${BIG}`),
  ];
  const result = elideOldLunaHistory(messages, undefined, 1);
  expect(result).toBeDefined();
  expect((result!.messages[0]!.content as string)).toContain("trimmed by the bridge");
  expect(result!.messages[1]!.content).toBe(`contract ${BIG}`); // developer never elided
  expect(result!.messages[3]!.content).toBe(`recent ${BIG}`); // kept recent
  expect(result!.elidedCount).toBeGreaterThan(0);
});

test("the slimming summary names every applied action and reports the budget outcome", () => {
  const summary = describeLunaSlimming(
    {
      removedSections: [{ name: "skill-domain-routing", estTokens: 1400 }],
      condensedTokens: 250,
      trimmedToolResults: 3,
      trimmedToolResultTokens: 9_000,
      elidedMessages: 2,
      elidedMessageTokens: 4_000,
      beforeTokens: 60_500,
      estimatedTokens: 27_100,
    },
    28_000,
  );
  expect(summary).toContain("skill-domain-routing (~1,400 tokens)");
  expect(summary).toContain("condensed the remaining rule sections (~250 tokens)");
  expect(summary).toContain("trimmed 3 older tool result(s) (~9,000 tokens)");
  expect(summary).toContain("elided 2 older history message(s) (~4,000 tokens)");
  expect(summary).toContain("~60,500 → ~27,100");
  expect(summary).toContain("fits the 28,000-token");
});
