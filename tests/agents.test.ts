import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanEnv, parseCommandPaths, parsePresetPaths } from "../src/agents.ts";
import { ACP_PRESETS } from "../src/acp/presets.ts";

test("the ACP probe derives ids and commands from the single registry", () => {
  const output = [
    "Restored session: ignored shell noise",
    "claude-agent-acp\t/usr/local/bin/claude-agent-acp",
    "claude\t/usr/local/bin/claude",
    "codex-acp\t/home/u/.nvm/bin/codex-acp",
    "codex\t/home/u/.nvm/bin/codex",
    "opencode\t/home/u/.opencode/bin/opencode",
    "bunx\t/opt/homebrew/bin/bunx",
    "agy\t/home/u/.local/bin/agy",
    "hermes\t/home/u/.local/bin/hermes",
  ].join("\n");

  const paths = parsePresetPaths(output, false);
  assert.equal(paths["claude-code"], "/usr/local/bin/claude-agent-acp");
  assert.equal(paths.codex, "/home/u/.nvm/bin/codex-acp");
  assert.equal(paths.antigravity, "/opt/homebrew/bin/bunx");
  assert.equal(paths.hermes, "/home/u/.local/bin/hermes");
  assert.equal(paths.kiro, null);
  assert.equal(paths["mistral-vibe"], null);
  assert.deepEqual(Object.keys(paths), ACP_PRESETS.map((preset) => preset.id));
});

test("an adapter is missing when its wrapped harness is missing", () => {
  const output = "bunx\t/opt/homebrew/bin/bunx\n";
  assert.equal(parsePresetPaths(output, false).antigravity, null);
});

test("relative and platform-incompatible command paths are rejected", () => {
  assert.equal(parseCommandPaths("agent\tagent", { x: "agent" }, false).x, null);
  assert.equal(parseCommandPaths("agent\t./agent", { x: "agent" }, false).x, null);
  assert.equal(
    parseCommandPaths("agent\tC:\\Users\\u\\agent.cmd", { x: "agent" }, true).x,
    "C:\\Users\\u\\agent.cmd",
  );
  assert.equal(parseCommandPaths("agent\t/usr/local/bin/agent", { x: "agent" }, true).x, null);
});

test("the launch environment removes npm and nested Claude Code state", () => {
  const env = cleanEnv({
    NODE_ENV: "test",
    HOME: "/Users/u",
    PATH: "/usr/bin",
    npm_config_prefix: "/Users/u/.local",
    npm_lifecycle_event: "desktop",
    CLAUDE_CODE_CHILD_SESSION: "1",
    ANTHROPIC_API_KEY: "sk-x",
  } as NodeJS.ProcessEnv);

  assert.equal(env.npm_config_prefix, undefined);
  assert.equal(env.npm_lifecycle_event, undefined);
  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, "sk-x");
  assert.equal(env.HOME, "/Users/u");
});
