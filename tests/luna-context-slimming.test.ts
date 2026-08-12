import { expect, test } from "bun:test";
import {
  buildCollapsedHistoryIndex,
  chunkMessagesIntoPreamble,
  collapseOldLunaHistory,
  compileLunaBudgetedPrompt,
  condenseLunaRuleSections,
  describeLunaSlimming,
  LUNA_COLLAPSE_INDEX_STEP_BUDGETS,
  LUNA_DISPOSABLE_RULE_SECTIONS,
  lunaDisposableRuleSections,
  lunaPreloadEnabled,
  stripLunaRuleSection,
} from "../src/adapters/chatgpt-web/luna-context-slimming";
import { chatGptLunaSlimmingBudget, estimateCompiledChatGptWebInputTokens } from "../src/adapters/chatgpt-web/input-tokens";
import { CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET } from "../src/adapters/chatgpt-web/input-tokens";
import { CHATGPT_WEB_LUNA_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { estimateTokens } from "../src/lib/token-estimate";
import type { CodexMessage, CodexParsedRequest } from "../src/types";
import type { RemovedHistoryMessage } from "../src/adapters/chatgpt-web/history-recall";

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

function withPreloadEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(vars).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test("collapse removes older history into ONE marker, keeping recent messages and the current round", () => {
  // Layout: [tr1, tr2, tr3, assistant, tr4(current round)].
  const messages: CodexMessage[] = [
    toolResult("t1", `one ${BIG}`),
    toolResult("t2", `two ${BIG}`),
    toolResult("t3", `three ${BIG}`),
    assistantMessage(`done ${BIG}`),
    toolResult("t4", `four ${BIG}`),
  ];
  const result = collapseOldLunaHistory(messages, undefined, 1);
  expect(result).toBeDefined();
  // cutoff = min(len-1=4, currentRoundStart=4) = 4 → collapse t1..t3 + assistant.
  // One marker replaces the whole removed span (not one placeholder each).
  expect(result!.collapsedCount).toBe(4);
  expect(result!.messages.length).toBe(2); // [marker, t4]
  expect((result!.messages[0]!.content as string)).toContain("[bridge removed 4 older message(s)");
  expect(result!.messages[1]!.content).toBe(`four ${BIG}`); // current round kept verbatim
  expect(result!.estTokensRemoved).toBeGreaterThan(0);
});

test("collapse keeps developer messages by default and folds them in at the deepest step", () => {
  const dev = { role: "developer", content: `contract ${BIG}`, timestamp: 0 } as CodexMessage;
  const messages: CodexMessage[] = [
    userMessage(`old user ${BIG}`),
    dev,
    assistantMessage(`old answer ${BIG}`),
    userMessage(`recent ${BIG}`),
  ];
  const kept = collapseOldLunaHistory(messages, undefined, 1, false);
  expect(kept).toBeDefined();
  expect(kept!.messages.some(m => m.role === "developer" && m.content === `contract ${BIG}`)).toBe(true);

  const folded = collapseOldLunaHistory(messages, undefined, 1, true);
  expect(folded).toBeDefined();
  expect(folded!.messages.some(m => m.role === "developer")).toBe(false); // developer collapsed
  expect(folded!.messages.at(-1)!.content).toBe(`recent ${BIG}`); // recent kept
});

test("collapse is a no-op when nothing precedes the keep window / current round", () => {
  const messages: CodexMessage[] = [userMessage(`only ${BIG}`)];
  expect(collapseOldLunaHistory(messages, undefined, 8)).toBeUndefined();
});

test("collapse returns the verbatim removed messages and advertises recall only when asked", () => {
  const messages: CodexMessage[] = [
    userMessage(`first old ${BIG}`),
    toolResult("t1", `second old ${BIG}`),
    assistantMessage(`answer ${BIG}`),
    userMessage(`recent ${BIG}`),
  ];
  const plain = collapseOldLunaHistory(messages, undefined, 1);
  expect(plain).toBeDefined();
  expect(plain!.removed.map(m => m.role)).toEqual(["user", "toolResult", "assistant"]);
  expect(plain!.removed[0]!.content).toBe(`first old ${BIG}`);
  expect(plain!.messages[0]!.content).not.toContain("codex_tool_call");

  const advertised = collapseOldLunaHistory(messages, undefined, 1, false, true);
  expect(advertised!.messages[0]!.content).toContain("__codex_search_collapsed_history_v1");
  expect(advertised!.messages[0]!.content).toContain("__codex_load_collapsed_history_v1");
});

function removedHistory(count: number): RemovedHistoryMessage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    index,
    role: index % 2 === 0 ? "user" : "toolResult",
    text: index % 2 === 0 ? `user request number ${index} about the audit` : `tool output ${index}`,
  }));
}

test("collapse index summarizes real content and switches header wording for Full mode", () => {
  const removed = removedHistory(24);
  const readOnly = buildCollapsedHistoryIndex(removed, LUNA_COLLAPSE_INDEX_STEP_BUDGETS[0]!, false);
  expect(readOnly).toContain("older removed context");
  expect(readOnly).toContain("#0–9");
  expect(readOnly).toContain("user request number 0 about the audit");
  expect(readOnly).toMatch(/\d+ user/);

  const fullMode = buildCollapsedHistoryIndex(removed, LUNA_COLLAPSE_INDEX_STEP_BUDGETS[0]!, true);
  expect(fullMode).toContain("load by index");
});

test("collapse index stays within its step budget even for a very long collapsed span", () => {
  const removed = removedHistory(1_200);
  for (const budget of LUNA_COLLAPSE_INDEX_STEP_BUDGETS) {
    const index = buildCollapsedHistoryIndex(removed, budget, true);
    if (budget === 0) {
      expect(index).toBe("");
      continue;
    }
    expect(estimateTokens(index)).toBeLessThanOrEqual(budget);
    // Bounded line count: coarsening groups messages, so it is far below one line per message.
    expect(index.split("\n").length).toBeLessThan(removed.length);
  }
});

test("an over-budget Luna thread converges under budget with the index inside the collapse marker", () => {
  const messages: CodexMessage[] = [];
  for (let turn = 0; turn < 60; turn += 1) {
    messages.push(userMessage(`turn ${turn} question ${BIG}`));
    messages.push(assistantMessage(`turn ${turn} answer ${BIG}`));
  }
  messages.push(userMessage("current task: summarize the audit"));
  const parsed = {
    modelId: CHATGPT_WEB_LUNA_MODEL_ID,
    stream: true,
    options: { reasoning: undefined },
    context: { systemPrompt: ["You are the model backend."], messages },
  } as unknown as CodexParsedRequest;
  const capabilities = { localToolsEnabled: true, solAvailable: false, proAvailable: false };

  // Preload defaults on; this test exercises the collapse path, so disable preload here.
  const result = withPreloadEnv(
    { CODEX_CHATGPT_WEB_LUNA_PRELOAD: "off" },
    () => compileLunaBudgetedPrompt(parsed, capabilities, "turn_12345678901234567890123456789012"),
  );
  expect(result.estimatedTokens).toBeLessThanOrEqual(CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET);
  expect(result.collapsedMessages).toBeGreaterThan(0);
  expect(result.removedHistory.length).toBeGreaterThan(0);
  expect(result.compiled.text).toContain("[bridge removed");
  expect(result.compiled.text).toContain("Collapsed history index");
  // The last removable index in the marker is loadable from the recall store.
  expect(result.removedHistory.at(-1)!.index).toBe(result.removedHistory.length - 1);
});

test("slimming budget override lowers the threshold within bounds and never raises it", () => {
  expect(chatGptLunaSlimmingBudget({})).toBe(28_000);
  expect(chatGptLunaSlimmingBudget({ CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE: "6000" })).toBe(6_000);
  expect(chatGptLunaSlimmingBudget({ CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE: "500" })).toBe(28_000);
  expect(chatGptLunaSlimmingBudget({ CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE: "99999" })).toBe(28_000);
  expect(chatGptLunaSlimmingBudget({ CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE: "abc" })).toBe(28_000);
});

test("preload flag defaults on and only an explicit off/0/false disables it", () => {
  expect(lunaPreloadEnabled({})).toBe(true);
  expect(lunaPreloadEnabled({ CODEX_CHATGPT_WEB_LUNA_PRELOAD: "" })).toBe(true);
  for (const value of ["on", "1", "true", "anything"]) {
    expect(lunaPreloadEnabled({ CODEX_CHATGPT_WEB_LUNA_PRELOAD: value })).toBe(true);
  }
  for (const value of ["off", "0", "false", "OFF"]) {
    expect(lunaPreloadEnabled({ CODEX_CHATGPT_WEB_LUNA_PRELOAD: value })).toBe(false);
  }
});

test("preload chunking keeps every part within the per-part budget and splits an oversized message", () => {
  const messages: CodexMessage[] = Array.from({ length: 30 }, (_unused, index) =>
    userMessage(`context message ${index} ${"detail ".repeat(50)}`));
  const budget = 2_000;
  const chunks = chunkMessagesIntoPreamble(messages, budget);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(estimateTokens(chunk)).toBeLessThanOrEqual(budget);

  const oversized: CodexMessage[] = [userMessage(`huge ${"word ".repeat(6_000)}`)];
  const split = chunkMessagesIntoPreamble(oversized, budget);
  expect(split.length).toBeGreaterThan(1);
  for (const chunk of split) expect(estimateTokens(chunk)).toBeLessThanOrEqual(budget);
});

test("an over-budget Luna turn preloads history into parts when the flag is on, and collapses when off", () => {
  const build = (): CodexParsedRequest => {
    const messages: CodexMessage[] = [];
    for (let turn = 0; turn < 60; turn += 1) {
      messages.push(userMessage(`turn ${turn} question ${BIG}`));
      messages.push(assistantMessage(`turn ${turn} answer ${BIG}`));
    }
    messages.push(userMessage("current task: summarize the audit"));
    return {
      modelId: CHATGPT_WEB_LUNA_MODEL_ID,
      stream: true,
      options: { reasoning: undefined },
      context: { systemPrompt: ["You are the model backend."], messages },
    } as unknown as CodexParsedRequest;
  };
  const capabilities = { localToolsEnabled: true, solAvailable: false, proAvailable: false };
  const previousFlag = process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD;
  const previousMax = process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS;
  try {
    process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD = "on";
    process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS = "50"; // allow enough parts to exercise the split
    const preloaded = compileLunaBudgetedPrompt(build(), capabilities, "turn_12345678901234567890123456789012");
    expect(preloaded.preloadParts).toBeGreaterThan(0);
    expect(preloaded.compiled.preamble?.length).toBe(preloaded.preloadParts);
    // Every delivered message — each preload part and the final — fits the transport budget.
    for (const part of preloaded.compiled.preamble!) {
      expect(estimateTokens(part)).toBeLessThanOrEqual(CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET);
    }
    expect(estimateCompiledChatGptWebInputTokens(preloaded.compiled, CHATGPT_WEB_LUNA_MODEL_ID))
      .toBeLessThanOrEqual(CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET);
    expect(preloaded.compiled.text).toContain("current task: summarize the audit");

    // The part cap forces a fallback to collapse when a turn would need too many parts.
    process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS = "1";
    const capped = compileLunaBudgetedPrompt(build(), capabilities, "turn_12345678901234567890123456789012");
    expect(capped.preloadParts).toBe(0);
    expect(capped.collapsedMessages).toBeGreaterThan(0);

    process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD = "off";
    delete process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS;
    const collapsed = compileLunaBudgetedPrompt(build(), capabilities, "turn_12345678901234567890123456789012");
    expect(collapsed.preloadParts).toBe(0);
    expect(collapsed.compiled.preamble).toBeUndefined();
    expect(collapsed.collapsedMessages).toBeGreaterThan(0);

    // A3: an explicit disablePreload compiles a single slimmed message even with the flag on.
    process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD = "on";
    const disabled = compileLunaBudgetedPrompt(
      build(), capabilities, "turn_12345678901234567890123456789012", { disablePreload: true });
    expect(disabled.preloadParts).toBe(0);
    expect(disabled.compiled.preamble).toBeUndefined();
    expect(disabled.collapsedMessages).toBeGreaterThan(0);
  } finally {
    if (previousFlag === undefined) delete process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD;
    else process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD = previousFlag;
    if (previousMax === undefined) delete process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS;
    else process.env.CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS = previousMax;
  }
}, 20_000);

test("A1: with preload on a user rule section is preloaded verbatim, not condensed", () => {
  const ruleMarker = "ALWAYS-CITE-EXACT-PATHS";
  const ruleBody = `## Rule: user-guidance\n\n${ruleMarker}. ${"Follow this closely. ".repeat(300)}`;
  const build = (): CodexParsedRequest => {
    const messages: CodexMessage[] = [developerMessage(ruleBody)];
    for (let turn = 0; turn < 60; turn += 1) {
      messages.push(userMessage(`turn ${turn} ${BIG}`));
      messages.push(assistantMessage(`answer ${turn} ${BIG}`));
    }
    messages.push(userMessage("current task: apply the guidance"));
    return {
      modelId: CHATGPT_WEB_LUNA_MODEL_ID,
      stream: true,
      options: { reasoning: undefined },
      context: { systemPrompt: ["You are the model backend."], messages },
    } as unknown as CodexParsedRequest;
  };
  const capabilities = { localToolsEnabled: true, solAvailable: false, proAvailable: false };
  const token = "turn_12345678901234567890123456789012";

  const preloaded = withPreloadEnv(
    { CODEX_CHATGPT_WEB_LUNA_PRELOAD: "on", CODEX_CHATGPT_WEB_LUNA_PRELOAD_MAX_PARTS: "50" },
    () => compileLunaBudgetedPrompt(build(), capabilities, token),
  );
  expect(preloaded.preloadParts).toBeGreaterThan(0);
  expect(preloaded.condensedTokens).toBe(0); // condense never ran — the rule was not trimmed
  expect(preloaded.compiled.preamble!.join("\n")).toContain(ruleMarker); // delivered verbatim

  const off = withPreloadEnv(
    { CODEX_CHATGPT_WEB_LUNA_PRELOAD: "off" },
    () => compileLunaBudgetedPrompt(build(), capabilities, token),
  );
  expect(off.preloadParts).toBe(0);
  expect(off.condensedTokens).toBeGreaterThan(0); // without preload the user rule is condensed
});

test("the slimming summary names every applied action and reports the budget outcome", () => {
  const summary = describeLunaSlimming(
    {
      removedSections: [{ name: "skill-domain-routing", estTokens: 1400 }],
      condensedTokens: 250,
      collapsedMessages: 935,
      collapsedTokens: 980_000,
      beforeTokens: 1_000_000,
      estimatedTokens: 17_000,
    },
    28_000,
  );
  expect(summary).toContain("skill-domain-routing (~1,400 tokens)");
  expect(summary).toContain("condensed the remaining rule sections (~250 tokens)");
  expect(summary).toContain("collapsed 935 older history message(s) (~980,000 tokens)");
  expect(summary).toContain("~1,000,000 → ~17,000");
  expect(summary).toContain("fits the 28,000-token");
});
