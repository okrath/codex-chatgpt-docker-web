import type { CodexContentPart, CodexMessage, CodexParsedRequest } from "../../types";
import { estimateTokens } from "../../lib/token-estimate";
import {
  CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET,
  estimateCompiledChatGptWebInputTokens,
} from "./input-tokens";
import { CHATGPT_WEB_LUNA_MODEL_ID, type ChatGptWebCapabilities } from "./model";
import {
  compileChatGptWebPrompt,
  type CompiledChatGptWebPrompt,
  type CompileChatGptWebPromptOptions,
} from "./prompt";

/**
 * ClaudeKit-style instruction bundles concatenate independent rule files as
 * `## Rule: <name>` sections. Several of those sections instruct a different
 * harness entirely (Claude Code slash-command skills, hook protocols, agent-team
 * coordination) and are dead weight for a ChatGPT Web browser turn. Every Luna
 * turn sheds these sections unconditionally — the Web model cannot execute them,
 * and ChatGPT Free's measured per-message transport budget is scarce.
 *
 * Override with CODEX_CHATGPT_WEB_LUNA_TRIM_RULES (comma-separated section
 * names); set it to "off" to disable slimming entirely.
 */
export const LUNA_DISPOSABLE_RULE_SECTIONS: readonly string[] = [
  "skill-domain-routing",
  "skill-workflow-routing",
  "team-coordination-rules",
  "orchestration-protocol",
  "CLAUDE",
];

export function lunaDisposableRuleSections(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const configured = env.CODEX_CHATGPT_WEB_LUNA_TRIM_RULES?.trim();
  if (configured === undefined || configured === "") return LUNA_DISPOSABLE_RULE_SECTIONS;
  if (configured.toLowerCase() === "off") return [];
  return configured.split(",").map(name => name.trim()).filter(Boolean);
}

export interface LunaSlimmedSection {
  name: string;
  estTokens: number;
}

const RULE_HEADER_PATTERN = /^## Rule: (.+?)\s*$/;

/**
 * Remove one named `## Rule:` section from a rule-bundle text. A section spans
 * its header line through the line before the next header (or the end of the
 * text), which also swallows the bundle's `---` separators inside the section.
 */
function stripRuleSectionFromText(text: string, sectionName: string): { text: string; removed: string } | undefined {
  const lines = text.split("\n");
  const kept: string[] = [];
  const removed: string[] = [];
  let removing = false;
  let found = false;
  for (const line of lines) {
    const header = RULE_HEADER_PATTERN.exec(line);
    if (header) removing = header[1] === sectionName;
    if (removing) {
      found = true;
      removed.push(line);
    } else {
      kept.push(line);
    }
  }
  if (!found) return undefined;
  return { text: kept.join("\n"), removed: removed.join("\n") };
}

function stripRuleSectionFromContent(
  content: string | CodexContentPart[],
  sectionName: string,
): { content: string | CodexContentPart[]; removed: string } | undefined {
  if (typeof content === "string") {
    const result = stripRuleSectionFromText(content, sectionName);
    return result ? { content: result.text, removed: result.removed } : undefined;
  }
  let removedText = "";
  const parts = content.map(part => {
    if (part.type !== "text") return part;
    const result = stripRuleSectionFromText(part.text, sectionName);
    if (!result) return part;
    removedText += (removedText ? "\n" : "") + result.removed;
    return { ...part, text: result.text };
  });
  return removedText ? { content: parts, removed: removedText } : undefined;
}

/**
 * Remove a named rule section from every user/developer message that carries it.
 * Assistant history and tool results are never touched. Returns undefined when
 * no message contains the section.
 */
export function stripLunaRuleSection(
  messages: readonly CodexMessage[],
  sectionName: string,
  modelId?: string,
): { messages: CodexMessage[]; estTokensRemoved: number } | undefined {
  let estTokensRemoved = 0;
  const next = messages.map(message => {
    if (message.role !== "user" && message.role !== "developer") return message;
    const result = stripRuleSectionFromContent(message.content, sectionName);
    if (!result) return message;
    estTokensRemoved += estimateTokens(result.removed, modelId);
    return { ...message, content: result.content } as CodexMessage;
  });
  if (estTokensRemoved === 0) return undefined;
  return { messages: next, estTokensRemoved };
}

const CONDENSED_SECTION_NOTE = "…(condensed: full text omitted to fit the free-tier browser transport budget)";
const CONDENSED_SECTION_KEEP_CHARS = 400;

/**
 * Condense every remaining `## Rule:` section to its header plus the first
 * paragraph. This runs only after the disposable sections were already dropped
 * and the turn still exceeds the transport budget — the alternative is a hard
 * failure, so a lossy-but-deterministic digest of instruction bundles is the
 * better trade. Task content, environment blocks, assistant history, and tool
 * results are never condensed.
 */
function condenseRuleSectionsInText(text: string): { text: string; removed: string } | undefined {
  const lines = text.split("\n");
  const output: string[] = [];
  const removed: string[] = [];
  let inSection = false;
  let keptChars = 0;
  let paragraphEnded = false;
  for (const line of lines) {
    const header = RULE_HEADER_PATTERN.exec(line);
    if (header) {
      inSection = true;
      keptChars = 0;
      paragraphEnded = false;
      output.push(line);
      continue;
    }
    if (!inSection) {
      output.push(line);
      continue;
    }
    if (!paragraphEnded && line.trim() === "" && keptChars > 0) {
      paragraphEnded = true;
      output.push(CONDENSED_SECTION_NOTE, "");
      continue;
    }
    if (!paragraphEnded && keptChars + line.length <= CONDENSED_SECTION_KEEP_CHARS) {
      keptChars += line.length;
      output.push(line);
      continue;
    }
    if (!paragraphEnded) {
      paragraphEnded = true;
      output.push(CONDENSED_SECTION_NOTE, "");
    }
    removed.push(line);
  }
  if (removed.length === 0) return undefined;
  return { text: output.join("\n"), removed: removed.join("\n") };
}

/**
 * Condense the remaining rule bundles across every user/developer message.
 * Returns undefined when nothing was condensed.
 */
export function condenseLunaRuleSections(
  messages: readonly CodexMessage[],
  modelId?: string,
): { messages: CodexMessage[]; estTokensRemoved: number } | undefined {
  let estTokensRemoved = 0;
  const next = messages.map(message => {
    if (message.role !== "user" && message.role !== "developer") return message;
    if (typeof message.content === "string") {
      const result = condenseRuleSectionsInText(message.content);
      if (!result) return message;
      estTokensRemoved += estimateTokens(result.removed, modelId);
      return { ...message, content: result.text } as CodexMessage;
    }
    let removedText = "";
    const parts = message.content.map(part => {
      if (part.type !== "text") return part;
      const result = condenseRuleSectionsInText(part.text);
      if (!result) return part;
      removedText += (removedText ? "\n" : "") + result.removed;
      return { ...part, text: result.text };
    });
    if (!removedText) return message;
    estTokensRemoved += estimateTokens(removedText, modelId);
    return { ...message, content: parts } as CodexMessage;
  });
  if (estTokensRemoved === 0) return undefined;
  return { messages: next, estTokensRemoved };
}

/** Tool results delivered after the last assistant answer belong to the round in flight. */
function currentRoundStartIndex(messages: readonly CodexMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "assistant") return index + 1;
  }
  return 0;
}

function messageText(message: CodexMessage): string {
  const content = (message as { content: unknown }).content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

const LUNA_TRIM_MIN_TOKENS = 64;
export const LUNA_KEEP_RECENT_TOOL_RESULTS = 4;
export const LUNA_KEEP_RECENT_MESSAGES = 8;

/**
 * Replace the contents of older tool results with a short note. Results that
 * arrived after the last assistant answer belong to the current round and are
 * never touched, and the most recent completed ones are kept verbatim.
 */
export function trimOldLunaToolResults(
  messages: readonly CodexMessage[],
  modelId?: string,
  keepRecent = LUNA_KEEP_RECENT_TOOL_RESULTS,
): { messages: CodexMessage[]; trimmedCount: number; estTokensRemoved: number } | undefined {
  const protectedFrom = currentRoundStartIndex(messages);
  const completedToolResults = messages.flatMap((message, index) =>
    message.role === "toolResult" && index < protectedFrom ? [index] : []
  );
  const trimmable = completedToolResults.slice(0, Math.max(0, completedToolResults.length - keepRecent));
  if (trimmable.length === 0) return undefined;
  let estTokensRemoved = 0;
  let trimmedCount = 0;
  const next = [...messages];
  for (const index of trimmable) {
    const message = next[index]!;
    const tokens = estimateTokens(messageText(message), modelId);
    if (tokens < LUNA_TRIM_MIN_TOKENS) continue;
    estTokensRemoved += tokens;
    trimmedCount += 1;
    next[index] = {
      ...message,
      content: `[trimmed by the bridge: older tool result (~${tokens.toLocaleString("en-US")} tokens) removed to fit the ChatGPT Free browser transport budget]`,
    } as CodexMessage;
  }
  if (trimmedCount === 0) return undefined;
  return { messages: next, trimmedCount, estTokensRemoved };
}

/**
 * Last resort for very long threads: elide the contents of older user,
 * assistant, and tool-result history. The most recent messages are kept
 * verbatim. Developer messages (contracts, skill instructions) are kept by
 * default, and only elided when `elideDevelopers` is set for the deepest
 * escalation step — the turn's trusted environment is resolved separately and
 * cached per thread, so eliding contract text here does not break full mode.
 */
export function elideOldLunaHistory(
  messages: readonly CodexMessage[],
  modelId?: string,
  keepRecent = LUNA_KEEP_RECENT_MESSAGES,
  elideDevelopers = false,
): { messages: CodexMessage[]; elidedCount: number; estTokensRemoved: number } | undefined {
  const cutoff = Math.min(Math.max(0, messages.length - keepRecent), currentRoundStartIndex(messages));
  let estTokensRemoved = 0;
  let elidedCount = 0;
  const next = messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (message.role === "developer" && !elideDevelopers) return message;
    const tokens = estimateTokens(messageText(message), modelId);
    if (tokens < LUNA_TRIM_MIN_TOKENS) return message;
    estTokensRemoved += tokens;
    elidedCount += 1;
    const note = `[trimmed by the bridge: older task history (~${tokens.toLocaleString("en-US")} tokens) removed to fit the ChatGPT Free browser transport budget]`;
    if (message.role === "assistant") {
      return { ...message, content: [{ type: "text", text: note }] } as CodexMessage;
    }
    return { ...message, content: note } as CodexMessage;
  });
  if (elidedCount === 0) return undefined;
  return { messages: next, elidedCount, estTokensRemoved };
}

export interface LunaBudgetedCompilation {
  compiled: CompiledChatGptWebPrompt;
  /** The message list the compiled prompt was built from (post-slimming). */
  messages: readonly CodexMessage[];
  slimmed: boolean;
  beforeTokens: number;
  estimatedTokens: number;
  removedSections: LunaSlimmedSection[];
  condensedTokens: number;
  trimmedToolResults: number;
  trimmedToolResultTokens: number;
  elidedMessages: number;
  elidedMessageTokens: number;
}

/**
 * Compile a browser prompt under the ChatGPT Free transport budget. Luna turns
 * always shed the harness-only rule sections; when the turn still exceeds the
 * budget the pipeline escalates: condense remaining rule sections → trim older
 * tool results → elide older history. Non-Luna models and compaction turns
 * compile untouched. Only the copy sent to the browser is modified.
 */
export function compileLunaBudgetedPrompt(
  parsed: CodexParsedRequest,
  capabilities: ChatGptWebCapabilities,
  turnToken: string | undefined,
  options?: CompileChatGptWebPromptOptions,
): LunaBudgetedCompilation {
  let working = parsed;
  const compileWith = (input: CodexParsedRequest): CompiledChatGptWebPrompt =>
    compileChatGptWebPrompt(input, capabilities, turnToken, options);
  const withMessages = (messages: readonly CodexMessage[]): CodexParsedRequest => ({
    ...working,
    context: { ...working.context, messages: [...messages] },
  });

  let compiled = compileWith(working);
  const beforeTokens = estimateCompiledChatGptWebInputTokens(compiled, parsed.modelId);
  const result: LunaBudgetedCompilation = {
    compiled,
    messages: working.context.messages,
    slimmed: false,
    beforeTokens,
    estimatedTokens: beforeTokens,
    removedSections: [],
    condensedTokens: 0,
    trimmedToolResults: 0,
    trimmedToolResultTokens: 0,
    elidedMessages: 0,
    elidedMessageTokens: 0,
  };
  if (parsed.modelId !== CHATGPT_WEB_LUNA_MODEL_ID || parsed._compactionRequest) return result;

  const budget = CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET;
  const recompile = (): void => {
    result.compiled = compileWith(working);
    result.estimatedTokens = estimateCompiledChatGptWebInputTokens(result.compiled, parsed.modelId);
    result.messages = working.context.messages;
    result.slimmed = true;
  };

  for (const section of lunaDisposableRuleSections()) {
    const stripped = stripLunaRuleSection(working.context.messages, section, parsed.modelId);
    if (!stripped) continue;
    working = withMessages(stripped.messages);
    result.removedSections.push({ name: section, estTokens: stripped.estTokensRemoved });
  }
  if (result.removedSections.length > 0) recompile();

  if (result.estimatedTokens > budget) {
    const condensed = condenseLunaRuleSections(working.context.messages, parsed.modelId);
    if (condensed) {
      working = withMessages(condensed.messages);
      result.condensedTokens = condensed.estTokensRemoved;
      recompile();
    }
  }

  // Escalate trimming and history elision with shrinking keep-windows until the
  // turn fits (or nothing is left to cut but the protected current round). Each
  // step only touches content the previous step left verbatim, so re-running
  // with a smaller window removes strictly more. The final step elides older
  // developer contracts too — the deepest cut, approaching "only the current
  // turn survives" (what clearing the thread would leave), done automatically.
  const escalation: Array<{ tool: number; hist: number; elideDevelopers: boolean }> = [
    { tool: LUNA_KEEP_RECENT_TOOL_RESULTS, hist: LUNA_KEEP_RECENT_MESSAGES, elideDevelopers: false },
    { tool: 1, hist: 4, elideDevelopers: false },
    { tool: 0, hist: 2, elideDevelopers: false },
    { tool: 0, hist: 1, elideDevelopers: true },
  ];
  for (const step of escalation) {
    if (result.estimatedTokens <= budget) break;
    let changed = false;
    const trimmed = trimOldLunaToolResults(working.context.messages, parsed.modelId, step.tool);
    if (trimmed) {
      working = withMessages(trimmed.messages);
      result.trimmedToolResults += trimmed.trimmedCount;
      result.trimmedToolResultTokens += trimmed.estTokensRemoved;
      changed = true;
    }
    const elided = elideOldLunaHistory(working.context.messages, parsed.modelId, step.hist, step.elideDevelopers);
    if (elided) {
      working = withMessages(elided.messages);
      result.elidedMessages += elided.elidedCount;
      result.elidedMessageTokens += elided.estTokensRemoved;
      changed = true;
    }
    if (changed) recompile();
  }

  return result;
}

/** One-line summary for the visible Codex trace and the daemon log. */
export function describeLunaSlimming(
  result: Pick<
    LunaBudgetedCompilation,
    | "removedSections" | "condensedTokens" | "trimmedToolResults" | "trimmedToolResultTokens"
    | "elidedMessages" | "elidedMessageTokens" | "beforeTokens" | "estimatedTokens"
  >,
  budgetTokens: number,
): string {
  const actions: string[] = [];
  if (result.removedSections.length > 0) {
    const sections = result.removedSections
      .map(section => `${section.name} (~${section.estTokens.toLocaleString("en-US")} tokens)`)
      .join(", ");
    actions.push(`dropped harness-only rule sections the Web model cannot use: ${sections}`);
  }
  if (result.condensedTokens > 0) {
    actions.push(`condensed the remaining rule sections (~${result.condensedTokens.toLocaleString("en-US")} tokens)`);
  }
  if (result.trimmedToolResults > 0) {
    actions.push(`trimmed ${result.trimmedToolResults} older tool result(s) (~${result.trimmedToolResultTokens.toLocaleString("en-US")} tokens)`);
  }
  if (result.elidedMessages > 0) {
    actions.push(`elided ${result.elidedMessages} older history message(s) (~${result.elidedMessageTokens.toLocaleString("en-US")} tokens)`);
  }
  const outcome = result.estimatedTokens <= budgetTokens
    ? `fits the ${budgetTokens.toLocaleString("en-US")}-token ChatGPT Free transport budget`
    : `still exceeds the ${budgetTokens.toLocaleString("en-US")}-token ChatGPT Free transport budget`;
  return `✂️ Luna context slimming ${actions.join("; ")}. `
    + `Estimated input: ~${result.beforeTokens.toLocaleString("en-US")} → ~${result.estimatedTokens.toLocaleString("en-US")} tokens (${outcome}).`;
}

/** Largest remaining context messages, for actionable overflow suggestions. */
export function describeLunaOverflowSuggestions(
  messages: readonly CodexMessage[],
  estimatedTokens: number,
  budgetTokens: number,
  modelId?: string,
): string {
  const labeled = messages.map(message => {
    const text = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map(part => "text" in part && typeof part.text === "string" ? part.text : "").join("\n")
        : "";
    const snippet = text.trim().replace(/\s+/g, " ").slice(0, 60);
    return { role: message.role, estTokens: estimateTokens(text, modelId), snippet };
  }).filter(entry => entry.estTokens > 0);
  labeled.sort((a, b) => b.estTokens - a.estTokens);
  const top = labeled.slice(0, 3)
    .map(entry => `${entry.role} ~${entry.estTokens.toLocaleString("en-US")} tokens ("${entry.snippet}…")`)
    .join("; ");
  return `⚠️ This Luna turn is still ~${estimatedTokens.toLocaleString("en-US")} estimated tokens, over the `
    + `${budgetTokens.toLocaleString("en-US")}-token ChatGPT Free transport budget. Largest context blocks: ${top}. `
    + `Trim global instructions (for example ~/.codex/AGENTS.md), start a smaller task, or use a paid ChatGPT tier with a larger transport.`;
}
