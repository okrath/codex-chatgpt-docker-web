import { expect, test } from "bun:test";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint, isWindowsPipeEndpoint } from "../src/config";

const testInputAccounting = {
  inputTokensFor: () => 0,
  holdBrowserTextUntilFinalized: false,
};

test("explicit browser-turn cancellation aborts and removes every registered session", async () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const replayable = sessions.getOrCreate("turn-a", () => ({
    mode: "read-only",
    browser: Promise.resolve("done"),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    ...testInputAccounting,
    cancel: () => { cancelled += 1; },
  }));
  await replayable.browserOutcome;
  sessions.getOrCreate("turn-b", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    ...testInputAccounting,
    cancel: () => { cancelled += 1; },
  }));

  expect(sessions.activeCount()).toBe(1);
  expect(sessions.clear()).toBe(2);
  expect(cancelled).toBe(2);
  expect(sessions.activeCount()).toBe(0);
});

test("session cache expiry never cancels a still-active long browser turn", async () => {
  const sessions = new ChatGptTurnSessions(1);
  let cancelled = 0;
  const active = sessions.getOrCreate("long-turn", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    ...testInputAccounting,
    cancel: () => { cancelled += 1; },
  }));

  await Bun.sleep(5);
  expect(sessions.activeCount()).toBe(1);
  expect(sessions.getOrCreate("long-turn", () => {
    throw new Error("active session must be reused");
  })).toBe(active);
  expect(cancelled).toBe(0);
  sessions.clear();
});

test("five active turns coexist and a sixth fails closed", () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const runtime = () => ({
    mode: "read-only" as const,
    browser: new Promise<string>(() => {}),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    ...testInputAccounting,
    cancel: () => { cancelled += 1; },
  });

  const active = Array.from({ length: 5 }, (_unused, index) => (
    sessions.getOrCreate(`turn-${index + 1}`, runtime)
  ));
  expect(sessions.activeCount()).toBe(5);
  expect(cancelled).toBe(0);
  expect(() => sessions.getOrCreate("turn-6", runtime)).toThrow("at most 5 simultaneous browser turns");

  expect(sessions.getOrCreate("turn-3", () => {
    throw new Error("an in-flight turn must be reused");
  })).toBe(active[2]);
  expect(cancelled).toBe(0);
  sessions.clear();
  expect(cancelled).toBe(5);
});

test("settled replay sessions expire from their last use instead of their creation time", async () => {
  const sessions = new ChatGptTurnSessions(50);
  let starts = 0;
  const start = () => {
    starts += 1;
    return {
      mode: "read-only" as const,
      browser: Promise.resolve("done"),
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      ...testInputAccounting,
      cancel: () => {},
    };
  };
  const first = sessions.getOrCreate("replay", start);
  await first.browserOutcome;
  await Bun.sleep(10);
  expect(sessions.getOrCreate("replay", start)).toBe(first);
  await Bun.sleep(70);
  expect(sessions.getOrCreate("replay", start)).not.toBe(first);
  expect(starts).toBe(2);
  sessions.clear();
});

test("turn broker creates its private runtime directory on a cold start", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 10_000);
    if (process.platform === "win32") {
      expect(isWindowsPipeEndpoint(socketPath)).toBe(true);
    } else {
      expect(existsSync(socketPath)).toBe(true);
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
    }
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("turn broker tokens do not expire while their browser turn is still alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-unbounded-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    });
    await Bun.sleep(5);
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token }))
      .resolves.toMatchObject({ bindingId: expect.any(String) });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a turn still completes after the browser abandons a native call", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-finalize-abandoned-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [{ name: "exec_command", description: "run", parameters: { type: "object" } }],
    }, 60_000, "turn-finalize-abandoned");
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    const invoke = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { command: "pwd" },
    });
    await broker.nextToolBatch(token);

    expect(() => broker.finalize(token)).not.toThrow();
    broker.revoke(token);
    await expect(invoke).rejects.toThrow("revoked");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("collapsed history is searchable and loadable verbatim, and wiped on revoke", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-history-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [{ name: "exec_command", description: "run", parameters: { type: "object" } }],
    }, 60_000, "turn-history");
    broker.attachCollapsedHistory(token, [
      { index: 0, role: "user", text: "the deploy target is UNIQUE-MARKER-A in prod" },
      { index: 1, role: "toolResult", text: "ran build, output UNIQUE-MARKER-B" },
    ]);
    expect(() => broker.attachCollapsedHistory(token, [{ index: 0, role: "user", text: "x" }]))
      .toThrow("already attached");

    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    const search = await callTurnBroker<{ matches: Array<{ index: number; snippet: string }> }>(socketPath, {
      method: "search_history",
      bindingId: claimed.bindingId,
      query: "unique-marker-b",
    });
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0]).toMatchObject({ index: 1 });
    expect(search.matches[0]!.snippet).toContain("UNIQUE-MARKER-B");

    const loaded = await callTurnBroker<{ messages: Array<{ index: number; text: string }>; truncated: boolean }>(socketPath, {
      method: "load_history",
      bindingId: claimed.bindingId,
      indexes: [0, 1],
    });
    expect(loaded.truncated).toBe(false);
    expect(loaded.messages.map(m => m.text)).toEqual([
      "the deploy target is UNIQUE-MARKER-A in prod",
      "ran build, output UNIQUE-MARKER-B",
    ]);

    await expect(callTurnBroker(socketPath, {
      method: "load_history",
      bindingId: claimed.bindingId,
      indexes: [9],
    })).rejects.toThrow("out of range");

    broker.revoke(token);
    await expect(callTurnBroker(socketPath, { method: "claim", token })).rejects.toThrow(/finished|invalid/);
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function unansweredBrokerEndpoint(name: string, onConnection: (socket: Socket) => void) {
  const root = mkdtempSync(join(tmpdir(), name));
  const socketPath = defaultBrokerEndpoint(root);
  if (!isWindowsPipeEndpoint(socketPath)) mkdirSync(dirname(socketPath), { recursive: true });
  const server = createServer(onConnection);
  return {
    socketPath,
    listen: () => new Promise<void>(ready => server.listen(socketPath, ready)),
    close: async () => {
      await new Promise<void>(done => server.close(() => done()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("an unbounded broker call fails when the broker closes without answering", async () => {
  const broker = unansweredBrokerEndpoint("cgw-broker-closed-", socket => socket.on("data", () => socket.end()));
  await broker.listen();
  try {
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token: "turn_closed" }, null))
      .rejects.toThrow("closed the connection");
  } finally {
    await broker.close();
  }
}, 10_000);

test("an unbounded broker call outlives the bounded default timeout", async () => {
  const accepted: Socket[] = [];
  const broker = unansweredBrokerEndpoint("cgw-broker-slow-", socket => { accepted.push(socket); });
  await broker.listen();
  try {
    const call = callTurnBroker(broker.socketPath, { method: "claim", token: "turn_unbounded" }, null);
    const outcome = await Promise.race([
      call.then(() => "settled", () => "settled"),
      Bun.sleep(5_300).then(() => "pending"),
    ]);
    expect(outcome).toBe("pending");
  } finally {
    for (const socket of accepted) socket.destroy();
    await broker.close();
  }
}, 15_000);

test("turn broker names the finished turn that owns a replayed handle", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "turn-alpha");
    // A corrupted copy of a live token, while this process still holds that turn, must read as the
    // copy error it is and send the model back to the token in its own prompt. Calling it a restart
    // cost the whole turn: the model believed the workspace was gone and stopped to ask the user.
    let mistypedToken = "";
    try {
      await callTurnBroker(socketPath, { method: "claim", token: ` ${token}` });
    } catch (error) {
      mistypedToken = error instanceof Error ? error.message : String(error);
    }
    expect(mistypedToken).toContain("not one the running bridge process issued");
    expect(mistypedToken).toContain("1 live Codex turn");
    expect(mistypedToken).toContain("mistyped or truncated");
    expect(mistypedToken).toContain("<codex_transport_resume>");
    expect(mistypedToken).toContain("retry this same Codex Native call");
    expect(mistypedToken).toContain("Nothing is wrong with the Codex task");
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    broker.revoke(token);

    const rejection = async (request: Parameters<typeof callTurnBroker>[1]): Promise<string> => {
      try {
        await callTurnBroker(socketPath, request);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error("turn broker accepted a handle it should have rejected");
    };

    const replayedBinding = await rejection({
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
    });
    expect(replayedBinding).toContain("turn-alpha");
    expect(replayedBinding).toContain("has already finished");
    expect(replayedBinding).not.toContain("codex_bind_turn");

    const replayedToken = await rejection({ method: "claim", token });
    expect(replayedToken).toContain("turn-alpha");
    expect(replayedToken).toContain("can no longer run");
    expect(replayedToken).not.toContain("current task context");

    // With no live turn left either, a restart is the remaining explanation, and the model still has
    // to hear that the task itself survived it.
    const restarted = await rejection({ method: "claim", token: "turn_never-issued-by-this-process" });
    expect(restarted).toContain("not known to the running bridge process");
    expect(restarted).toContain("the bridge restarted after the token was issued");
    expect(restarted).toContain("sending one more message starts a new turn");

    const unknownBinding = await rejection({
      method: "invoke",
      bindingId: "binding_never-issued",
      wireName: "exec_command",
    });
    expect(unknownBinding).toBe("internal Codex turn binding is invalid or expired");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
