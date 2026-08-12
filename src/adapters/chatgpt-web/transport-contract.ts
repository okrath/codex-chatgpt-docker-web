import type { ChatGptWebPromptImage, CompiledChatGptWebPrompt } from "./prompt";

/**
 * Transport boundary for a ChatGPT Web turn.
 *
 * This module owns the stable shape passed from prompt compilation/budget policy to the browser
 * delivery runtime. It deliberately imports only compiled-prompt data types — never Playwright/DOM
 * concerns and never Luna rule/history/skill policy — so the compiler owns semantic content, this
 * contract owns ordering/accounting, and the browser worker owns DOM delivery.
 */

/**
 * The compiled prompt plus its turn-scoped lifecycle hook, exactly as `prepare()` yields it today.
 * Naming the shape gives the boundary a single type to migrate against; it stays structurally
 * identical to the existing inline `CompiledChatGptWebPrompt & { release: () => void }`.
 */
export type PreparedChatGptWebPrompt = CompiledChatGptWebPrompt & { release: () => void };

/**
 * Immutable transport intent for one turn: what browser messages to deliver, in what order, with
 * what accounting, and the lifecycle hook to release afterwards. Execution details (composer
 * verification, submit, completion evidence, timeouts) are the browser worker's concern, not this
 * type's.
 */
export interface ChatGptWebTransportPlan {
  /** The final browser message text (current task plus transport/tool/checkpoint contracts). */
  readonly finalMessage: string;
  /**
   * Ordered earlier-context messages delivered as their own browser messages before `finalMessage`.
   * Empty for a single-message (under-budget) turn.
   */
  readonly preamble: readonly string[];
  /** Attachments to send with the final message. */
  readonly images: readonly ChatGptWebPromptImage[];
  /**
   * Estimated input tokens for the final delivered message, as supplied by the caller. This is the
   * number the browser transport preflight checks against the per-message budget; the summed-across-
   * parts total is a separate usage-accounting concern owned by the budget pipeline, not this plan.
   */
  readonly estimatedInputTokens: number;
  /** Oldest history items removed by native-style compaction fit recovery; 0 on normal turns. */
  readonly trimmedCompactionMessages: number;
  /** Turn-scoped lifecycle hook, released once delivery no longer needs the prepared resources. */
  readonly release: () => void;
}

/**
 * Map the current compiler result (plus its externally computed final-message input-token estimate)
 * into the transport plan. Byte-for-byte equivalent to the fields the browser worker reads today: an
 * absent `preamble` becomes an empty list (single-message turn) and an absent
 * `trimmedCompactionMessages` becomes 0. The token estimate is supplied by the caller because it is
 * derived from the compiled prompt (`estimateCompiledChatGptWebInputTokens`) rather than owned by the
 * compiler.
 */
export function toChatGptWebTransportPlan(
  prepared: PreparedChatGptWebPrompt,
  estimatedInputTokens: number,
): ChatGptWebTransportPlan {
  return {
    finalMessage: prepared.text,
    preamble: prepared.preamble ?? [],
    images: prepared.images,
    estimatedInputTokens,
    trimmedCompactionMessages: prepared.trimmedCompactionMessages ?? 0,
    release: prepared.release,
  };
}
