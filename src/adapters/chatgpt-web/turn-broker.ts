import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { isWindowsPipeEndpoint } from "../../config";
import type { ChatGptTurnEnvironment } from "./environment";
import {
  COLLAPSED_HISTORY_STORE_BYTE_CAP,
  HISTORY_LOAD_MAX_INDEXES,
  HISTORY_LOAD_RESPONSE_CHAR_CAP,
  HISTORY_SEARCH_LIMIT_DEFAULT,
  HISTORY_SEARCH_LIMIT_MAX,
  HISTORY_SEARCH_QUERY_MAX_CHARS,
  HISTORY_SEARCH_QUERY_MIN_CHARS,
  HISTORY_SEARCH_SNIPPET_RADIUS,
  type CollapsedHistorySearchMatch,
  type RemovedHistoryMessage,
} from "./history-recall";
import {
  assertResearchQuestionAcceptable,
  describeResearchSubagentFailure,
  RESEARCH_SUBAGENT_MAX_CALLS_PER_TURN,
  RESEARCH_SUBAGENT_RESULT_NOTE,
  ResearchSubagentBusyError,
  type ResearchSubagentOutcome,
  type ResearchSubagentRunner,
} from "./research-subagent";

interface PendingTurn extends ChatGptTurnEnvironment {
  expiresAt?: number;
}

export interface BrokerToolRequest {
  callId: string;
  wireName: string;
  freeform: boolean;
  arguments?: Record<string, unknown>;
  input?: string;
}

export interface BrokerToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}

interface PendingInvocation {
  request: BrokerToolRequest;
  resolve: (result: BrokerToolResult) => void;
  reject: (error: Error) => void;
}

interface ToolWaiter {
  resolve: (requests: BrokerToolRequest[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface TurnChannel {
  traceId: string;
  environment: PendingTurn;
  bindingId?: string;
  queuedCallIds: string[];
  invocations: Map<string, PendingInvocation>;
  waiters: Set<ToolWaiter>;
  batchTimer?: ReturnType<typeof setTimeout>;
  collapsedHistory?: RemovedHistoryMessage[];
  researchSubagent?: ResearchSubagentRunner;
  researchSubagentCalls: number;
  finalized?: boolean;
}

interface BrokerRequest {
  id: string;
  method: "claim" | "resolve" | "release" | "invoke" | "search_history" | "load_history" | "research_subagent";
  token?: string;
  bindingId?: string;
  wireName?: string;
  freeform?: boolean;
  arguments?: Record<string, unknown>;
  input?: string;
  query?: string;
  limit?: number;
  indexes?: number[];
  question?: string;
}

interface BrokerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

const brokers = new Map<string, TurnBroker>();
const MAX_BROKER_LINE_CHARS = 67_108_864;
const MAX_RETIRED_TURN_HANDLES = 64;

export async function closeTurnBrokers(): Promise<void> {
  const active = [...brokers.values()];
  const results = await Promise.allSettled(active.map(broker => broker.close()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} ChatGPT turn broker(s) failed to close`);
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function retiredTurnLabel(traceId: string): string {
  return traceId && traceId !== "unknown" ? `Codex turn ${traceId}` : "a Codex turn";
}

function environmentIdentity(environment: ChatGptTurnEnvironment): string {
  return JSON.stringify({
    cwd: environment.cwd,
    roots: environment.roots,
    writableRoots: environment.writableRoots,
    sandboxPolicy: environment.sandboxPolicy,
  });
}

export class TurnBroker {
  static forSocket(path: string): TurnBroker {
    let broker = brokers.get(path);
    if (!broker) {
      broker = new TurnBroker(path);
      brokers.set(path, broker);
    }
    return broker;
  }

  private readonly channels = new Map<string, TurnChannel>();
  private readonly pending = new Map<string, TurnChannel>();
  private readonly bindings = new Map<string, { token: string; channel: TurnChannel }>();
  // The Codex context replayed into ChatGPT still carries the handles of finished turns, so a model
  // can present one. Remembering which turn retired a handle is what separates "you are holding a
  // previous turn's handle" from "this handle never existed".
  private readonly retiredBindings = new Map<string, string>();
  private readonly retiredTokens = new Map<string, string>();
  private server?: Server;
  private startPromise?: Promise<void>;

  private constructor(readonly socketPath: string) {}

  /**
   * A ChatGPT turn outlives the request that started it, and its Codex Native calls arrive from a
   * separate MCP process. Creating the socket only once a turn registers leaves that process
   * connecting to a path that does not exist yet, so an in-flight turn reports a filesystem error
   * instead of the broker's own answer. The endpoint belongs to the runtime's lifetime.
   */
  async listen(): Promise<void> {
    await this.start();
  }

  async register(
    environment: ChatGptTurnEnvironment,
    ttlMs?: number,
    traceId = "unknown",
  ): Promise<string> {
    await this.start();
    this.prune();
    if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new Error("ChatGPT web turn broker TTL must be a positive finite number");
    }
    const token = opaqueId("turn");
    const channel: TurnChannel = {
      traceId,
      environment: {
        ...environment,
        ...(ttlMs !== undefined ? { expiresAt: Date.now() + ttlMs } : {}),
      },
      queuedCallIds: [],
      invocations: new Map(),
      waiters: new Set(),
      researchSubagentCalls: 0,
    };
    this.channels.set(token, channel);
    this.pending.set(token, channel);
    return token;
  }

  updateEnvironment(token: string, environment: ChatGptTurnEnvironment): void {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (environmentIdentity(channel.environment) !== environmentIdentity(environment)) {
      throw new Error("Codex turn environment changed during an active ChatGPT tool loop");
    }
    channel.environment = {
      ...environment,
      ...(channel.environment.expiresAt !== undefined
        ? { expiresAt: channel.environment.expiresAt }
        : {}),
    };
  }

  async nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]> {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    const ready = this.takeQueued(channel);
    if (ready.length > 0) return ready;
    if (signal?.aborted) throw new DOMException("tool wait aborted", "AbortError");
    return new Promise<BrokerToolRequest[]>((resolveWait, rejectWait) => {
      const waiter: ToolWaiter = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          channel.waiters.delete(waiter);
          rejectWait(new DOMException("tool wait aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      channel.waiters.add(waiter);
    });
  }

  completeTool(token: string, callId: string, result: BrokerToolResult): void {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    const invocation = channel.invocations.get(callId);
    if (!invocation) throw new Error(`tool call is not pending: ${callId}`);
    if (channel.queuedCallIds.includes(callId)) throw new Error(`tool call was completed before it was delivered: ${callId}`);
    channel.invocations.delete(callId);
    console.info(`[chatgpt-web] broker trace=${channel.traceId} completed call=${callId.slice(0, 17)} pending=${channel.invocations.size}`);
    invocation.resolve(result);
  }

  /**
   * Store the verbatim messages that Luna slimming collapsed this turn so the browser model can
   * recall them read-only through the reserved history wire names. Fail-soft: a store larger than
   * the byte cap is skipped and the turn proceeds without recall. Idempotent-guarded: a channel
   * cannot be re-attached.
   */
  attachCollapsedHistory(token: string, messages: RemovedHistoryMessage[]): void {
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.collapsedHistory) throw new Error("Collapsed history is already attached for this turn");
    if (messages.length === 0) return;
    const bytes = messages.reduce((total, message) => total + Buffer.byteLength(message.text, "utf8"), 0);
    if (bytes > COLLAPSED_HISTORY_STORE_BYTE_CAP) {
      console.warn(
        `[chatgpt-web] collapsed history (${bytes.toLocaleString("en-US")} bytes) exceeds the`
        + ` ${COLLAPSED_HISTORY_STORE_BYTE_CAP.toLocaleString("en-US")}-byte recall cap; recall disabled for this turn`,
      );
      return;
    }
    channel.collapsedHistory = messages;
  }

  /**
   * Let this turn answer scoped research questions in their own Temporary Chats. Optional by
   * design: a turn without a runner attached simply refuses the wire name, which is what the
   * feature flag being off looks like from the model's side.
   */
  attachResearchSubagent(token: string, runner: ResearchSubagentRunner): void {
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.researchSubagent) throw new Error("A research subagent is already attached for this turn");
    channel.researchSubagent = runner;
  }

  finalize(token: string): void {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    channel.finalized = true;
  }

  revoke(token: string): void {
    const channel = this.channels.get(token);
    if (!channel) return;
    this.channels.delete(token);
    this.pending.delete(token);
    if (channel.bindingId) {
      this.bindings.delete(channel.bindingId);
      this.retire(this.retiredBindings, channel.bindingId, channel.traceId);
    }
    this.retire(this.retiredTokens, token, channel.traceId);
    channel.collapsedHistory = undefined;
    channel.researchSubagent = undefined;
    this.rejectChannel(channel, new Error("Codex turn binding was revoked"));
  }

  private retire(history: Map<string, string>, handle: string, traceId: string): void {
    history.delete(handle);
    history.set(handle, traceId);
    while (history.size > MAX_RETIRED_TURN_HANDLES) {
      const oldest = history.keys().next();
      if (oldest.done) return;
      history.delete(oldest.value);
    }
  }

  async close(): Promise<void> {
    for (const token of [...this.channels.keys()]) this.revoke(token);
    const server = this.server;
    this.server = undefined;
    this.startPromise = undefined;
    brokers.delete(this.socketPath);
    if (server?.listening) {
      await new Promise<void>((resolveClose, rejectClose) => server.close(error => {
        if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") resolveClose();
        else rejectClose(error);
      }));
    }
    if (!isWindowsPipeEndpoint(this.socketPath)
      && existsSync(this.socketPath)
      && lstatSync(this.socketPath).isSocket()) unlinkSync(this.socketPath);
  }

  private start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolveStart, rejectStart) => {
      const windowsPipe = isWindowsPipeEndpoint(this.socketPath);
      if (!windowsPipe) mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
      const listen = () => {
        const server = createServer(socket => this.handleSocket(socket));
        this.server = server;
        server.once("error", rejectStart);
        server.on("error", error => {
          console.error(
            `[chatgpt-web] turn broker server error at ${this.socketPath}: ${errorOf(error).message}`,
          );
        });
        server.listen(this.socketPath, () => {
          server.off("error", rejectStart);
          if (!windowsPipe) chmodSync(this.socketPath, 0o600);
          resolveStart();
        });
      };

      if (windowsPipe) {
        listen();
        return;
      }
      if (!existsSync(this.socketPath)) {
        listen();
        return;
      }
      if (!lstatSync(this.socketPath).isSocket()) {
        rejectStart(new Error(`ChatGPT web broker path exists and is not a socket: ${this.socketPath}`));
        return;
      }
      const socketStat = lstatSync(this.socketPath);
      const getuid = process.getuid;
      if (typeof getuid === "function" && socketStat.uid !== getuid()) {
        rejectStart(new Error(`ChatGPT web broker socket is not owned by the current user: ${this.socketPath}`));
        return;
      }
      if ((socketStat.mode & 0o077) !== 0) {
        rejectStart(new Error(`ChatGPT web broker socket has unsafe permissions: ${this.socketPath}`));
        return;
      }
      const probe = createConnection(this.socketPath);
      let probeSettled = false;
      const finishProbe = (action: () => void) => {
        if (probeSettled) return;
        probeSettled = true;
        probe.destroy();
        action();
      };
      probe.setTimeout(2_000, () => finishProbe(() => {
        rejectStart(new Error(`Timed out while checking existing ChatGPT web broker socket: ${this.socketPath}`));
      }));
      probe.once("connect", () => {
        finishProbe(() => {
          rejectStart(new Error(`ChatGPT web broker socket is already owned by another process: ${this.socketPath}`));
        });
      });
      probe.once("error", error => {
        finishProbe(() => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ECONNREFUSED" && code !== "ENOENT") {
            rejectStart(new Error(
              `Could not verify existing ChatGPT web broker socket ${this.socketPath}: ${error.message}`,
            ));
            return;
          }
          try {
            if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
            listen();
          } catch (cleanupError) {
            rejectStart(errorOf(cleanupError));
          }
        });
      });
    });
    return this.startPromise;
  }

  private handleSocket(socket: Socket): void {
    let buffered = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", chunk => {
      if (handled) return;
      buffered += chunk;
      if (buffered.length > MAX_BROKER_LINE_CHARS && !buffered.slice(0, MAX_BROKER_LINE_CHARS + 1).includes("\n")) {
        handled = true;
        this.writeSocketResponse(socket, { id: "unknown", error: "turn broker request exceeds size limit" });
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const line = buffered.slice(0, newline);
      let request: BrokerRequest | undefined;
      try {
        if (line.length > MAX_BROKER_LINE_CHARS) throw new Error("turn broker request exceeds size limit");
        request = JSON.parse(line) as BrokerRequest;
        this.validateRequest(request);
      } catch (error) {
        this.writeSocketResponse(socket, { id: request?.id ?? "unknown", error: errorOf(error).message });
        return;
      }
      void Promise.resolve().then(() => this.dispatch(request!)).then(
        result => this.writeSocketResponse(socket, { id: request!.id, result }),
        error => this.writeSocketResponse(socket, { id: request!.id, error: errorOf(error).message }),
      );
    });
  }

  private writeSocketResponse(socket: Socket, response: BrokerResponse): void {
    const line = `${JSON.stringify(response)}\n`;
    if (line.length > MAX_BROKER_LINE_CHARS) {
      socket.end(`${JSON.stringify({ id: response.id, error: "turn broker response exceeds size limit" } satisfies BrokerResponse)}\n`);
      return;
    }
    socket.end(line);
  }

  private validateRequest(request: BrokerRequest): void {
    if (!request || typeof request !== "object" || typeof request.id !== "string" || request.id.length === 0 || request.id.length > 256) {
      throw new Error("turn broker request id is invalid");
    }
    if (request.method !== "claim"
      && request.method !== "resolve"
      && request.method !== "release"
      && request.method !== "invoke"
      && request.method !== "search_history"
      && request.method !== "load_history"
      && request.method !== "research_subagent") {
      throw new Error("turn broker method is invalid");
    }
  }

  /**
   * Answer one scoped research question in its own chat, or say why not.
   *
   * Everything here returns a value rather than throwing: this result becomes a tool result the
   * model reads and reasons about, and a sub-chat that could not answer must never be able to fail
   * the turn that asked for it. The per-turn cap counts attempts, not successes — a failed sub-chat
   * has already spent a message on the account.
   */
  private async runResearchSubagent(channel: TurnChannel, question: unknown): Promise<ResearchSubagentOutcome> {
    const runner = channel.researchSubagent;
    if (!runner) {
      return { ok: false, error: "Research sub-turns are not enabled for this turn." };
    }
    let accepted: string;
    try {
      // Before the reservation: a question that was never sent must not cost an attempt.
      accepted = assertResearchQuestionAcceptable(question);
    } catch (error) {
      return { ok: false, error: describeResearchSubagentFailure(error) };
    }
    if (channel.researchSubagentCalls >= RESEARCH_SUBAGENT_MAX_CALLS_PER_TURN) {
      return {
        ok: false,
        error: `This turn has already used its ${RESEARCH_SUBAGENT_MAX_CALLS_PER_TURN} research sub-turns; answer with what you have.`,
      };
    }
    // Reserve synchronously so parallel calls in one model response cannot all pass the check, then
    // release again if nothing was actually spent.
    channel.researchSubagentCalls += 1;
    const attempt = channel.researchSubagentCalls;
    console.info(
      `[chatgpt-web] broker trace=${channel.traceId} research sub-turn ${attempt}/${RESEARCH_SUBAGENT_MAX_CALLS_PER_TURN} requested (questionChars=${accepted.length})`,
    );
    try {
      const { answer, truncated } = await runner(accepted);
      console.info(
        `[chatgpt-web] broker trace=${channel.traceId} research sub-turn ${attempt} answered (chars=${answer.length})`,
      );
      return { ok: true, answer, truncated, note: RESEARCH_SUBAGENT_RESULT_NOTE };
    } catch (error) {
      // A refusal from the queue never opened a chat, so it costs nothing. Anything else may have
      // sent a message before failing, and the account was charged for it either way.
      if (error instanceof ResearchSubagentBusyError) channel.researchSubagentCalls -= 1;
      const described = describeResearchSubagentFailure(error);
      console.info(
        `[chatgpt-web] broker trace=${channel.traceId} research sub-turn ${attempt} failed: ${described}`,
      );
      return { ok: false, error: described };
    }
  }

  private searchCollapsedHistory(history: RemovedHistoryMessage[], query: unknown, limit: unknown): { matches: CollapsedHistorySearchMatch[] } {
    if (typeof query !== "string") throw new Error("history search requires a string query");
    const needle = query.trim();
    if (needle.length < HISTORY_SEARCH_QUERY_MIN_CHARS || needle.length > HISTORY_SEARCH_QUERY_MAX_CHARS) {
      throw new Error(`history search query must be ${HISTORY_SEARCH_QUERY_MIN_CHARS}..${HISTORY_SEARCH_QUERY_MAX_CHARS} characters`);
    }
    let cap = HISTORY_SEARCH_LIMIT_DEFAULT;
    if (limit !== undefined) {
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > HISTORY_SEARCH_LIMIT_MAX) {
        throw new Error(`history search limit must be an integer 1..${HISTORY_SEARCH_LIMIT_MAX}`);
      }
      cap = limit;
    }
    const lowered = needle.toLowerCase();
    const matches: CollapsedHistorySearchMatch[] = [];
    for (const message of history) {
      if (matches.length >= cap) break;
      const at = message.text.toLowerCase().indexOf(lowered);
      if (at < 0) continue;
      const start = Math.max(0, at - HISTORY_SEARCH_SNIPPET_RADIUS);
      const end = Math.min(message.text.length, at + lowered.length + HISTORY_SEARCH_SNIPPET_RADIUS);
      const snippet = (start > 0 ? "…" : "") + message.text.slice(start, end) + (end < message.text.length ? "…" : "");
      matches.push({ index: message.index, role: message.role, snippet, chars: message.text.length });
    }
    return { matches };
  }

  private loadCollapsedHistory(history: RemovedHistoryMessage[], indexes: unknown): { messages: RemovedHistoryMessage[]; truncated: boolean } {
    if (!Array.isArray(indexes) || indexes.length === 0) throw new Error("history load requires a non-empty indexes array");
    if (indexes.length > HISTORY_LOAD_MAX_INDEXES) throw new Error(`history load accepts at most ${HISTORY_LOAD_MAX_INDEXES} indexes per call`);
    const messages: RemovedHistoryMessage[] = [];
    let used = 0;
    let truncated = false;
    for (const raw of indexes) {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= history.length) {
        throw new Error(`history index ${String(raw)} is out of range for this turn`);
      }
      const source = history[raw]!;
      const remaining = HISTORY_LOAD_RESPONSE_CHAR_CAP - used;
      if (remaining <= 0) { truncated = true; break; }
      const text = source.text.length > remaining ? source.text.slice(0, remaining) : source.text;
      if (text.length < source.text.length) truncated = true;
      used += text.length;
      messages.push({ index: source.index, role: source.role, text });
    }
    return { messages, truncated };
  }

  private dispatch(request: BrokerRequest): unknown | Promise<unknown> {
    this.prune();
    if (request.method === "claim") {
      const token = request.token;
      if (typeof token !== "string" || token.length === 0) throw new Error("turn token is required");
      const channel = this.channels.get(token);
      const retiredTurn = channel ? undefined : this.retiredTokens.get(token);
      console.error(
        `[chatgpt-web] broker claim received (tokenChars=${token.length}, valid=${Boolean(channel)}`
        + `${channel ? "" : `, retiredTurn=${retiredTurn ?? "unknown"}`})`,
      );
      if (!channel) {
        throw new Error(retiredTurn !== undefined
          ? `This turn_token was issued for ${retiredTurnLabel(retiredTurn)}, which has already finished.`
          + " This Codex Native action can no longer run."
          : "turn token is invalid, expired, or revoked");
      }
      if (channel.finalized) throw new Error("Codex turn is already finalized");
      if (channel.bindingId) {
        const existing = this.bindings.get(channel.bindingId);
        if (!existing || existing.token !== token || existing.channel !== channel) {
          throw new Error("turn token binding state is inconsistent");
        }
        return {
          bindingId: channel.bindingId,
          environment: channel.environment,
        };
      }
      this.pending.delete(token);
      const bindingId = opaqueId("binding");
      channel.bindingId = bindingId;
      this.bindings.set(bindingId, { token, channel });
      return {
        bindingId,
        environment: channel.environment,
      };
    }

    const bindingId = request.bindingId;
    if (typeof bindingId !== "string" || bindingId.length === 0) throw new Error("binding id is required");
    const binding = this.bindings.get(bindingId);
    if (!binding) {
      const retiredTurn = this.retiredBindings.get(bindingId);
      console.error(
        `[chatgpt-web] broker rejected ${request.method} (binding=${bindingId.slice(0, 17)},`
        + ` retiredTurn=${retiredTurn ?? "unknown"})`,
      );
      throw new Error(retiredTurn !== undefined
        ? `${retiredTurnLabel(retiredTurn)} has already finished; this Codex Native action can no longer run.`
        : "internal Codex turn binding is invalid or expired");
    }
    if (request.method === "release") {
      this.revoke(binding.token);
      return { released: true };
    }
    if (request.method === "resolve") return { environment: binding.channel.environment };

    if (request.method === "research_subagent") {
      if (binding.channel.finalized) throw new Error("Codex turn is already finalized");
      // dispatch is sync-or-promise by design; the caller awaits, so the sub-turn's minutes of work
      // do not block any other broker request.
      return this.runResearchSubagent(binding.channel, request.question);
    }

    if (request.method === "search_history" || request.method === "load_history") {
      if (binding.channel.finalized) throw new Error("Codex turn is already finalized");
      const history = binding.channel.collapsedHistory;
      if (!history || history.length === 0) throw new Error("This Codex turn has no collapsed history to recall");
      if (request.method === "search_history") {
        const found = this.searchCollapsedHistory(history, request.query, request.limit);
        console.info(
          `[chatgpt-web] broker trace=${binding.channel.traceId} history search matches=${found.matches.length}/${history.length}`,
        );
        return found;
      }
      const loaded = this.loadCollapsedHistory(history, request.indexes);
      console.info(
        `[chatgpt-web] broker trace=${binding.channel.traceId} history load indexes=${(request.indexes ?? []).length} truncated=${loaded.truncated}`,
      );
      return loaded;
    }

    const wireName = request.wireName?.trim();
    if (!wireName) throw new Error("wire tool name is required");
    if (binding.channel.finalized) throw new Error("Codex turn is already finalized");
    const callId = opaqueId("call");
    const toolRequest: BrokerToolRequest = {
      callId,
      wireName,
      freeform: request.freeform === true,
      ...(request.freeform === true ? { input: request.input ?? "" } : { arguments: request.arguments ?? {} }),
    };
    return new Promise<BrokerToolResult>((resolveInvoke, rejectInvoke) => {
      binding.channel.invocations.set(callId, { request: toolRequest, resolve: resolveInvoke, reject: rejectInvoke });
      binding.channel.queuedCallIds.push(callId);
      console.info(
        `[chatgpt-web] broker trace=${binding.channel.traceId} queued call=${callId.slice(0, 17)} tool=${wireName} waiters=${binding.channel.waiters.size}`,
      );
      this.scheduleToolWaiters(binding.channel);
    });
  }

  private takeQueued(channel: TurnChannel): BrokerToolRequest[] {
    const ids = channel.queuedCallIds.splice(0);
    return ids.map(id => channel.invocations.get(id)?.request).filter((request): request is BrokerToolRequest => Boolean(request));
  }

  private scheduleToolWaiters(channel: TurnChannel): void {
    if (channel.queuedCallIds.length === 0 || channel.waiters.size === 0) return;
    if (channel.batchTimer) return;
    channel.batchTimer = setTimeout(() => {
      channel.batchTimer = undefined;
      this.wakeToolWaiters(channel);
    }, 15);
  }

  private wakeToolWaiters(channel: TurnChannel): void {
    if (channel.queuedCallIds.length === 0 || channel.waiters.size === 0) return;
    const batch = this.takeQueued(channel);
    console.info(
      `[chatgpt-web] broker trace=${channel.traceId} delivered calls=${batch.length} tools=${batch.map(request => request.wireName).join(",")}`,
    );
    const waiters = [...channel.waiters];
    channel.waiters.clear();
    const first = waiters.shift();
    if (first) {
      if (first.signal && first.onAbort) first.signal.removeEventListener("abort", first.onAbort);
      first.resolve(batch);
    }
    for (const waiter of waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new Error("another adapter waiter already claimed the queued tool batch"));
    }
  }

  private rejectChannel(channel: TurnChannel, error: Error): void {
    if (channel.batchTimer) clearTimeout(channel.batchTimer);
    channel.batchTimer = undefined;
    for (const waiter of channel.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(error);
    }
    channel.waiters.clear();
    for (const invocation of channel.invocations.values()) invocation.reject(error);
    channel.invocations.clear();
    channel.queuedCallIds = [];
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, channel] of this.channels) {
      if (channel.environment.expiresAt === undefined || channel.environment.expiresAt > now) continue;
      this.revoke(token);
    }
  }
}

/**
 * A turn registered without a TTL has no deadline to bound its tool calls against, so a null
 * timeout waits for as long as the turn itself lives. Undefined keeps the bounded default, because
 * a caller that cannot compute a deadline must not silently inherit an unbounded wait. An
 * unbounded call still ends when the turn is revoked or the broker drops the connection.
 */
export async function callTurnBroker<T>(
  socketPath: string,
  request: Omit<BrokerRequest, "id">,
  timeoutMs: number | null = 5_000,
): Promise<T> {
  const id = opaqueId("request");
  return new Promise<T>((resolveCall, rejectCall) => {
    const socket = createConnection(socketPath);
    let buffered = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      rejectCall(error);
    };
    const timer = timeoutMs === null
      ? undefined
      : setTimeout(() => finishError(new Error("ChatGPT web turn broker timed out")), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("error", error => finishError(new Error(`ChatGPT web turn broker unavailable: ${error.message}`)));
    socket.once("close", () => finishError(new Error("ChatGPT web turn broker closed the connection")));
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, ...request })}\n`));
    socket.on("data", chunk => {
      if (settled) return;
      buffered += chunk;
      if (buffered.length > MAX_BROKER_LINE_CHARS) {
        finishError(new Error("ChatGPT web turn broker response exceeds size limit"));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      let response: BrokerResponse;
      try {
        response = JSON.parse(buffered.slice(0, newline)) as BrokerResponse;
      } catch (error) {
        finishError(new Error(`ChatGPT web turn broker returned invalid JSON: ${errorOf(error).message}`));
        return;
      }
      if (response.id !== id) {
        finishError(new Error("ChatGPT web turn broker response id mismatch"));
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.end();
      if (response.error) rejectCall(new Error(response.error));
      else resolveCall(response.result as T);
    });
  });
}
