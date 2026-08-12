import type { CodexContentPart, CodexMessage, CodexParsedRequest } from "../../types";
import { estimateTokens } from "../../lib/token-estimate";
import {
  CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET,
  estimateCompiledChatGptWebInputTokens,
} from "./input-tokens";
import { CHATGPT_WEB_LUNA_MODEL_ID, resolveChatGptWebModelMode, type ChatGptWebCapabilities } from "./model";
import {
  compileChatGptWebPrompt,
  type CompiledChatGptWebPrompt,
  type CompileChatGptWebPromptOptions,
} from "./prompt";
import {
  HISTORY_LOAD_WIRE_NAME,
  HISTORY_SEARCH_WIRE_NAME,
  type RemovedHistoryMessage,
} from "./history-recall";

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

/** Human-readable text of a collapsed message for verbatim recall; non-text parts become placeholders. */
function readableMessageText(message: CodexMessage): string {
  const content = (message as { content: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => {
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") return record.text;
    if (record.type === "image" || record.type === "inputImage") return "[image]";
    return "[part]";
  }).join("\n");
}

/** One sentence appended to the collapse marker in Full mode so the model can discover recall. */
function collapsedHistoryRecallSentence(): string {
  return " The removed messages are available verbatim this turn:"
    + ` call codex_tool_call with wire_name "${HISTORY_SEARCH_WIRE_NAME}" ({"query":"…"})`
    + ` or "${HISTORY_LOAD_WIRE_NAME}" ({"indexes":[…]}) using this turn's turn_token.`;
}

const LUNA_COLLAPSE_MIN_TOKENS = 16;
export const LUNA_KEEP_RECENT_MESSAGES = 8;

const LUNA_COLLAPSE_MARKER_PREFIX = "[bridge removed";

/**
 * Remove older history outright and replace the whole removed span with a
 * single marker message, instead of leaving one placeholder per message — a
 * very long thread has hundreds of history items, and one short note each still
 * sums to tens of thousands of tokens. The most recent `keepRecent` messages
 * and the in-flight round (everything after the last assistant answer) are kept
 * verbatim. Developer messages are kept unless `collapseDevelopers` is set for
 * the deepest escalation step — the turn's trusted environment is resolved and
 * cached separately, so collapsing contract text here does not break full mode.
 */
export function collapseOldLunaHistory(
  messages: readonly CodexMessage[],
  modelId?: string,
  keepRecent = LUNA_KEEP_RECENT_MESSAGES,
  collapseDevelopers = false,
  advertiseHistoryRecall = false,
): { messages: CodexMessage[]; collapsedCount: number; estTokensRemoved: number; removed: CodexMessage[] } | undefined {
  const cutoff = Math.min(Math.max(0, messages.length - keepRecent), currentRoundStartIndex(messages));
  if (cutoff <= 0) return undefined;
  const head: CodexMessage[] = [];
  const removed: CodexMessage[] = [];
  let estTokensRemoved = 0;
  for (let index = 0; index < cutoff; index += 1) {
    const message = messages[index]!;
    if (message.role === "developer" && !collapseDevelopers) {
      head.push(message);
      continue;
    }
    const text = messageText(message);
    // A prior step's marker is tiny; fold it into the new one without counting.
    if (typeof message.content === "string" && message.content.startsWith(LUNA_COLLAPSE_MARKER_PREFIX)) {
      continue;
    }
    if (estimateTokens(text, modelId) < LUNA_COLLAPSE_MIN_TOKENS) {
      head.push(message);
      continue;
    }
    removed.push(message);
    estTokensRemoved += estimateTokens(text, modelId);
  }
  if (removed.length === 0) return undefined;
  const marker: CodexMessage = {
    role: "user",
    content: `${LUNA_COLLAPSE_MARKER_PREFIX} ${removed.length.toLocaleString("en-US")} older message(s)`
      + ` (~${estTokensRemoved.toLocaleString("en-US")} tokens) to fit the ChatGPT Free browser transport budget]`
      + (advertiseHistoryRecall ? collapsedHistoryRecallSentence() : ""),
    timestamp: 0,
  };
  return { messages: [...head, marker, ...messages.slice(cutoff)], collapsedCount: removed.length, estTokensRemoved, removed };
}

/**
 * Token budget the collapse index may spend, indexed by escalation depth. A deeper cut means the
 * turn is tighter, so the index shrinks and the deepest step drops it entirely — the marker then
 * costs exactly what it did before the index existed, preserving convergence.
 */
export const LUNA_COLLAPSE_INDEX_STEP_BUDGETS: readonly number[] = [1_000, 600, 300, 0];
const LUNA_COLLAPSE_INDEX_GROUP_START = 10;
const LUNA_COLLAPSE_INDEX_SNIPPET_CHARS = 60;
const LUNA_COLLAPSE_INDEX_LINE_MAX_CHARS = 120;

function collapseIndexHeader(advertiseHistoryRecall: boolean): string {
  return advertiseHistoryRecall
    ? "\nCollapsed history index (load by index with the recall tools):\n"
    : "\nCollapsed history index (older removed context):\n";
}

/** One index line per contiguous run of `groupSize` removed messages: range, role counts, a snippet. */
function collapseIndexLines(removed: readonly RemovedHistoryMessage[], groupSize: number): string[] {
  const lines: string[] = [];
  for (let start = 0; start < removed.length; start += groupSize) {
    const chunk = removed.slice(start, start + groupSize);
    const first = chunk[0]!.index;
    const last = chunk[chunk.length - 1]!.index;
    const counts = new Map<string, number>();
    for (const message of chunk) counts.set(message.role, (counts.get(message.role) ?? 0) + 1);
    const roles = [...counts.entries()].map(([role, count]) => `${count} ${role}`).join(", ");
    const firstUser = chunk.find(message => message.role === "user");
    const snippet = firstUser
      ? firstUser.text.trim().replace(/\s+/g, " ").slice(0, LUNA_COLLAPSE_INDEX_SNIPPET_CHARS)
      : "";
    const range = first === last ? `#${first}` : `#${first}–${last}`;
    const line = `${range} · ${roles}${snippet ? ` · "${snippet}…"` : ""}`;
    lines.push(line.length > LUNA_COLLAPSE_INDEX_LINE_MAX_CHARS ? `${line.slice(0, LUNA_COLLAPSE_INDEX_LINE_MAX_CHARS)}…` : line);
  }
  return lines;
}

/**
 * Build a compact, budgeted table of contents for the collapsed span. Grouping starts at 10
 * messages per line and coarsens (doubling) until the index fits the step budget; a single
 * still-oversized index is truncated with an ellipsis. Deterministic — no model involvement.
 */
export function buildCollapsedHistoryIndex(
  removed: readonly RemovedHistoryMessage[],
  budgetTokens: number,
  advertiseHistoryRecall: boolean,
  modelId?: string,
): string {
  if (budgetTokens <= 0 || removed.length === 0) return "";
  const header = collapseIndexHeader(advertiseHistoryRecall);
  for (let groupSize = LUNA_COLLAPSE_INDEX_GROUP_START; ; groupSize *= 2) {
    const lines = collapseIndexLines(removed, groupSize);
    const text = header + lines.join("\n");
    if (estimateTokens(text, modelId) <= budgetTokens) return text;
    if (groupSize >= removed.length) {
      // Coarsened as far as it goes; keep as many whole lines as the budget allows, then elide.
      const kept: string[] = [];
      let accumulated = header;
      for (const line of lines) {
        if (estimateTokens(`${accumulated + line}\n`, modelId) > budgetTokens) break;
        kept.push(line);
        accumulated += `${line}\n`;
      }
      return kept.length < lines.length ? `${header}${[...kept, "…"].join("\n")}` : header + kept.join("\n");
    }
  }
}

function appendCollapseIndexToMarker(messages: readonly CodexMessage[], indexText: string): CodexMessage[] {
  return messages.map(message =>
    typeof message.content === "string" && message.content.startsWith(LUNA_COLLAPSE_MARKER_PREFIX)
      ? { ...message, content: message.content + indexText } as CodexMessage
      : message);
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
  collapsedMessages: number;
  collapsedTokens: number;
  /** Verbatim text of every collapsed message, for fail-open recall in Full mode. */
  removedHistory: RemovedHistoryMessage[];
}

/**
 * Compile a browser prompt under the ChatGPT Free transport budget. Luna turns
 * always shed the harness-only rule sections; when the turn still exceeds the
 * budget the pipeline escalates: condense remaining rule sections → collapse
 * older history into a single marker with shrinking keep-windows (developer
 * contracts collapsed only at the deepest step). Non-Luna models and compaction
 * turns compile untouched. Only the copy sent to the browser is modified.
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
    collapsedMessages: 0,
    collapsedTokens: 0,
    removedHistory: [],
  };
  if (parsed.modelId !== CHATGPT_WEB_LUNA_MODEL_ID || parsed._compactionRequest) return result;

  const budget = CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET;
  // Full mode (localTools) can serve collapsed history back through the broker, so the collapse
  // marker advertises the recall tools. The usage estimator calls this same function with the same
  // model and capabilities, so the advertised marker is counted identically in usage and delivery.
  const advertiseHistoryRecall = resolveChatGptWebModelMode(
    parsed.modelId,
    parsed.options.reasoning,
    capabilities,
  ).localTools;
  const removedHistoryMessages: CodexMessage[] = [];
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

  // Collapse older history into a single marker with shrinking keep-windows
  // until the turn fits. Each step re-collapses from the current message list,
  // so a smaller window removes strictly more; the final steps also collapse
  // older developer contracts — the deepest cut, approaching "only the current
  // turn survives" (what clearing the thread would leave), done automatically.
  const preCollapseTokens = result.estimatedTokens;
  const preCollapseCount = working.context.messages.length;
  const escalation: Array<{ keepRecent: number; collapseDevelopers: boolean }> = [
    { keepRecent: LUNA_KEEP_RECENT_MESSAGES, collapseDevelopers: false },
    { keepRecent: 4, collapseDevelopers: false },
    { keepRecent: 2, collapseDevelopers: true },
    { keepRecent: 1, collapseDevelopers: true },
  ];
  for (const [stepIndex, step] of escalation.entries()) {
    if (result.estimatedTokens <= budget) break;
    const collapsed = collapseOldLunaHistory(
      working.context.messages,
      parsed.modelId,
      step.keepRecent,
      step.collapseDevelopers,
      advertiseHistoryRecall,
    );
    if (!collapsed) continue;
    // Each step peels the older side of what the previous step kept, so appending yields the
    // collapsed messages in roughly chronological order; the index is a stable per-turn id.
    removedHistoryMessages.push(...collapsed.removed);
    // Embed the budgeted index in the marker BEFORE recompiling, so the index tokens count toward
    // the same budget check — a deeper step spends a smaller index budget, keeping convergence.
    const indexBudget = LUNA_COLLAPSE_INDEX_STEP_BUDGETS[stepIndex] ?? 0;
    const indexText = buildCollapsedHistoryIndex(
      removedHistoryMessages.map((message, index) => ({ index, role: message.role, text: readableMessageText(message) })),
      indexBudget,
      advertiseHistoryRecall,
      parsed.modelId,
    );
    working = withMessages(indexText ? appendCollapseIndexToMarker(collapsed.messages, indexText) : collapsed.messages);
    recompile();
  }
  if (working.context.messages.length < preCollapseCount) {
    result.collapsedMessages = preCollapseCount - working.context.messages.length;
    result.collapsedTokens = Math.max(0, preCollapseTokens - result.estimatedTokens);
  }
  result.removedHistory = removedHistoryMessages.map((message, index) => ({
    index,
    role: message.role,
    text: readableMessageText(message),
  }));

  return result;
}

/** One-line summary for the visible Codex trace and the daemon log. */
export function describeLunaSlimming(
  result: Pick<
    LunaBudgetedCompilation,
    | "removedSections" | "condensedTokens" | "collapsedMessages" | "collapsedTokens"
    | "beforeTokens" | "estimatedTokens"
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
  if (result.collapsedMessages > 0) {
    actions.push(`collapsed ${result.collapsedMessages.toLocaleString("en-US")} older history message(s) (~${result.collapsedTokens.toLocaleString("en-US")} tokens)`);
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
