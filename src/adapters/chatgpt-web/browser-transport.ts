import { ChatGptWebAdapterError } from "./adapter-error";

/**
 * Reusable transport-delivery mechanics for a prepared turn: how ordered preamble parts are wrapped
 * and iterated, and how a mid-delivery failure is classified. This module owns the delivery
 * *sequence and error policy*; the caller supplies the actual DOM `deliverPart` step (composer
 * attach, submit, wait) so page/session details stay in the browser worker.
 */

/**
 * Wrapper text for one preload preamble message. Preload splits an over-budget turn into ordered
 * context parts plus a final task message; each part asks the model only to store the context and
 * reply "OK". The turn does not depend on that reply — any completed response advances delivery — but
 * the instruction keeps the intermediate answers short.
 */
export function chatGptPreambleMessageText(chunk: string, index: number, total: number): string {
  return [
    `[Codex context preload — part ${index + 1} of ${total}]`,
    "This is earlier task context, split only to fit the per-message size limit. Read and remember"
    + " it, then reply with just OK. Do not act on it and do not answer anything yet — the complete"
    + " current instruction arrives in the final part.",
    "",
    chunk,
  ].join("\n");
}

/**
 * Deliver every preamble part in order before the final message. Each part is wrapped with
 * {@link chatGptPreambleMessageText} and handed to `deliverPart`. Abort propagates unchanged;
 * any other failure is classified as a retryable `preload_delivery_failed` so the adapter re-sends
 * the turn once as a single slimmed message instead of failing a turn that would otherwise have fit.
 */
export async function deliverPreambleParts(
  parts: readonly string[],
  deliverPart: (text: string, index: number, total: number) => Promise<void>,
  isAborted: () => boolean,
): Promise<void> {
  try {
    for (let index = 0; index < parts.length; index += 1) {
      await deliverPart(chatGptPreambleMessageText(parts[index]!, index, parts.length), index, parts.length);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (isAborted()) throw error;
    throw new ChatGptWebAdapterError(
      `ChatGPT preload delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 502, errorType: "server_error", code: "preload_delivery_failed", retryable: true },
    );
  }
}
