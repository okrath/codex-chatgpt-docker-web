import type { CodexContentPart, CodexMessage } from "../../types";
import { estimateTokens } from "../../lib/token-estimate";

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

/** One-line summary for the visible Codex trace and the daemon log. */
export function describeLunaSlimming(
  removed: readonly LunaSlimmedSection[],
  condensedTokens: number,
  beforeTokens: number,
  afterTokens: number,
  budgetTokens: number,
): string {
  const actions: string[] = [];
  if (removed.length > 0) {
    const sections = removed
      .map(section => `${section.name} (~${section.estTokens.toLocaleString("en-US")} tokens)`)
      .join(", ");
    actions.push(`dropped harness-only rule sections the Web model cannot use: ${sections}`);
  }
  if (condensedTokens > 0) {
    actions.push(`condensed the remaining rule sections (~${condensedTokens.toLocaleString("en-US")} tokens)`);
  }
  const outcome = afterTokens <= budgetTokens
    ? `fits the ${budgetTokens.toLocaleString("en-US")}-token ChatGPT Free transport budget`
    : `still exceeds the ${budgetTokens.toLocaleString("en-US")}-token ChatGPT Free transport budget`;
  return `✂️ Luna context slimming ${actions.join("; ")}. `
    + `Estimated input: ~${beforeTokens.toLocaleString("en-US")} → ~${afterTokens.toLocaleString("en-US")} tokens (${outcome}).`;
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
