import { CHATGPT_WEB_PLATFORM_RESERVE_TOKENS } from "../../chatgpt-web-models";
import { estimateTokens } from "../../lib/token-estimate";
import type { CompiledChatGptWebPrompt } from "./prompt";

// ChatGPT's product system prompt and the fixed Codex Native MCP schemas are not present in the
// visible composer text. Reserve them explicitly; over-counting fails safe by compacting earlier.
const CHATGPT_IMAGE_RESERVE_TOKENS = 4_096;
const CHATGPT_ORIGINAL_IMAGE_RESERVE_TOKENS = 8_192;

/**
 * The Free/Luna product accepted measured browser inputs at 25,400 and 28,547 estimated tokens,
 * but rejected the same shape at 32,283 before producing a response. This is a ChatGPT browser
 * transport boundary, not Luna's model context window, and applies to normal and checkpoint turns.
 */
export const CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET = 28_000;

/**
 * The threshold at which Luna slimming (rule-drop, condense, preload, collapse) engages. Defaults to
 * the measured transport budget. `CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE` lowers it (clamped to
 * [1000, budget]) so slimming and preload can be exercised on ordinary threads for testing or tuned
 * if the product boundary drifts; it never raises the real transport limit enforced at send time.
 */
export function chatGptLunaSlimmingBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEX_CHATGPT_WEB_LUNA_BUDGET_OVERRIDE?.trim();
  if (!raw) return CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1_000) return CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET;
  return Math.min(value, CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET);
}

/** Tokens present in the one visible browser message, excluding hidden product/tool reserves. */
export function estimateCompiledChatGptWebMessageTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  return estimateTokens(compiled.text, modelId);
}

export function estimateCompiledChatGptWebInputTokens(
  compiled: CompiledChatGptWebPrompt,
  modelId: string,
): number {
  const imageTokens = compiled.images.reduce(
    (total, image) => total + (image.detail === "original"
      ? CHATGPT_ORIGINAL_IMAGE_RESERVE_TOKENS
      : CHATGPT_IMAGE_RESERVE_TOKENS),
    0,
  );
  return CHATGPT_WEB_PLATFORM_RESERVE_TOKENS
    + estimateCompiledChatGptWebMessageTokens(compiled, modelId)
    + imageTokens;
}
