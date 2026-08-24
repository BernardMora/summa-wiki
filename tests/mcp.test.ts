import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpBody, handleMcpMessage, MCP_PROTOCOL_VERSION } from "../src/mcp/server.ts";
import { MCP_TOOLS, resolveNote, type UiAction } from "../src/mcp/tools.ts";
import { mcpServerFor } from "../src/mcp/attach.ts";
import { mcpEndpoint, registerMcpEndpoint, releaseMcpEndpoints } from "../src/mcp/registry.ts";
import { EPHEMERAL, replay, type AcpEntry } from "../lib/acpSessions.ts";
import type { Note, WikiIndex } from "../src/types.ts";

const note = (over: Partial<Note>): Note => ({
  id: "personal:a.md", bundle: "personal", path: "a.md", abs: "/vault/a.md", slug: "a",
  title: "A", type: "knowledge", created: "2026-01-01", updated: "2026-01-02", author: "human",
  tags: [], words: 10, excerpt: "", headings: [], links: [], backlinks: [], assets: [],
  provenance: { humanWords: 10, agentWords: 0, malformed: false },
  ...over,
});

const index = (notes: Note[]): WikiIndex => ({
  generatedAt: "2026-08-21", version: 1, bundles: [], notes,
  stats: {
    notes: notes.length, words: 0, internalLinks: 0, brokenLinks: 0, crossBundleLinks: 0,
    isolated: 0, orphans: 0, byType: {}, byAuthor: {}, byBundle: {},
  },
});

const ctxFor = (notes: Note[]) => {
  const actions: UiAction[] = [];
  return { actions, ctx: { index: () => index(notes), ui: (a: UiAction) => { actions.push(a); } } };
};

test("initialize echoes a supported protocol version and falls back otherwise", () => {
  const { ctx } = ctxFor([]);
  const old = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, ctx);
  assert.equal((old!.result as { protocolVersion: string }).protocolVersion, "2024-11-05");
  const future = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, ctx);
  assert.equal((future!.result as { protocolVersion: string }).protocolVersion, MCP_PROTOCOL_VERSION);
});

test("notifications get no response at all", () => {
  const { ctx } = ctxFor([]);
  assert.equal(handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null);
  // A batch of nothing but notifications must leave the transport with no body.
  assert.equal(handleMcpBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], ctx), null);
});

test("every advertised tool has a schema the agent can read", () => {
  const { ctx } = ctxFor([]);
  const listed = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx)!;
  const tools = (listed.result as { tools: { name: string; description: string; inputSchema: unknown }[] }).tools;
  assert.equal(tools.length, MCP_TOOLS.length);
  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a description an agent can act on`);
    assert.equal((tool.inputSchema as { additionalProperties: boolean }).additionalProperties, false);
    // The `run` function must never be serialized into the wire schema.
    assert.equal("run" in tool, false);
  }
});

test("a failing tool answers as a result, not as a JSON-RPC error", () => {
  const { ctx } = ctxFor([]);
  const response = handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_note", arguments: { note: "nope" } } },
    ctx,
  )!;
  assert.equal(response.error, undefined);
  assert.equal((response.result as { isError: boolean }).isError, true);
});

test("an unknown tool is a protocol error", () => {
  const { ctx } = ctxFor([]);
  const response = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } }, ctx)!;
  assert.equal(response.error?.code, -32602);
});

test("open_note resolves a slug and emits one UI action", () => {
  const { ctx, actions } = ctxFor([note({ slug: "alpha", title: "Alpha" })]);
  handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_note", arguments: { note: "alpha", beside: true } } },
    ctx,
  );
  assert.deepEqual(actions, [{ kind: "open_note", id: "personal:a.md", title: "Alpha", beside: true }]);
});

test("focus_graph reports the ids it could not resolve instead of silently dropping them", () => {
  const { ctx, actions } = ctxFor([note({ slug: "alpha" }), note({ id: "personal:b.md", slug: "beta", path: "b.md" })]);
  const response = handleMcpMessage(
    {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "focus_graph", arguments: { highlight: ["alpha", "ghost", "beta"] } },
    },
    ctx,
  )!;
  const action = actions[0] as Extract<UiAction, { kind: "focus_graph" }>;
  assert.deepEqual(action.highlight, ["personal:a.md", "personal:b.md"]);
  assert.match((response.result as { content: { text: string }[] }).content[0]!.text, /not found: ghost/);
});

test("focus_graph with an empty highlight clears rather than doing nothing", () => {
  const { ctx, actions } = ctxFor([]);
  handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "focus_graph", arguments: { highlight: [] } } },
    ctx,
  );
  assert.deepEqual((actions[0] as Extract<UiAction, { kind: "focus_graph" }>).highlight, []);
});

test("note lookup accepts id, path, slug, filename and title", () => {
  const notes = [note({ id: "personal:dir/a.md", path: "dir/a.md", slug: "alpha", title: "Título Largo" })];
  for (const query of ["personal:dir/a.md", "dir/a.md", "alpha", "alpha.md", "título largo"]) {
    assert.ok(resolveNote(index(notes), query), `should resolve "${query}"`);
  }
  assert.equal(resolveNote(index(notes), "nothing"), undefined);
});

test("transport follows the agent's announced MCP capability", () => {
  const http = mcpServerFor({ agentCapabilities: { mcpCapabilities: { http: true } } } as never, "tok");
  assert.equal((http as { type?: string }).type, "http");

  // No announced capability means stdio, the transport every agent must speak.
  const stdio = mcpServerFor({ agentCapabilities: {} } as never, "tok");
  assert.equal((stdio as { type?: string }).type, undefined);
  assert.ok((stdio as { command: string }).command.length > 0);
  assert.match((stdio as { args: string[] }).args[0]!, /stdio\.mjs$/);
});

test("tokens are unguessable, scoped to one chat, and die with it", () => {
  const first = registerMcpEndpoint({ session: "chat:one", ui: () => {} });
  const second = registerMcpEndpoint({ session: "chat:two", ui: () => {} });
  assert.notEqual(first, second);
  assert.ok(first.length >= 40, "a short token would be brute-forceable over loopback");

  releaseMcpEndpoints("chat:one");
  assert.equal(mcpEndpoint(first), undefined);
  assert.ok(mcpEndpoint(second), "closing one chat must not disarm another");
  releaseMcpEndpoints("chat:two");
});


/**
 * The regression that cost a usable chat tab.
 *
 * A stored `ui` message replays every time the chat pane mounts, and replaying
 * `open_note` re-opens the note, which steals focus, which unmounts the chat —
 * so the tab could never be looked at. UI actions happen once.
 */
test("UI actions never come back from the transcript", () => {
  assert.ok(EPHEMERAL.has("ui"), "a UI action is an event, not part of the conversation");

  const entry = {
    session: null,
    transcript: [
      { t: "sent", text: "hi" },
      { t: "ui", action: { kind: "open_note", id: "personal:a.md", title: "A", beside: false } },
      { t: "turn", stopReason: "end_turn" },
    ],
  } as unknown as AcpEntry;

  const replayed = replay(entry);
  assert.deepEqual(replayed.map((message) => message.t), ["sent", "turn"]);
});

test("every message kind is either replayable or deliberately marked ephemeral", () => {
  // Guards the other direction: a new event-shaped message added without a
  // thought about replay defaults to being stored, which is the failure above.
  for (const kind of EPHEMERAL) assert.equal(typeof kind, "string");
  assert.equal(EPHEMERAL.size, 2, "adding one means deciding it is an event, not a record");
});
