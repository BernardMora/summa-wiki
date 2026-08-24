import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAgentProvenance } from "../lib/provenance.ts";
import { readAcpTextFile, safeAcpPath, writeAcpTextFile } from "../src/acp/filesystem.ts";

const note = (body: string, author = "human") => `---\ntitle: Test\nauthor: ${author}\nupdated: 2026-08-21\n---\n\n${body}`;

test("agent paragraph additions receive safe inline provenance", () => {
  const before = note("First paragraph.\n");
  const result = applyAgentProvenance(before, note("First paragraph.\n\nAgent paragraph.\n"));
  assert.match(result.content, /<!-- ai -->\n\nAgent paragraph\.\n<!-- \/ai -->/);
  assert.match(result.content, /^author: mixed$/m);
  assert.equal(result.wrapped, true);
});

test("agent edits inside a table use honest file-level fallback", () => {
  const before = note("| A | B |\n| - | - |\n| 1 | 2 |\n");
  const result = applyAgentProvenance(before, note("| A | B |\n| - | - |\n| 1 | 3 |\n"));
  assert.doesNotMatch(result.content, /<!-- ai -->/);
  assert.match(result.content, /^author: mixed$/m);
  assert.equal(result.wrapped, false);
});

test("ACP reads prefer the live editor buffer and honor line ranges", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summa-acp-"));
  try {
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, "disk\nvalue\n");
    const buffers = new Map([[file, { content: "live\nbuffer\nthird\n", updatedAt: Date.now() }]]);
    assert.equal(readAcpTextFile({ root, buffers }, file, 2, 1), "buffer\n");
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("ACP writes stay inside the vault and can create agent-authored Markdown notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summa-acp-"));
  try {
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, note("Before.\n"));
    const buffers = new Map<string, { content: string; updatedAt: number }>();
    writeAcpTextFile({ root, buffers }, file, note("Before.\n\nAfter.\n"));
    assert.match(fs.readFileSync(file, "utf8"), /<!-- ai -->/);
    assert.throws(() => safeAcpPath(root, path.join(root, "..", "outside.md")), /limited/);
    const created = path.join(root, "new", "note.md");
    writeAcpTextFile({ root, buffers }, created, note("Created by the agent.\n", "human"));
    const content = fs.readFileSync(created, "utf8");
    assert.match(content, /^author: agent$/m);
    assert.match(content, /<!-- ai -->\n\nCreated by the agent\.\n\n<!-- \/ai -->/);
    assert.doesNotMatch(content, /^created:/m);
  } finally { fs.rmSync(root, { recursive: true }); }
});
