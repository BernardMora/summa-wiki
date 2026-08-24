# Migrating the agent layer to ACP

Summa Wiki used to talk to agents by spawning their terminal UIs into a pty and
pasting command-line flags at them. This document is the plan that replaced
that with the **Agent Client Protocol** (ACP), an open standard (Apache 2.0,
Zed) that every relevant harness already speaks.

**All six phases are done** (2026-08-20 → 2026-08-21). The document is kept as
written — a plan whose phases record what actually happened, including where
the plan was wrong — rather than rewritten into a description of the result.
Read [`future-work.md`](future-work.md) for the conventions it follows: the
reasoning is the point, so that the next session does not have to rediscover
it.

What the app is now: agents are local stdio subprocesses, one conversation per
harness inside a single chat tab, with the vault exposed to them as MCP tools
and the app's own views as things they can aim.

---

## The decision

**Summa Wiki becomes an ACP client.** Agents are local stdio subprocesses the
user already has, each running on the user's own account. The app never holds a
model SDK and never requires an API key — the promise in
[`../ROADMAP.md`](../ROADMAP.md) survives intact.

### What was rejected, and why

**Routing everything through one agent that acts as a provider router** — the
obvious candidate being Hermes Agent, which is free and has adapters for every
provider. Rejected because it confuses two axes:

- **Providers** — which model gets called (Anthropic, OpenAI, Google, Bedrock).
- **Harnesses** — whose agent loop, memory, skills and *account* run it.

A router owns provider credentials. Most users on Claude Code have a
subscription, not API credits; routing them through a hub would force them onto
pay-per-token keys and a Python daemon's YAML file this app cannot see,
validate, or help repair. Every "why isn't it working" would become a support
problem in someone else's config format — landing squarely on the first-run
experience that `ROADMAP.md` calls the product's narrowest gate.

The normalization a router would buy is real but redundant: **ACP already
normalizes harness output one layer up, for free.** Hermes remains valuable —
as one agent in the picker, and as the ambient/cron daemon described at the end
of this document.

**Embedding Hermes as a dependency** — it is Python; this app is Node/Electron
with a dependency policy strict enough that the force simulation in
`GraphView.tsx` is hand-written to avoid d3. A bundled Python runtime would
break both the packaging and the "no service, no account" promise.

---

## Evidence

Verified against [`RAIT-09/obsidian-agent-client`](https://github.com/RAIT-09/obsidian-agent-client)
v0.12.1 (Apache-2.0), cloned to `../obsidian-agent-client/` — an Obsidian plugin
doing precisely this against a Markdown vault. Line references below are into
that clone.

**Seven agents, one adapter, no router.** `src/services/preset-agents.ts` ships
Claude Code, Codex, Gemini CLI, Mistral Vibe, OpenCode, Kiro and Hermes Agent.
Each preset is `{ presetId, defaultDisplayName, defaultCommand, defaultArgs,
apiKey?, installHint, docsPage }`. `defaultArgs` is `[]`, `["acp"]`, or
`["--experimental-acp"]`. The flag problem does not exist there.

**Model selection is not per-agent knowledge.** ACP superseded the `modes` and
`models` APIs with a single generic `configOptions` array (`src/types/session.ts:530`:
*"modes and models are DEPRECATED in favor of configOptions"*). The agent
advertises options at session creation; each is
`{ id, name, type: "select", currentValue, options: [{ value, name }] }`. Mode,
model and thought_level are all the same shape, set through one method,
`session/set_config_option` (`src/acp/acp-client.ts:738`). The client renders
dropdowns **without knowing what any option means**. A `config_option_update`
event lets the agent change them mid-session.

**Command output arrives without a pty.** `ToolCallContent` has three variants:
`content` (regular text blocks — the agent ran the command and reports the
output), `diff` (structured file change), and `terminal` (a `terminalId`
pointing at a process the *client* owns, for live streaming). The plugin
implements only the last two and explicitly drops `content`
(`src/acp/type-converter.ts:39`). Even so, its terminal handler is plain
`child_process.spawn` (`src/acp/terminal-handler.ts:1`) — **no node-pty
anywhere in the repo.** Nothing in ACP needs terminal *emulation*, because
there is no interactive TUI on the other end.

**Subscription login is the default path.** Every preset with an `apiKey` field
describes it as *"Required if not logging in with an Anthropic/OpenAI/Google
account."* Hermes has no API key field at all — it manages its own credentials
under `~/.hermes/`.

---

## What this deletes

The current agent layer is an abstraction over *command-line flags for
terminal UIs*, and its own comments are the bug report: `--yes` silently
swallowed by opencode's non-strict yargs; `--dangerously-skip-permissions`
ignored by an agent that never had it; `agy` hanging without `-p`; resume being
a flag in three CLIs and a subcommand in a fourth, with two unable to pick a
session at all.

Every one of those is a symptom of negotiating with a human-facing text
interface. Under ACP:

| Goes away | Replaced by |
|---|---|
| `PERMS`, `CONVERSATION_PERMS` (`components/agent-session.ts`) | `session/request_permission` — the agent asks the app, as a typed request |
| `RESUME` (flag-vs-subcommand table) | `session/load`, `session/fork`, `session/list` |
| `MODELS`, `agyModels()`, `codexModels()`, `useAgentModels` | `configOptions` advertised by the agent |
| `agentCommand()`, `conversationCommand()`, `promptCommand()` | `session/prompt` with typed content blocks |
| `node-pty` + the `spawn-helper` chmod in `postinstall` | `child_process.spawn`, or nothing at all |

`detectAgents()` survives, reduced: from probing four things per agent to
probing one — is there a command here that speaks ACP.

**Removing node-pty was expected to remove the only native module from the
Electron bundle**, which would directly help the macOS notarization work in the
*Now* section of `ROADMAP.md`. Native modules are a recurring notarization
complication.

**It took three tries to actually land, and the detour is the useful part.**
Phase 3 found that a `type: "terminal"` authentication method is by contract an
interactive process, and that Claude Code — the default agent — offers *only*
terminal methods. So Phase 6 kept `node-pty` for that one screen. Phase 6c then
removed it anyway, by not running the sign-in inside the app at all. See there.

The "only native module" half of the claim was also wrong, and worth recording
so nobody re-derives it: Next pulls in `sharp`, which ships
`sharp-darwin-arm64.node` and `libvips-cpp.dylib`, and `electron-builder.yml`
does not exclude it. Removing node-pty does not by itself give a
native-module-free bundle.

---

## Plan

### Phase 1 — Transport ✅ done (2026-08-20)

`@agentclientprotocol/sdk` v1.4.0, `src/acp/presets.ts` (the registry),
`src/acp/session.ts` (spawn, connect, session, prompt, cancel, config),
`tests/acp.test.ts` (10 tests), `scripts/acp-smoke.mjs` (manual run against a
real agent).

Verified end to end against **Hermes Agent 0.16.0** — streamed
`agent_message_chunk`, `stopReason: end_turn`, 9 slash commands announced — and
against **OpenCode 1.18.18** for session creation and capability discovery.

What it confirmed, with numbers:

- **`configOptions` is real and replaces the model tables.** OpenCode announces
  `model` with **364 options** and `mode` with 2, both discovered at
  `session/new`. Nothing about models is hardcoded anywhere in `src/acp/`.
- **Slash commands arrive over the wire** (`available_commands_update`), which
  is the "skills as a visible surface" roadmap item for free.
- **`usage_update`** streams tokens and cost per turn.
- `agent_thought_chunk` is separate from `agent_message_chunk`, so thinking can
  be rendered distinctly without parsing anything.

Four things that cost time and are worth not rediscovering:

- **`--experimental-strip-types` rejects TypeScript parameter properties.**
  `constructor(private readonly x: T)` typechecks and then fails at runtime with
  `ERR_INVALID_TYPESCRIPT_SYNTAX`, because the server and CLI only *strip*
  types, they do not transform code. Declare fields and assign them in the body.
- **SDK handlers receive a context object, not params.** The signature is
  `({ params, signal, agent }) => …`. Passing `(params) => …` fails silently as
  a per-notification "Internal error" while the turn still completes, so it
  looks like a protocol problem rather than a signature one.
- **`session/set_config_option` takes `configId`, not `optionId`,** and the
  value is a tagged union — `{ type: "id", value }` or `{ type: "boolean", value }`.
  A bare string is rejected by the schema.
- **A permission request must answer `cancelled` when its `AbortSignal` fires.**
  Leaving the promise pending hangs the agent forever.

At the time it landed, none of this was wired to the app — the session objects
were constructed and driven from the smoke script. Phase 2 wired them, and did
follow the pattern `server.ts` already uses for terminals: a session registry
that survives reconnects, on its own port.

### Phase 2 — The chat component ✅ done (2026-08-21)

`src/acp/terminal.ts` (client-owned terminals), `src/acp/wire.ts` (the
browser↔server contract), `lib/acpSessions.ts` (the session registry),
`app/api/acp/route.ts`, the ACP WebSocket server on **port + 2** in
`server.ts`, `components/acp-transcript.ts` (the pure fold),
`components/AgentChat.tsx`, a `chat:` tab type wired through `Tabs.tsx` and
`Workspace.tsx`, and an entry point in `AgentMenu.tsx`. 25 tests
(`tests/acp-chat.test.ts`), plus `scripts/acp-chat-smoke.mjs` for a run against
a real agent (`--npx` to force the no-install path).

Verified end to end: browser WebSocket → registry → agent → streamed back →
reconnect replays the whole conversation. Against **Hermes Agent** and
**OpenCode**, both of which ran `ls -la`, appended to a file, and reported
`stopReason: end_turn`.

The architecture mirrors the terminal deliberately — the session lives in the
server, the connection only watches it, and only closing the tab
(`DELETE /api/acp`) actually kills the agent. What changes is what gets kept
for redraw: a pty keeps the last bytes of screen, because a terminal *is* its
screen; here the conversation is kept as typed messages and refolded on
reconnect. That the fold is pure is what makes replay and live streaming
converge on the same state — it is a test, not a hope.

**Rendering `content` was not optional.** The reference plugin drops that
variant, and it is the one that actually fires: *neither Hermes nor OpenCode
used the client terminal capability*, even though the app advertises it. Both
executed the commands themselves and reported the output as `content` blocks. A
client that dropped it would have shown two empty tool cards for a
conversation that ran two shell commands. The terminal capability is
implemented and tested anyway — advertising a capability that does not answer
leaves an agent calling into a hole.

Three things worth not rediscovering:

- **`.then(ok, fail)` does not catch what `ok` throws.** `session/new` failing
  inside the fulfilled branch escaped as an unhandled rejection and **took down
  the whole server process**, every other conversation with it. Found with an
  expired Gemini account, which starts fine, answers `initialize`, and dies at
  `session/new` — an ordinary expired credential, not an edge case. One
  `.catch()` wrapping both.
- **`spawn` emits `error`, not `exit`, for a command that does not exist.**
  Without handling it, `terminal/wait_for_exit` waits forever and the agent
  with it.
- **Node cannot load `.tsx` under `--experimental-strip-types`** (JSX is not
  strippable), so anything meant to be tested has to live in a `.ts`. That is
  why the fold and the fence splitter are in `acp-transcript.ts` and not next
  to the component that uses them.
- **A stale WebSocket's `onclose` writes over the live session's state.** With
  StrictMode's double mount, the first effect's socket closes *after* the
  second has mounted, and its handler set `status: "closed"` on the state the
  second owns. On screen: the agent's name and token usage appeared correctly
  and the input box was dead. Only caught by opening it in a browser — every
  server-side check passed. Every handler now verifies it is still the current
  socket, which also covers the non-StrictMode case of the effect re-running
  (a change of agent or of working directory).

**The `diff` variant is verified** — by Codex, which was the agent that
produced one. Hermes and OpenCode both edit by appending through the shell, so
the change arrives as a terminal command; Codex sends a real `diff`
(`/tmp/nota.md`, 0 → 12 chars) and `DiffView` renders it.

**Codex also exposed a third output path the protocol does not define.** Its
tool calls carry no `content` at all — the output of `ls` lands in `rawOutput`,
as `{ formatted_output: "…" }`. `ToolCallContent` has three variants and
`rawOutput` is none of them; the schema calls it "raw output returned by the
tool", typed `unknown`. A client that renders only the three variants shows an
empty `read` card for a command that ran. So there is now a **fallback**
(`rawOutputText`, collapsed in the UI, consulted only when `content` is empty)
— deliberately not treated as a fourth variant, because its shape is not
guaranteed. Between this and the `content` finding, the tally across four
agents is: two use `content`, one uses `rawOutput`, **none uses the client
terminal**.

#### The npx fast path (added the same day)

Option (2) from **Decided → Onboarding** is now built, because the first real
use hit exactly what it was meant to solve: opening a Codex chat on a machine
without the adapter is a dead end with only a command to copy.

`AcpPreset.npm` names the package (**without a version** — `@latest` would make
npx hit the network on every start instead of using its cache, which is the
whole point). When the binary is missing and the preset has one,
`AgentNotFoundError` carries `canUseNpx`, the error card offers **Run it
without installing**, and the retry relaunches through
`npx -y <package>`. `installCommand` is now derived from the same field, so the
install string and the npx string cannot drift.

It stays a button and never a default: behind it is a download from the network
the first time, and an app that promises to call no service cannot do that
unasked to save someone a step.

Verified against Codex: launched via npx, authenticated with the existing
account, announced **five** config options (mode, collaboration mode, model,
reasoning effort, fast mode) and 55 slash commands, ran a command and produced
a diff.

Two more bugs this shook out:

- **A superseded launch's outcome poisoned the new session.** Resolving the
  PATH takes the better part of a second, so the *first* attempt's rejection
  landed after the retry had already started and was emitted into its
  transcript. The good session came up, sent its `ready`, and the UI still
  showed the old error with a dead input box. Fixed with a generation counter
  on the entry (`AcpEntry.gen`); every callback checks it is still the current
  launch, and a superseded one that did start a process closes it instead of
  orphaning it.
- **`ready` only promoted from `starting`,** so a session that came up after a
  failure stayed marked failed. It now promotes from `failed` too — and still
  never from `busy`, since a reconnect mid-turn delivers `ready` before the
  `sent` that opened the turn.

And one correctness fix that only a browser could catch: **our own error
messages were hardcoded Spanish** and appeared verbatim in an English UI. The
server does not know the interface language — it lives in `settings.json` and
is handed down by the layout — so errors that are *ours* now travel as a `code`
and get their text on the client. What the agent says still travels as text,
because it cannot be translated. Relatedly, the header shows the **preset's**
name: `codex-acp` reports itself as `@agentclientprotocol/codex-acp`, and
heading a conversation with an npm path is accurate and useless. The
self-reported name and version moved to the `title`.

At the end of Phase 2, the old flag-building menu still existed beside the new
one and ACP installation detection had not reached onboarding. Phase 3 removed
that parallel surface and made the preset registry authoritative.

#### `npm_config_prefix` made every nvm binary invisible (2026-08-21)

Reported three times as *"it still says not installed and the package is
installed"* — and it was installed, and `resolveCommand` found it perfectly
from a terminal. The first two answers (stale registry entry, stale server
process) were wrong. The real cause was one environment variable.

**npm exports its config into the environment of the scripts it runs**, so a
server started with `npm run dev` or `npm run desktop` carries
`npm_config_prefix`. And **nvm refuses to initialise when that variable is
set** — it prints *"nvm is not compatible with the `npm_config_prefix`
environment variable"* and aborts. `runInUserShell` passed the server's
environment straight through to the probe shell, so nvm never loaded there and
`~/.nvm/versions/node/<v>/bin` never reached the PATH. Every binary installed
with `npm install -g` under nvm was therefore invisible to the app while
working fine in any terminal.

Measured directly:

```
$ npm_config_prefix=/Users/…/.local zsh -lic 'command -v claude-agent-acp; …'
nvm is not compatible with the "npm_config_prefix" environment variable
PATH tiene nvm? 0
```

What made it hard to read: **it only hit nvm-managed binaries.** `hermes`
(`~/.local/bin`), `opencode` (`~/.opencode/bin`) and `bunx` (`/opt/homebrew`)
were never affected and always worked, so the failures looked specific to the
two npm adapters rather than to how they were installed.

The fix is one line in the right place, and the reason it was missing is worth
noting: the environment-scrubbing policy existed in **three** copies —
`agentEnv()` for the agent process, `shellEnv()` in `server.ts` for the pty,
and nothing at all for the probe shell. The two that existed both stripped
`npm_*`; the one that did not exist was the one that mattered. So the agent was
being launched into a clean environment it could never be found in.

`cleanEnv()` in `src/agents.ts` is now the single policy, used by
`runInUserShell` and re-exported as `agentEnv`. Verified end to end with the
server started **through npm**, which is the condition that reproduced it:
Claude Code, Codex and Hermes all reach `ready`.

#### A failed launch is retried, not replayed (2026-08-21)

Reported as *"the not-installed errors keep appearing even though the packages
are installed"* — and they were installed; `resolveCommand` finds all six
binaries correctly. The bug was one level up.

`openSession` returned an existing entry untouched, and `replay()` re-sent its
stored transcript to every new connection. So an entry whose launch had failed
kept its error forever. Tab ids survive in `localStorage`, so reopening the tab
reconnected to the same dead entry and repainted the same stale error — with
the package by then installed. It read as an app that could not notice
installations.

The trigger is the ordinary sequence: hit "not installed", install it in a
terminal, come back. Nothing about that should require restarting the server,
and it did.

`AcpEntry.phase` (`starting` / `live` / `failed`) is what was missing —
`session === null` could not distinguish "still starting" from "did not start".
Reconnecting to a `failed` entry now relaunches. Only from `failed`: from
`live` it would kill a running conversation on a tab switch, and from
`starting` it would spawn a second process on top of one still resolving the
PATH.

The error card also grew a plain **Try again**, listed before the npx
shortcut. The npx button was the only action there, which quietly assumed the
user would take the shortcut rather than install properly — and left whoever
installed by hand staring at an error that was no longer true.

`retry-npx` became `{ t: "retry"; viaNpx?: boolean }`, since the two paths are
the same operation with one flag.

#### Reading the old APIs, and showing what the agent offers (2026-08-21)

Prompted by a direct comparison against the Hermes TUI, which greets you with
its model, its tool count and its slash commands while the app's panel showed a
title and a void. Three separate gaps, all of them ours:

**1. The deprecated `models`/`modes` APIs are not dead.** Hermes sends
`configOptions: null` *and*, in the same `session/new` response, twelve models
and three modes through the old fields. `fromLegacy()` now maps them into the
shape the UI already renders — but asymmetrically, because the protocol is
asymmetric:

- **Modes become a real dropdown**, routed to `session/set_mode` (verified
  against Hermes: `{}` on success). They matter more than they look — Hermes's
  three modes are *Default / Accept Edits / Don't Ask*, i.e. the permission
  posture, which was completely invisible before.
- **Models become read-only text.** `session/select_model` gets
  `-32601 Method not found` from Hermes, and the method does not exist in the
  SDK either. A dropdown listing twelve models you cannot choose is a lie
  shaped like a control; the label carries a tooltip pointing at `/model`.

The synthetic mode option uses the reserved id `acp:legacy-mode`, and
`setConfigOption` routes it to `set_mode` instead of `set_config_option` — an
agent cannot be sent a `configId` this client invented. The old fields are read
**only when `configOptions` is empty**: an agent that sends both has already
said what it means, and two dropdowns for one setting would be worse than none.

Note the SDK no longer declares `models` on `NewSessionResponse` — it was
dropped with the rest of the old API — so the type is declared locally. The
data is on the wire whether or not the types admit it.

**2. Slash commands were being stored and never rendered.** Hermes announces
nine with descriptions (`/model`, `/tools`, `/context`, `/compress`, `/steer`,
`/queue`…), Codex 76, Claude Code 88. Typing `/` now filters them above the
input. Picking one **completes but does not send**, since several take
arguments and firing `/model` bare would do something nobody asked for.

**3. `configHint` was written on the false premise** and is now unused —
Hermes needed no such hint. It stays in the table because an agent with truly
nothing to announce is a real case, with a test pinning Hermes out of it so it
does not come back by habit.

What ACP genuinely does **not** carry, and the TUI does: the tool and skill
inventory (30 tools, 73 skills). There is no ACP surface for it. `/tools` asks
the agent for it as a normal turn, which is the honest answer for now.

#### The empty state (2026-08-21)

Opening a Hermes chat showed a title, a context percentage, a bare "Agent
diagnostics" toggle, and a large void. Nothing was broken — Hermes announces no
`configOptions` at all, so correctly there was no model dropdown — but with
nothing said about it, the panel reads as failed.

`AcpPreset.configHint` is the missing sentence: the command that configures the
agent **outside the app**. When an agent announces no options and its preset
knows where they live, the empty transcript says so. The knowledge sits in the
table rather than the component, because it is a fact about that agent.

*(Written for Hermes, on the mistaken belief that it announced nothing. It
does — see above. The mechanism stays; Hermes no longer uses it.)*

Checked while investigating, and worth recording as *not* a bug: the pane
layout is correct. The input box sits at the bottom of the pane, the transcript
is the only thing that scrolls, and there is no horizontal overflow — measured
in the browser (bar 32px, scroll 682px, input 71px, textarea in view).

#### Gemini out, Antigravity in (2026-08-21)

**Gemini CLI was removed from the picker.** Against a Gemini Code Assist
account for individuals, Google's servers reject the client outright —
*"This client is no longer supported […] migrate to the Antigravity suite of
products"* — and the session dies at `session/new`. Verified against 0.53.0.
An agent in the menu that cannot authenticate is not an option, it is a trap.

Antigravity took its slot, and getting there was not free. **`agy` does not
speak ACP**: version 1.1.15 has no `acp` subcommand and no equivalent flag. The
closest thing is `--input-format/--output-format stream-json`, which is a
different protocol. So it needs an adapter, and on 2026-08-21 there were two
third-party ones. Both were tested end to end:

| Adapter | Runtime | Result |
|---|---|---|
| `agy-acp` 0.5.1 / 0.5.2 | Node | **SIGSEGV** on the first `session/prompt` |
| `agy-acp` 1.0.0-alpha.0 | Node | Starts, but every turn is rejected by `agy` |
| `antigravity-acp` 1.1.0 | **Bun** | Completed the turn on the first try |

`agy-acp` was the one worth wanting — it runs on plain Node, is Apache-2.0, and
has ~5× the downloads. It segfaults because it pulls in `better-sqlite3` and
`node-pty`, two native modules. The alpha stops crashing and fails more
interestingly: it sends
`--model "gemini-3.7-flash-high\tGemini 3.7 Flash"`, because `agy models`
prints `id<TAB>label` and the adapter never splits on the tab. Its
`configOptions` are mangled at the source — the `value` fields come out as
`gemini-3.7-flash-high-gemini-3.7-flash`. This codebase already parses that
exact format correctly in `agyModels()` (`src/agents.ts`).

So the preset is `bunx antigravity-acp`, **not** the binary name. That is
deliberate: `antigravity-acp`'s executable starts with `#!/usr/bin/env bun`, so
the real dependency is Bun. Launching it by name would fail with
`env: bun: No such file or directory`, which tells the user nothing, and the
npx shortcut would not help either — npx can fetch a package it cannot run.
Naming `bunx` as the command makes the missing-binary card say the true thing
and offer the install that actually fixes it. That is also why this preset
carries no `npm` field: "run without installing" is meaningless when what is
missing is an interpreter.

It is the **only third-party adapter in the table** — `claude-agent-acp` and
`codex-acp` are published by the ACP organisation itself, with OIDC trusted
publishing; this one is one person's project. That is a real difference in the
trust path, since the adapter drives the user's Google account.

**The durable fix is to write the adapter here**, over
`agy --input-format stream-json --output-format stream-json`: no third party in
the chain, no Bun, no native modules, and the model parsing that both
third-party adapters got wrong is already correct in this repo. Worth doing if
Antigravity matters; until then `bunx` works and is honest about its cost.

`AcpPreset.envFrom` was added for this too: it maps an environment variable to
a **binary to resolve in the user's PATH**. Antigravity sets
`AGY_BIN: "agy"`, because without it the adapter tries to download its own
`agy` on every start, gets an HTTP 404, and recovers — paying a network
round-trip and filling the diagnostics panel with an alarming warning about a
failure that did not matter. With it: `using $AGY_BIN=…, skipping download`,
and the agent runs the binary the user actually installed.

One quirk worth knowing: Antigravity's tool cards report the tool **input** as
`content` (`{"CommandLine": "ls -la", …}`), not the output. Legible, but it is
a fourth shape in the tally.

### Phase 3 — The preset registry, and getting logged in ✅ implemented (2026-08-21)

The old terminal-agent surface has been removed. `ACP_PRESETS` now drives the
masthead picker, onboarding, vault setup, standalone ingestion, the guided demo,
installation detection, install guidance, and persisted onboarding selection.
The old `AGENT_BINARIES`, `MODELS`, `PERMS`, `CONVERSATION_PERMS`, and `RESUME`
tables and their model API no longer exist. Guided one-shot work is sent as the
first ACP prompt instead of being encoded into CLI flags.

Installation detection checks the complete launch chain, not just the adapter:
Claude Code requires both `claude-agent-acp` and `claude`, Codex requires both
`codex-acp` and `codex`, and Antigravity requires both `bunx` and `agy`.

Authentication is part of the session state. A standards-compliant JSON-RPC
`-32000` error is identified as authentication-required; other `session/new`
failures are not mislabeled, but still expose the agent's advertised sign-in
methods as recovery options. Agent methods call `authenticate` and retry
`session/new` in place. Terminal methods relaunch the exact resolved invocation
with the advertised `args` and `env` in an embedded PTY, stream input/output,
require exit status zero, and then retry session creation. The client now
advertises `clientCapabilities.auth.terminal` because that path actually exists.

Verified with unit tests for authentication state/replay, registry-derived
detection, dependency completeness, TypeScript, a production build, and a real
Hermes ACP turn. A deliberately logged-out matrix across every agent is still a
release verification task; the protocol paths are implemented, but provider
OAuth pages and failure wording can change independently of Summa.

Rendering `configOptions` as generic dropdowns was pulled forward into Phase 2
and is done, including the deprecated `models`/`modes` fallback.

#### Authentication belongs here

Folded in deliberately, not appended. Phase 3 is where the app decides *"is
this agent usable?"*, and answering "is it installed?" without answering "is it
logged in?" only moves the dead end. Authentication is now a distinct session
state rather than an undifferentiated startup error.

It is not a hypothetical. Probed 2026-08-21, every installed agent advertises
at least one method:

| Agent | Methods |
| --- | --- |
| Claude Code | `claude-ai-login` **[terminal]**, `console-login` **[terminal]** |
| Codex | `api-key`, `chat-gpt` |
| OpenCode | `opencode-login` |
| Antigravity | `agy-agent` |
| Hermes | `openai-codex`, `hermes-setup` **[terminal]** |

Two different flows, and the difference is not cosmetic:

- **Agent methods** — call `authenticate` with the method id. One RPC.
- **Terminal methods** — the client **MUST NOT** pass these to `authenticate`.
  It has to relaunch *the same agent invocation* with the method's extra `args`
  and `env` as an **interactive** process, and read success from a zero exit
  status. This is a browser login that pastes a code back into a TUI; there is
  no way to do it without a real terminal.

Two things to get right:

- **`clientCapabilities.auth.terminal` gates the whole thing.** It is now set,
  and every advertised terminal method is handled through the embedded PTY.
- **Which error means "log in"?** Only JSON-RPC `-32000` is labeled as
  authentication-required. When another startup error arrives alongside auth
  methods, the UI describes them as recovery options instead of asserting that
  credentials caused the failure.

Adding a new agent is now one preset entry with its docs/install metadata. The
remaining release check is exercising every provider from a deliberately
logged-out machine; it does not require more protocol or UI implementation.

### Phase 4 — Vault-native capabilities ✅ done (2026-08-21)

The prompt now accepts indexed `@`-mentions and sends them as ACP
`resource_link` blocks. Articles, editor selections, tab context menus, and
search results can start a contextual agent chat without flattening the note
reference into prose. Agent-advertised slash commands are visible and
autocomplete in the composer.

The client advertises and implements `fs/read_text_file` and
`fs/write_text_file`. Reads prefer the latest open CodeMirror buffer, including
unsaved text. Writes are constrained to the vault, can create new files, update
open editors, stamp `updated` when that field exists, and pass Markdown through
structural provenance. A new Markdown note is marked `author: agent` and its
body is wrapped in `<!-- ai -->`; safe additions to existing notes receive the
same markers. Changes inside fenced code, tables, or partial lines fall back to
`author: mixed` without inserting syntax that could damage the document.

Verified with unit coverage for live-buffer reads, line ranges, path escape,
file creation, safe marker placement, and the lossy fallback, plus the complete
test suite, TypeScript, and a production build. Cross-harness behavior remains
an accepted assumption for now: the vault instruction is the primary
provenance contract, while ACP enforcement applies to writes routed through
this client method.

The part no generic ACP client can do, and the reason this is worth building
rather than adopting:

- **`@`-mentions of notes** in the prompt box, backed by the existing index —
  ACP carries them as `resource_link` content blocks, so the agent receives a
  real reference rather than a pasted path.
- **Entry points where the reading happens** — ask about this article, this
  selection, this search result. Already a `ROADMAP.md` item, and impossible
  through a pty because the app cannot compose structured context into one.
- **`fs/read_text_file` / `fs/write_text_file`.** The reference plugin declines
  these (`acp-client.ts:427`), so this is unproven ground. The prize is large:
  reads would see the unsaved CodeMirror buffer, so "rewrite this paragraph"
  operates on what the user is looking at rather than on stale disk content; and
  every agent write would pass through one handler — which is where `<!-- ai -->`
  provenance markers and the `author: mixed` flip can be applied *structurally*
  instead of depending on the agent obeying a rule in `CLAUDE.md`. Today that
  rule fails silently when ignored.

  The hard part is not the plumbing. Deriving *which regions the agent added*
  from a whole-file write means diffing, and wrapping arbitrary diff hunks in
  HTML comments can break the document: inside a fenced code block a marker is
  literal text, inside a table it breaks the row. Any implementation needs a
  markdown-aware placement rule, and a defined fallback for hunks where no safe
  placement exists — most likely marking the whole note `author: mixed` without
  inline markers, which is lossy but honest.
- **Skills as a visible surface** — ACP exposes slash commands with argument
  hints (`AvailableCommand`), so the vault's skills can be listed and
  autocompleted rather than being invisible unless you know to look.

### Phase 5 — An MCP server inside the app ✅ done (2026-08-21)

The app hosts an MCP server and hands it to the agent at `session/new`. Nine
tools: `search`, `related`, `orphans`, `candidates`, `health`, `stats` for the
data family, and `open_note`, `open_graph`, `focus_graph` for the interface.
Verified end to end against Claude Code: it discovered them as
`mcp__summa-wiki__*` without being told they existed, answered "which orphans
are in the study pillar" from `search` + `orphans`, and then **showed** the
answer — a graph tab it opened itself, centred on one note, with the matches
lit up and a "2 highlighted by the agent" badge to clear them.

**The transport question was answered by measurement, not by the schema.**
Every installed adapter was launched and its `initialize` response read:

| agent | `mcpCapabilities` |
|---|---|
| Claude Code (adapter 0.70.0) | `http: true, sse: true` |
| Codex (adapter 1.6.2) | `acp: false, http: true, sse: false` |
| OpenCode 1.18.21 | `http: true, sse: true` |
| Hermes 0.20.5 | *announces none* |

So HTTP covers three of four and stdio — the baseline every agent must speak —
covers the fourth. The `acp` transport, which would carry MCP over the existing
connection with no URL and no process, is the cleanest of the three and is
**out**: Codex declares it `false` and nobody declares it `true`. It is one
extra branch in `src/mcp/attach.ts` whenever that changes.

MCP is served from the Next server at `/api/mcp/<token>`, not a fourth port.
What breaks when sharing Next's `http.Server` is the WebSocket *upgrade*, and
this is plain request/response. The token is minted per conversation, which is
what both keeps other local processes out and tells a UI action which window
asked for it.

**The CLI was pruned as planned.** `show` and `tree` are gone: they did what
`cat` and `ls` do, and the discovery problem that justified them is what MCP
solves. `CLAUDE.md`, `README.md` and `docs/architecture.md` were updated so
nothing points at a command that no longer exists.

**What it cost to learn:** UI actions were first emitted through `emit()`, which
stores into the replayed transcript. That made the chat tab impossible to
look at — a stored `open_note` replayed every time the pane mounted, opened the
note, the note took focus, the pane unmounted, forever. The tool was perfect;
remembering it was the bug. Events now go through `signal()`, the distinction
lives in an exported `EPHEMERAL` set rather than in a comment, and `replay()`
filters it a second time. Two tests hold the line.

**Not in this pass, deliberately:** agent-proposed diffs painted word-level in
the editor with accept/reject. That is a `ToolCallContent` rendering feature,
not MCP, and it touches the editor, the transcript renderer and the write path
— its own phase.

**Still thin, and worth saying plainly:** "choosing the view" is not yet real.
`focus_graph` aims the only view there is. The tool surface is shaped so a
second idiom — the treemap in `future-work.md` — is a new tool and a new tab
type, not a redesign. Until then the agent picks *where to look*, not *how to
look*.

### Phase 6 — Retire the pty ✅ done (2026-08-21)

`lib/termSessions.ts`, `components/TerminalPane.tsx`,
`components/terminalBridge.ts`, `app/terminal/` and `app/api/terminal/` are
deleted, along with the masthead button and the WebSocket server that backed
them. No raw shell survives as an escape hatch: a half-kept surface is the one
that rots, and everything the terminal was reached for now has a typed path.

`node-pty` initially stayed, for exactly one thing — the embedded
authentication terminal that Phase 3 proved is unavoidable, since a
`type: "terminal"` auth method is by contract an interactive process and Claude
Code offers nothing else. Phase 6c removes it.

Two things fell out of the removal:

- **The agent WebSocket moved from `port + 2` to `port + 1`**, taking the
  terminal's slot instead of leaving a hole.
- **A latent bug in `electron/main.js` is fixed.** The port scanner reserved
  two consecutive ports while the server bound three. It survived by accident:
  a second window's probe collided with the first window's unreserved third
  port and skipped ahead. The count is now a named constant next to the reason.

⌘T, which opened a terminal, opens a chat.

### Phase 6b — One chat, many harnesses ✅ done (2026-08-21)

Not in the original plan; asked for once the six phases made it possible.

The harness used to be frozen into the tab id at creation
(`chat:<agent>:<suffix>`), which was correct while it could never change. It
meant comparing two harnesses on one question took two tabs and retyping the
question, and it meant the picker had to be answered *before* seeing anything.

Now the tab id is the conversation (`chat:<suffix>`) and the harness is a
dropdown at the head of the chat bar, in front of the model, mode and effort
controls the agent announces for itself. **Switching loses nothing**: each
harness keeps its own live session under the same tab, keyed
`<tab>::<agent>`, so going back finds it exactly where it was, mid-turn
included. Harnesses start lazily — opening the dropdown does not spawn seven
processes — and closing the tab kills every session under it via
`DELETE /api/acp?prefix=`, so trying a second harness cannot leak an orphan.

Two details that are load-bearing:

- **The selection lives in `localStorage`, not React state**, because it has to
  survive exactly what the tab id survives: reload, workspace restore, and
  being dragged to another pane (which unmounts and remounts the component).
- **Old ids still work.** `chat:<agent>:<suffix>` is parsed for its middle
  segment and used as that tab's initial harness, so upgrading does not silently
  move anyone onto a different agent.

The ingest wizard passes an explicit `agent` prop, which hides the picker: it
has its own harness step, and two controls contradicting each other on screen is
worse than either.

### Phase 6c — Delete node-pty ✅ done (2026-08-21)

Phase 6 left one PTY behind, for interactive sign-in. The question that killed
it: *does the interactive process have to run **inside** the app?*

It does not. A `type: "terminal"` method is a command the client is told to run
as an interactive process — and the user already owns a terminal that runs
interactive processes correctly. So the app now **shows the command, offers to
open it in the system terminal, and asks again when you come back**. That is
not a workaround invented to shed a dependency: OpenCode's own auth method
describes itself as *"Run `opencode auth login` in the terminal."*

What the audit found before deciding, since the plan asserted this was
impossible:

| agent | auth methods | needs a PTY |
|---|---|---|
| Claude Code | `claude-ai-login`, `console-login` — **both terminal** | yes |
| Codex | `api-key`, `chat-gpt` — neither | no |
| OpenCode | `opencode-login` — not terminal | no |
| Hermes | `openai-codex` plus a terminal `--setup` | no, has a fallback |

So one agent needed it, it was the default one, and the flow it needed is
inherently external. What went:

- `node-pty` (63 MB, native, per-platform prebuilds), `@xterm/xterm` and
  `@xterm/addon-fit` (6 MB),
- the `postinstall` that chmod-repaired node-pty's `spawn-helper`,
- five wire messages (`terminal-auth`, `-input`, `-resize`, `-output`,
  `-ended`) collapsed into two (`auth-launch`, `auth-manual`),
- the `AuthTerminal` component and its `authTerminal` streaming state.

`src/acp/launchTerminal.ts` opens Terminal.app via a temporary `.command` file
on macOS, `cmd /k` on Windows, and the first of seven known emulators on Linux.
**Opening is the convenience; the command is the mechanism** — it is always
shown, copyable, so a desktop where nothing could be opened still has a way
through. That is why the launcher returns a boolean instead of throwing.

**Verified**: Terminal.app opened and ran the command with its env; the real
command for Claude Code resolves to the absolute binary plus `--cli auth login
--claudeai`; quoting survives spaces, embedded single quotes and env vars
(tested); and the app runs, chats and drives MCP tools with the package gone.

Two honest costs. Sign-in now takes one trip out of the app, once per machine,
on the screen `ROADMAP.md` calls the narrowest gate. And the app cannot see
whether the login succeeded — there is no exit code to wait on — so the user
says when to re-check, which relaunches the agent so it re-reads credentials
from disk rather than trusting a process that started before they existed.

---

## Open questions

To research before the phase that depends on them — not blockers on starting.

- ~~**Does any target agent require `terminal: true`?**~~ **Answered in Phase 2:
  no — and stronger, none of the agents tested even *uses* it.** With
  `terminal: true` advertised and all five methods answered, Hermes and OpenCode
  both ran their shell commands themselves and reported the output as `content`
  blocks. So the capability is not load-bearing for these two, and the variant
  the reference client drops is the one that carries the output. The capability
  stays implemented (`src/acp/terminal.ts`, tested) because an agent that does
  take it at its word must find it working, and because live output plus a kill
  switch is only possible when the app owns the process. Untested: whether the
  Claude and Codex adapters prefer it — neither is installed here.
- ~~**Does `configOptions` cover every agent?**~~ **Answered — and the Phase 1
  answer was wrong.** OpenCode announces `model` (364 options) and `mode` (2).
  Hermes announces `configOptions: null`, and Phase 1 concluded from that alone
  that it "announces nothing" and picks its model out of band with
  `hermes model`. **It does not.** Hermes 0.20.5 sends **twelve models and
  three modes** through the deprecated `models`/`modes` fields of
  `session/new`, right next to the null. Phase 1 looked through one window and
  reported the room empty. The user caught it by comparing the app against the
  Hermes TUI, which shows the model on its first screen.

  So the last part of that question — *"whether any agent still sends only the
  deprecated APIs"* — answers itself: **yes, and it is the default agent.**
  See "Reading the old APIs" below. The UI must still handle an agent with
  genuinely nothing to announce, which is why `configHint` survives unused.
  *(Phase 3.)*
- ~~**Which error means "you need to log in"?**~~ **Answered at the protocol
  boundary.** JSON-RPC `-32000` is authentication-required. Other failures are
  presented as failures, with advertised sign-in methods offered only as
  recovery options. Provider-specific logged-out verification remains in the
  release matrix.
- ~~**Does a terminal auth flow actually need a pty?**~~ **Answered by the ACP
  contract.** A `type: "terminal"` method is an interactive process, and the
  implementation uses an embedded PTY. `node-pty` therefore survives Phase 6
  unless another real PTY implementation replaces it.
- **How do agents behave when `fs` capabilities are advertised?** The reference
  plugin declines them, so there is no worked example to copy. Establish which
  agents route their file I/O through the client and which ignore the
  capability and touch disk anyway. *(Phase 4.)*

---

## Decided

### Onboarding: guided install, not bundling

**Only two of seven agents need a separate adapter.** Claude Code
(`claude-agent-acp`) and Codex (`codex-acp`) are npm packages; the other five
speak ACP natively as a subcommand or flag — `gemini --experimental-acp`,
`opencode acp`, `kiro-cli acp`, `hermes acp`, and `vibe-acp` shipped with
Mistral Vibe. Native support is the direction of travel, so this surface
shrinks over time rather than growing.

npm packages still require installing. Three options were considered:

1. **Bundle the adapter as an app dependency.** Technically possible — Electron
   ships Node. **Rejected:** `claude-agent-acp` implements its ACP agent *by
   using the official Claude Agent SDK*, not by shelling out to the `claude`
   CLI. Bundling it means the app ships a model SDK, which is precisely what
   `ROADMAP.md` promises it will not do. It also ties the app's release cycle to
   SDK versions, and does not remove the setup step anyway: the SDK still needs
   the user's credentials.
2. **`npx -y @agentclientprotocol/claude-agent-acp`.** No install step for the
   user; fetched on first use and cached. Costs a network round-trip on first
   run and needs a Node runtime resolvable outside the app bundle — the
   reference plugin already solves that half with `resolveNodeDirectory`
   (`src/utils/paths.ts`). Worth offering as a fast path.
3. **Guided install.** The app detects the adapter is missing, offers the
   one-line command, and verifies. This is what the reference plugin does, and
   it matches the existing `INSTALL` table's intent.

**Decision: (3) as the default, with (2) as an opt-in fast path.** *Both are
built as of 2026-08-21 — see Phase 2.* This keeps
the `ROADMAP.md` guided-setup item intact — it just has to install the adapter
for two agents rather than a CLI for all of them, and nothing at all for the
other five.

Still to verify: whether the Claude subscription path (as opposed to
`ANTHROPIC_API_KEY`) requires the `claude` CLI to be installed and logged in for
the SDK to find stored credentials. If so, the guided flow for Claude Code is
two installs, not one.

### Session storage: the agent keeps it, and no fallback was needed

*Built 2026-08-23.* Reopening past conversations asks the agent —
`session/list` to enumerate, `session/load` to reopen — and Summa keeps **no
record of its own**.

The earlier plan here assumed a fallback would be needed and picked where it
would live: app settings, never the vault, because a session index is
application state about conversations rather than knowledge, and notes nobody
wrote would pollute the index and the graph. That reasoning still holds if the
fallback is ever built. **It was not, because the case did not appear.** Every
harness installed at the time advertised both capabilities:

| Harness | version | `loadSession` | `sessionCapabilities.list` | also |
|---|---|---|---|---|
| Claude Code | 0.70.0 | ✓ | ✓ | `delete`, `fork`, `close`, `resume` |
| Codex | 1.6.2 | ✓ | ✓ | `delete`, `close`, `resume` |
| OpenCode | 1.18.21 | ✓ | ✓ | `fork`, `close`, `resume` |
| Hermes | 0.20.5 | ✓ | ✓ | `fork`, `resume` |

Asking the agent is better than a local index on three counts, and they are the
reason not to add one "just in case":

- **It includes conversations Summa never saw.** The ones started in the
  harness's own CLI are in the same list. A private index could only ever show
  the app's own.
- **It cannot go stale.** Delete a conversation from the CLI and it is gone
  from the menu; a mirror would have to notice.
- **There is nothing to migrate.** No schema, no file, no cleanup when a chat
  tab is closed.

Two things follow from it, both visible in the code:

- `canList` travels on the `ready` message rather than being written into
  `ACP_PRESETS`. It is a property of the **installed version**, not of the
  preset — one harness upgrade would make a table lie in either direction.
- The listing is **ephemeral** (`EPHEMERAL` in `lib/acpSessions.ts`). It is the
  answer to a question asked at a moment, and agents keep creating sessions
  from their own CLI while the app is open; replaying a two-hour-old list on
  reconnect would show a menu that is confidently wrong.

Loading reuses the running process: `session/load` switches which session the
open connection is talking to, so returning to last week's conversation costs
the replay, not a cold start. The agent re-sends the whole conversation as
ordinary `session/update` notifications, which means the transcript reducer
rebuilds it without knowing it is history — no separate replay path exists.

Not built, and worth considering later: `session/delete` (three of the four
support it), and `session/close` for the empty session that `session/new`
leaves behind each time a chat tab opens and immediately loads something else.

---

## Related: the ambient case

Distinct from everything above, and requiring no app changes at all.

An ACP client covers the case where the user is present. The litmus test in
`CLAUDE.md` is the opposite one: *"while I'm not at my desk, my AIOS observes
one real-world event and produces an output."* Nothing in the app wakes up on
its own.

Hermes Agent covers that shape — a daemon with cron jobs wired into its
permission machinery, memory as `MEMORY.md` / `USER.md` on disk, skills
compatible with the agentskills.io standard (the same format as the vault's own
skills), and messaging-platform adapters for capture away from the desk.

It integrates through **files**, not through the app: it runs over the same
vault folder, and Summa Wiki reads what appears. Worth testing separately and
first, since it costs no app changes and answers a different question — whether
unattended agent output is actually useful, or noise that has to be cleaned up
each morning. The `<!-- ai -->` provenance convention is what makes that
auditable either way.
