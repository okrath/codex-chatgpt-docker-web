import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { defaultBrokerEndpoint, expandUserPath, resolveBrokerEndpoint } from "../../config";
import { namespacedToolName, type AdapterEvent, type CodexContentPart, type CodexParsedRequest, type CodexProviderConfig, type CodexToolResultMessage, type CodexUsage } from "../../types";
import type { ProviderAdapter } from "../base";
import { parseDataUrl } from "../image";
import { ChatGptWebAdapterError } from "./adapter-error";
import { ChatGptBrowserWorker } from "./browser-worker";
import { extractChatGptTurnEnvironment, extractChatGptTurnIdentity } from "./environment";
import { CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET } from "./input-tokens";
import {
  compileLunaBudgetedPrompt,
  describeLunaOverflowSuggestions,
  describeLunaSlimming,
} from "./luna-context-slimming";
import { CHATGPT_WEB_LUNA_MODEL_ID, resolveChatGptWebModelMode, type ChatGptWebCapabilities } from "./model";
import {
  chatGptReadOnlyContextWarning,
  withoutSupersededModelSwitchContracts,
  type CompileChatGptWebPromptOptions,
  type CompiledChatGptWebPrompt,
} from "./prompt";
import { TurnBroker, type BrokerToolRequest, type BrokerToolResult } from "./turn-broker";
import { ChatGptTextFeed, ChatGptTraceFeed, chatGptCompactionSourceExecutionKey, chatGptTurnExecutionKey, chatGptTurnSessions, type ChatGptBrowserOutcome, type ChatGptTraceEvent, type ChatGptTurnRuntime, type ChatGptTurnSession } from "./turn-execution";
import { estimateChatGptWebInputTokens, estimateChatGptWebUsage } from "./usage";
import { ChatGptThreadEnvironmentStore } from "./thread-environment";
import type { RemovedHistoryMessage } from "./history-recall";
import {
  ChatGptLunaCheckpointStore,
  type CapturedChatGptLunaCheckpoint,
} from "./rolling-checkpoint";

function brokerSocketPath(provider: CodexProviderConfig): string {
  const configured = provider.chatgptWeb?.brokerSocketPath?.trim();
  return resolveBrokerEndpoint(configured || defaultBrokerEndpoint());
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function abortError(): DOMException {
  return new DOMException("ChatGPT web turn aborted", "AbortError");
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolveWait, rejectWait) => {
    const onAbort = () => rejectWait(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolveWait(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        rejectWait(error);
      },
    );
  });
}

function structuredContent(text: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function brokerContent(content: string | CodexContentPart[]): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text };
    const parsed = parseDataUrl(part.imageUrl);
    if (parsed) return { type: "image", data: parsed.base64, mimeType: parsed.mediaType };
    return { type: "resource_link", uri: part.imageUrl, name: "Codex tool image", mimeType: "image/*" };
  });
}

function brokerResult(message: CodexToolResultMessage): BrokerToolResult {
  const content = brokerContent(message.content);
  const text = typeof message.content === "string"
    ? message.content
    : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const structured = structuredContent(text);
  return {
    content,
    ...(structured !== undefined ? { structuredContent: structured } : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}

function emitToolBatch(requests: BrokerToolRequest[], usage: CodexUsage, emit: (event: AdapterEvent) => void): void {
  for (const request of requests) {
    emit({ type: "tool_call_start", id: request.callId, name: request.wireName });
    emit({
      type: "tool_call_delta",
      arguments: request.freeform
        ? JSON.stringify({ input: request.input ?? "" })
        : JSON.stringify(request.arguments ?? {}),
    });
    emit({ type: "tool_call_end" });
  }
  emit({ type: "done", stopReason: "tool_use", endTurn: false, usage });
}

function emitBrowserCompletion(outcome: ChatGptBrowserOutcome, usage: CodexUsage, emit: (event: AdapterEvent) => void): void {
  if (outcome.type === "error") throw outcome.error;
  emit({ type: "done", stopReason: "stop", endTurn: true, usage });
}

function emitTraceEvents(trace: ChatGptTraceEvent[], emit: (event: AdapterEvent) => void): void {
  for (const event of trace) {
    if (!event.continuation) emit({ type: "assistant_boundary" });
    if (event.kind === "commentary") {
      emit({ type: "text_delta", text: event.text, phase: "commentary" });
    } else {
      emit({ type: "thinking_delta", thinking: event.text });
    }
  }
}

function emitTextDeltas(deltas: string[], emit: (event: AdapterEvent) => void): void {
  for (const text of deltas) emit({ type: "text_delta", text, phase: "final_answer" });
}

function emitProContextWarning(
  parsed: CodexParsedRequest,
  capabilities: ChatGptWebCapabilities,
  emit: (event: AdapterEvent) => void,
): void {
  const warning = chatGptReadOnlyContextWarning(parsed, capabilities);
  if (!warning) return;
  emit({ type: "assistant_boundary" });
  emit({ type: "text_delta", text: warning, phase: "commentary" });
  emit({ type: "assistant_boundary" });
}

function replayEvents(events: AdapterEvent[], emit: (event: AdapterEvent) => void): void {
  for (const event of events) emit(event);
}

function currentToolResults(parsed: CodexParsedRequest, session: ChatGptTurnSession): CodexToolResultMessage[] {
  const byId = new Map<string, CodexToolResultMessage>();
  for (const message of parsed.context.messages) {
    if (message.role !== "toolResult" || !session.hasOutstanding(message.toolCallId)) continue;
    if (byId.has(message.toolCallId)) throw new Error(`Codex returned duplicate results for tool call ${message.toolCallId}`);
    byId.set(message.toolCallId, message);
  }
  return [...byId.values()];
}

function validateBatchTools(parsed: CodexParsedRequest, requests: BrokerToolRequest[]): void {
  const available = new Set((parsed.context.tools ?? []).map(tool => namespacedToolName(tool.namespace, tool.name)));
  for (const request of requests) {
    if (!available.has(request.wireName)) {
      throw new Error(`ChatGPT requested a tool that the active Codex round did not advertise: ${request.wireName}`);
    }
  }
}

// Module-level (not per-adapter): the server builds a fresh adapter for every HTTP request, so
// state that must survive a turn's retry — like which turns had a preload delivery failure — has to
// live here, the same lifetime as the shared turn-session registry.
const preloadDisabledTurns = new Set<string>();

export function createChatGptWebAdapter(provider: CodexProviderConfig): ProviderAdapter {
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const broker = TurnBroker.forSocket(brokerSocketPath(provider));
  const timeoutMs = provider.chatgptWeb?.turnTimeoutMs;
  const configuredCapabilities: ChatGptWebCapabilities = {
    localToolsEnabled: provider.chatgptWeb?.localToolsEnabled === true,
    solAvailable: provider.chatgptWeb?.solAvailable !== false,
    proAvailable: provider.chatgptWeb?.proAvailable === true,
  };
  const executionNamespace = createHash("sha256").update(JSON.stringify({
    baseUrl: provider.baseUrl,
    chatgptWeb: provider.chatgptWeb ?? {},
  })).digest("hex");
  const environmentStore = new ChatGptThreadEnvironmentStore(
    provider.chatgptWeb?.threadEnvironmentStatePath
      ? resolve(expandUserPath(provider.chatgptWeb.threadEnvironmentStatePath))
      : undefined,
  );
  const lunaCheckpointStore = new ChatGptLunaCheckpointStore(
    provider.chatgptWeb?.lunaCheckpointStatePath
      ? resolve(expandUserPath(provider.chatgptWeb.lunaCheckpointStatePath))
      : undefined,
  );
  const startRuntime = (
    parsed: CodexParsedRequest,
    environment: ReturnType<typeof extractChatGptTurnEnvironment> | undefined,
    traceId: string,
    turnCapabilities: ChatGptWebCapabilities,
    disablePreload: boolean,
  ): ChatGptTurnRuntime => {
    const mode = resolveChatGptWebModelMode(parsed.modelId, parsed.options.reasoning, turnCapabilities);
    const identity = extractChatGptTurnIdentity(parsed);
    const captureLunaCheckpoint = parsed.modelId === CHATGPT_WEB_LUNA_MODEL_ID
      && !parsed._compactionRequest
      && Boolean(identity.threadId && identity.turnId);
    // Full mode can serve the raw history the checkpoint replaces back through the broker, so the
    // checkpoint context advertises the recall tools and we stash that span for the turn.
    const checkpointApplyOptions = { advertiseHistoryRecall: mode.localTools };
    const checkpointInput = captureLunaCheckpoint
      ? lunaCheckpointStore.apply(parsed, checkpointApplyOptions)
      : { parsed, applied: false, replacedHistory: undefined as RemovedHistoryMessage[] | undefined };
    const checkpointReplacedHistory = checkpointInput.replacedHistory ?? [];
    if (captureLunaCheckpoint) {
      console.info(
        `[chatgpt-web] Luna rolling checkpoint applied=${checkpointInput.applied}`
        + `${checkpointInput.applied ? ` replacedHistory=${checkpointReplacedHistory.length}` : ""}`
        + `${checkpointInput.reason ? ` reason=${checkpointInput.reason}` : ""}`,
      );
    }
    const canonicalToolInput = mode.localTools
      ? {
        ...checkpointInput.parsed,
        context: {
          ...checkpointInput.parsed.context,
          messages: withoutSupersededModelSwitchContracts(checkpointInput.parsed.context.messages),
        },
      }
      : checkpointInput.parsed;
    const promptInput = canonicalToolInput;
    const promptOptions: CompileChatGptWebPromptOptions = {
      captureLunaCheckpoint,
      ...(disablePreload ? { disablePreload: true } : {}),
    };
    let compiledPromptTokens: number | undefined;
    const compiledPromptInputTokens = (): number => {
      compiledPromptTokens ??= estimateChatGptWebInputTokens(promptInput, turnCapabilities, promptOptions);
      return compiledPromptTokens;
    };
    /**
     * Each round re-estimates from the request Codex just sent so a steered round reports its own
     * prompt size. A usage number must never fail the turn: when a later round no longer reproduces
     * the message positions this turn validated, report the compiled first-round prompt instead of
     * throwing out of the completion path.
     */
    const inputTokensFor = (currentParsed: CodexParsedRequest): number => {
      try {
        const currentCheckpointInput = captureLunaCheckpoint
          ? lunaCheckpointStore.apply(currentParsed, checkpointApplyOptions).parsed
          : currentParsed;
        const currentCanonicalInput = mode.localTools
          ? {
            ...currentCheckpointInput,
            context: {
              ...currentCheckpointInput.context,
              messages: withoutSupersededModelSwitchContracts(currentCheckpointInput.context.messages),
            },
          }
          : currentCheckpointInput;
        return estimateChatGptWebInputTokens(currentCanonicalInput, turnCapabilities, promptOptions);
      } catch (error) {
        console.warn(
          "[chatgpt-web] input token estimate fell back to the compiled turn prompt: "
          + (error instanceof Error ? error.message : String(error)),
        );
        return compiledPromptInputTokens();
      }
    };
    let capturedCheckpoint: CapturedChatGptLunaCheckpoint | undefined;
    let checkpointCaptureError: Error | undefined;
    const captureCheckpoint = (captured: CapturedChatGptLunaCheckpoint): void => {
      if (capturedCheckpoint) {
        checkpointCaptureError = new Error("ChatGPT Luna emitted more than one rolling checkpoint");
        return;
      }
      capturedCheckpoint = captured;
    };
    const finalizeCheckpoint = (browser: Promise<string>): Promise<string> => browser.then(answer => {
      if (!captureLunaCheckpoint) return answer;
      if (checkpointCaptureError) throw checkpointCaptureError;
      if (!capturedCheckpoint) throw new Error("ChatGPT Luna completed without a captured rolling checkpoint");
      lunaCheckpointStore.commit(parsed, capturedCheckpoint, answer);
      return answer;
    });
    const browserAbort = new AbortController();
    const trace = new ChatGptTraceFeed();
    const text = new ChatGptTextFeed();
    /**
     * A Luna (ChatGPT Free) turn always sheds the harness-only rule sections;
     * an over-budget turn then escalates through rule condensation, older
     * tool-result trimming, and history elision (see luna-context-slimming).
     * The visible trace narrates the slimming only when the turn would
     * otherwise have overflowed; routine strips are logged to the daemon
     * console instead. Applies to both read-only and tool-capable turns.
     */
    let lastBudgetedCompilation: ReturnType<typeof compileLunaBudgetedPrompt> | undefined;
    const compilePromptWithLunaBudget = (turnToken?: string): CompiledChatGptWebPrompt => {
      const result = compileLunaBudgetedPrompt(
        promptInput,
        turnCapabilities,
        turnToken,
        promptOptions,
      );
      lastBudgetedCompilation = result;
      if (result.preloadParts > 0) {
        const preloadSummary = `📨 Luna preload split this over-budget turn into ${result.preloadParts} earlier-context part(s)`
          + ` plus the final task message (~${result.estimatedTokens.toLocaleString("en-US")} tokens total).`;
        console.info(`[chatgpt-web] ${preloadSummary}`);
        trace.push({ kind: "commentary", text: preloadSummary });
      } else if (result.slimmed) {
        const summary = describeLunaSlimming(result, CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET);
        console.info(`[chatgpt-web] ${summary}`);
        if (result.beforeTokens > CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET) {
          trace.push({ kind: "commentary", text: summary });
        }
      }
      if (result.preloadParts === 0 && result.estimatedTokens > CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET) {
        const suggestions = describeLunaOverflowSuggestions(
          result.messages,
          result.estimatedTokens,
          CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET,
          parsed.modelId,
        );
        trace.push({ kind: "commentary", text: suggestions });
        console.error(`[chatgpt-web] ${suggestions}`);
      }
      return result.compiled;
    };
    if (!mode.localTools) {
      const browser = finalizeCheckpoint(worker.run({
        traceId,
        modelId: parsed.modelId,
        reasoning: parsed.options.reasoning,
        capabilities: turnCapabilities,
        prepare: async () => ({
          ...compilePromptWithLunaBudget(),
          release: () => {},
        }),
        abortSignal: browserAbort.signal,
        onReasoningSummary: (text, continuation) => trace.push({ kind: "reasoning", text, ...(continuation ? { continuation: true } : {}) }),
        onCommentary: (text, continuation) => trace.push({ kind: "commentary", text, ...(continuation ? { continuation: true } : {}) }),
        onTextDelta: delta => text.push(delta),
        ...(captureLunaCheckpoint ? {
          captureLunaCheckpoint: true,
          onLunaCheckpoint: captureCheckpoint,
        } : {}),
      }));
      return {
        mode: "read-only",
        browser,
        trace,
        text,
        inputTokensFor,
        cancel: () => browserAbort.abort(),
      };
    }
    if (!environment) throw new Error("Tool-capable ChatGPT web mode requires a trusted Codex environment");
    const token = deferred<string>();
    let tokenSettled = false;
    let activeToken: string | undefined;
    const browser = finalizeCheckpoint(worker.run({
      traceId,
      modelId: parsed.modelId,
      reasoning: parsed.options.reasoning,
      capabilities: turnCapabilities,
      prepare: async () => {
        const turnToken = await broker.register(
          environment,
          timeoutMs === undefined ? undefined : timeoutMs + 60_000,
          traceId,
        );
        activeToken = turnToken;
        tokenSettled = true;
        token.resolve(turnToken);
        try {
          const compiled = compilePromptWithLunaBudget(turnToken);
          // Fail-open recall: keep verbatim what the model can no longer see inline — the raw span
          // the rolling checkpoint replaced, plus anything Luna slimming collapsed. Checkpoint-apply
          // and history-collapse are mutually exclusive (collapse only fires when no checkpoint
          // applied), so concatenating and reindexing keeps the collapse marker's indexes aligned.
          const recallHistory = [...checkpointReplacedHistory, ...(lastBudgetedCompilation?.removedHistory ?? [])]
            .map((message, index) => ({ ...message, index }));
          if (recallHistory.length > 0) broker.attachCollapsedHistory(turnToken, recallHistory);
          return { ...compiled, release: () => {} };
        } catch (error) {
          broker.revoke(turnToken);
          throw error;
        }
      },
      abortSignal: browserAbort.signal,
      onReasoningSummary: (text, continuation) => trace.push({ kind: "reasoning", text, ...(continuation ? { continuation: true } : {}) }),
      onCommentary: (text, continuation) => trace.push({ kind: "commentary", text, ...(continuation ? { continuation: true } : {}) }),
      onTextDelta: delta => text.push(delta),
      ...(captureLunaCheckpoint ? {
        captureLunaCheckpoint: true,
        onLunaCheckpoint: captureCheckpoint,
      } : {}),
    }));
    void browser.catch(error => {
      if (!tokenSettled) {
        tokenSettled = true;
        token.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      mode: "tools",
      token: token.promise,
      browser,
      trace,
      text,
      inputTokensFor,
      cancel: () => {
        browserAbort.abort();
        if (activeToken) broker.revoke(activeToken);
      },
    };
  };

  const finalizeBrowserTurn = (turnToken: string): void => {
    broker.finalize(turnToken);
  };

  return {
    name: "chatgpt-web",
    async runTurn(parsed, incoming, emit) {
      if (parsed._opaqueMultiAgentV2Payload) {
        throw new Error(
          "ChatGPT Web subagents currently require a V1-rooted task. "
          + "Refresh the Codex model catalog and start a new task; an existing V2 task cannot migrate surfaces. "
          + "Codex MultiAgent V2 encrypts cross-backend task payloads.",
        );
      }
      const turnCapabilities = parsed._compactionRequest
        ? { ...configuredCapabilities, localToolsEnabled: false }
        : configuredCapabilities;
      const mode = resolveChatGptWebModelMode(parsed.modelId, parsed.options.reasoning, turnCapabilities);
      let environment: ReturnType<typeof extractChatGptTurnEnvironment> | undefined;
      if (mode.localTools) {
        try {
          environment = environmentStore.resolve(parsed);
        } catch (error) {
          const identity = extractChatGptTurnIdentity(parsed);
          console.warn(
            `[chatgpt-web] trusted environment unavailable (thread_id=${identity.threadId ? "present" : "missing"}, turn_id=${identity.turnId ? "present" : "missing"}, previous_response_id=${parsed.previousResponseId ?? "none"}, replay_prefix_items=${parsed._replayPrefixLen ?? 0}, context_messages=${parsed.context.messages.length})`,
          );
          throw error;
        }
      }
      if (parsed._compactionRequest) {
        const responseExecutionKey = `${executionNamespace}:${chatGptCompactionSourceExecutionKey(parsed)}`;
        await chatGptTurnSessions.retireAndWait(responseExecutionKey);
      }
      const executionKey = `${executionNamespace}:${chatGptTurnExecutionKey(parsed)}`;
      await chatGptTurnSessions.waitForRetirement(executionKey);
      const traceId = createHash("sha256").update(executionKey).digest("hex").slice(0, 12);
      const session = chatGptTurnSessions.getOrCreate(
        executionKey,
        () => startRuntime(parsed, environment, traceId, turnCapabilities, preloadDisabledTurns.has(executionKey)),
      );
      const heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000);
      try {
        emit({ type: "heartbeat" });
        await session.runExclusive(async () => {
          const settled = session.settledOutcome();
          if (settled) {
            if (settled.type === "error") throw settled.error;
            let reasoning = session.reasoningForFinalReplay();
            const replay = session.eventsForFinalReplay();
            if (session.hasFinalReplay()) {
              replayEvents(replay, emit);
            } else {
              if (session.runtime.mode === "tools") {
                const turnToken = await withAbort(session.runtime.token, incoming.abortSignal);
                finalizeBrowserTurn(turnToken);
                broker.revoke(turnToken);
              }
              const events: AdapterEvent[] = [];
              const emitCaptured = (event: AdapterEvent) => {
                events.push(event);
                emit(event);
              };
              if (!parsed._compactionRequest) emitProContextWarning(parsed, turnCapabilities, emitCaptured);
              const trace = session.runtime.trace.drain();
              reasoning = trace.map(event => event.text);
              emitTraceEvents(trace, emitCaptured);
              emitTextDeltas(session.runtime.text.drain(), emitCaptured);
              if (session.runtime.text.value() !== settled.answer) {
                throw new Error("ChatGPT browser Markdown stream did not reproduce the completed answer");
              }
              session.setFinalReasoning(reasoning);
              session.setFinalEvents(events);
            }
            emitBrowserCompletion(settled, estimateChatGptWebUsage(
              parsed,
              { answer: settled.answer, reasoning },
              turnCapabilities,
              session.runtime.inputTokensFor(parsed),
            ), emit);
            return;
          }

          let turnToken: string | undefined;
          if (session.runtime.mode === "tools") {
            turnToken = await withAbort(session.runtime.token, incoming.abortSignal);
            if (!environment) throw new Error("Tool-capable ChatGPT web runtime lost its trusted environment");
            broker.updateEnvironment(turnToken, environment);

            const outstanding = session.outstanding();
            if (outstanding.length > 0) {
              const results = currentToolResults(parsed, session);
              if (results.length === 0) {
                const reasoning = session.reasoningForOutstandingReplay();
                replayEvents(session.eventsForOutstandingReplay(), emit);
                emitToolBatch(
                  outstanding,
                  estimateChatGptWebUsage(
                    parsed,
                    { reasoning, toolRequests: outstanding },
                    turnCapabilities,
                    session.runtime.inputTokensFor(parsed),
                  ),
                  emit,
                );
                return;
              }
              if (results.length !== outstanding.length) {
                throw new Error(`Codex returned ${results.length} of ${outstanding.length} results for a parallel ChatGPT tool batch`);
              }
              for (const message of results) {
                broker.completeTool(turnToken, message.toolCallId, brokerResult(message));
                session.markResultDelivered(message.toolCallId);
              }
            }
          } else if (session.outstanding().length > 0) {
            throw new Error("Read-only ChatGPT Web runtime cannot own local tool calls");
          }

          const toolWaitAbort = new AbortController();
          try {
            const roundReasoning: string[] = [];
            const roundEvents: AdapterEvent[] = [];
            const emitRound = (event: AdapterEvent) => {
              roundEvents.push(event);
              emit(event);
            };
            const emitNewTrace = (trace: ChatGptTraceEvent[]) => {
              roundReasoning.push(...trace.map(event => event.text));
              emitTraceEvents(trace, emitRound);
            };
            const emitNewText = (deltas: string[]) => {
              emitTextDeltas(deltas, emitRound);
            };
            if (!parsed._compactionRequest) emitProContextWarning(parsed, turnCapabilities, emitRound);
            emitNewTrace(session.runtime.trace.drain());
            emitNewText(session.runtime.text.drain());
            const nextTools = turnToken
              ? broker.nextToolBatch(turnToken, toolWaitAbort.signal).then(requests => ({ type: "tools" as const, requests }))
              : undefined;
            const browserOutcome = session.browserOutcome.then(outcome => ({ type: "browser" as const, outcome }));
            let nextTrace = session.runtime.trace.next(toolWaitAbort.signal).then(event => ({ type: "trace" as const, event }));
            let nextText = session.runtime.text.wait(toolWaitAbort.signal).then(() => ({ type: "text" as const }));
            for (;;) {
              const next = await withAbort(
                Promise.race([
                  ...(nextTools ? [nextTools] : []),
                  browserOutcome,
                  nextTrace,
                  nextText,
                ]),
                incoming.abortSignal,
              );
              if (next.type === "trace") {
                emitNewTrace([next.event]);
                nextTrace = session.runtime.trace.next(toolWaitAbort.signal).then(event => ({ type: "trace" as const, event }));
                continue;
              }
              if (next.type === "text") {
                emitNewText(session.runtime.text.drain());
                nextText = session.runtime.text.wait(toolWaitAbort.signal).then(() => ({ type: "text" as const }));
                continue;
              }
              emitNewTrace(session.runtime.trace.drain());
              emitNewText(session.runtime.text.drain());
              if (next.type === "browser") {
                if (next.outcome.type === "error") throw next.outcome.error;
                if (turnToken) finalizeBrowserTurn(turnToken);
                if (session.runtime.text.value() !== next.outcome.answer) {
                  throw new Error("ChatGPT browser Markdown stream did not reproduce the completed answer");
                }
                session.setFinalReasoning(roundReasoning);
                session.setFinalEvents(roundEvents);
                if (turnToken) broker.revoke(turnToken);
                emitBrowserCompletion(
                  next.outcome,
                  estimateChatGptWebUsage(
                    parsed,
                    { answer: next.outcome.answer, reasoning: roundReasoning },
                    turnCapabilities,
                    session.runtime.inputTokensFor(parsed),
                  ),
                  emit,
                );
                return;
              }
              if (!turnToken || session.runtime.mode !== "tools") {
                throw new Error("Read-only ChatGPT Web runtime received a broker tool batch");
              }
              if (next.requests.length === 0) throw new Error("ChatGPT tool bridge returned an empty batch");
              validateBatchTools(parsed, next.requests);
              session.setOutstanding(next.requests, roundReasoning, roundEvents);
              emitToolBatch(
                next.requests,
                estimateChatGptWebUsage(
                  parsed,
                  { reasoning: roundReasoning, toolRequests: next.requests },
                  turnCapabilities,
                  session.runtime.inputTokensFor(parsed),
                ),
                emit,
              );
              return;
            }
          } finally {
            toolWaitAbort.abort();
          }
        });
      } catch (error) {
        if (error instanceof ChatGptWebAdapterError && error.code === "preload_delivery_failed") {
          // Preload could not be delivered; disable it for this turn so the retry compiles a single
          // slimmed message. Bounded so the set cannot grow without limit.
          preloadDisabledTurns.add(executionKey);
          while (preloadDisabledTurns.size > 512) {
            preloadDisabledTurns.delete(preloadDisabledTurns.values().next().value!);
          }
        }
        if (error instanceof ChatGptWebAdapterError && !error.retryable) {
          // A deterministic request failure remains replayable so a native reconnect cannot burn
          // another browser attempt. Every other failure retires the browser session: client
          // disconnects, stage failures, and retryable ChatGPT errors must start a fresh surface
          // instead of replaying one rejected browser outcome for the registry's full TTL.
          session.cancel();
        } else {
          chatGptTurnSessions.retire(executionKey, session);
        }
        if (session.runtime.mode === "tools") {
          void session.runtime.token.then(turnToken => broker.revoke(turnToken)).catch(() => {});
        }
        if (error instanceof ChatGptWebAdapterError) {
          emit({
            type: "error",
            message: error.message,
            status: error.status,
            errorType: error.errorType,
            code: error.code,
            retryable: error.retryable,
          });
          return;
        }
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}
