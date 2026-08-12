/**
 * Fail-open recall of Luna-collapsed history. When a long thread is collapsed to fit the ChatGPT
 * Free transport budget, the removed messages stay verbatim in turn-scoped broker RAM and the
 * browser model MAY fetch them through these reserved `codex_tool_call` wire names. The model is
 * never required to call them: a turn that ignores recall behaves exactly as it does today.
 *
 * Discovery is the collapse marker sentence only — no public tools/list or inventory change (the
 * Native3 connector-identity lesson). State is read-only, turn-scoped, and wiped on revoke.
 */
export const HISTORY_SEARCH_WIRE_NAME = "__codex_search_collapsed_history_v1";
export const HISTORY_LOAD_WIRE_NAME = "__codex_load_collapsed_history_v1";

export const HISTORY_SEARCH_QUERY_MIN_CHARS = 2;
export const HISTORY_SEARCH_QUERY_MAX_CHARS = 500;
export const HISTORY_SEARCH_LIMIT_DEFAULT = 5;
export const HISTORY_SEARCH_LIMIT_MAX = 8;
export const HISTORY_SEARCH_SNIPPET_RADIUS = 200;

export const HISTORY_LOAD_MAX_INDEXES = 5;
export const HISTORY_LOAD_RESPONSE_CHAR_CAP = 32_000;

/** A single browser tool result must not exceed roughly this before ChatGPT truncates it; tuned in live smoke. */
export const COLLAPSED_HISTORY_STORE_BYTE_CAP = 50_000_000;

export interface RemovedHistoryMessage {
  /** Stable per-turn id the model passes to the load tool; equals the array position of the store. */
  index: number;
  role: string;
  text: string;
}

export interface CollapsedHistorySearchMatch {
  index: number;
  role: string;
  snippet: string;
  chars: number;
}
