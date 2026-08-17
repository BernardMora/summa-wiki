# Architecture

Why Summa Wiki is built the way it is. Every section here records a decision and
the constraint that forced it — read this before changing the indexer, the
packaging, or the shape of the vault.

For installing and using the app, see the [README](../README.md).

The index is the single artifact consumed by *both* the app and the agent. This is
deliberate — it is what replaces "fancy RAG". At ~256 notes the LLM reads what it
needs once the index points it at the right files.

## Usage

```bash
./bin/wiki index                       # rebuild index.json
./bin/wiki search <query> [filters]    # ranked search
./bin/wiki show <slug>                 # metadata, links, backlinks, provenance
./bin/wiki related <slug> --depth 2    # graph neighbourhood
./bin/wiki orphans                     # notes with no inbound links
./bin/wiki health [--all]              # spec section 9 validation
./bin/wiki stats
```

Search filters: `--type --pillar --author --bundle --tag --since --limit`,
plus `--why` (show why it matched) and `--excerpt`.

No install step and no dependencies — Node 22's `--experimental-strip-types` runs
the TypeScript directly. TypeScript rather than Python so the app imports the same
indexer instead of a second implementation drifting from the first.

## Configuration

The vault path is configuration, never a constant — that is what lets the system be
pointed at someone else's vault (spec section 8). It resolves in this order:

1. **`WIKI_VAULT`** — one command points the CLI or server elsewhere without touching
   saved settings. What scripts use.
2. **The vault picked in the app**, stored per machine, outside any vault — you need
   it before you have one. macOS: `~/Library/Application Support/Summa Wiki/settings.json`.
   Pick one with *Archivo → Abrir vault…* (⌘⇧O) or the Vault section of the settings panel.
3. **`~/Documents/aios` if it exists** — the pre-Phase-11 hardcoded default. The
   existence check is what stops a new user from inheriting a path that is not theirs.

With none of the three, the app says so and offers the picker instead of rendering an
empty encyclopedia.

`WIKI_INDEX` overrides where `index.json` is written (default `<project>/index.json`).

`src/appdata.mjs` owns that resolution. It is plain JavaScript because both readers need
it and only one of them can read TypeScript: Electron's main process runs without
`--experimental-strip-types`. It used to be copied by hand into `electron/main.js`.

### State the app keeps inside the vault

`.summa/config.json` (name, tagline, icon), `.summa/categories.json`, `.summa/pdf-state.json`.

A fixed dot-directory at the vault root, not `04-Sistema/`, because that folder belongs
to *one* information architecture — this vault's. Config for the app cannot live in a
folder the app itself lets you choose. Migration from the old location is automatic and
happens by rename, so no copy is left behind to drift.

## Bundles

Declared by the architecture, not by code. This vault's:

| id | root | shared |
|---|---|---|
| `personal` | the vault | no |
| `veridia` | `01-Hacer/01-veridia` (symlink to Drive) | yes, with the team |

A declared bundle whose folder is not on disk is dropped at load — otherwise the
graph offers a filter that always returns nothing and never says why.

Links crossing bundles use `aios://<bundle>/<path>` and are never reported as
broken — the reader may legitimately lack access to the other side.

## What is excluded

Whatever the architecture lists under `indexShallow` (here `05-Projects/*/`:
1,524 of its 1,526 markdown files are `node_modules` READMEs), dot-directories,
agent/repo docs (`CLAUDE.md`, `AGENTS.md`, `README.md`) and `.excalidraw.md`
payloads. Obsidian ignores dot-directories by convention; this indexer inherits
no such convention and must exclude them explicitly.

## Categories

A category is a **rule**, not a list. It matches on `pillar`, `bundle`, `paths`,
`types` or `tags`, plus hand-pinned ids for what a rule cannot express — so
writing a note under `02-Saber/fisica/` or tagging it `libro` files it with no
maintenance. **A note may belong to several at once**; nothing claims a note away
from the next category.

Live rules and pins live in `.summa/categories.json` (version 2, in the vault so
they travel with it). The *seed* comes from the architecture, not from code;
`lib/categories.ts` migrates, `lib/nav.ts` evaluates.

Excluded from categorisation: whatever the architecture declares under
`articles` — plus `_index.md`, ISO-named dailies, and the núcleo articles, which
get their own section on the front page and a badge on the article.

Anything no rule catches lands in *Sin categoría*, which is the backlog of
categories and tags still missing.

## Information architecture

The shape of the vault is **data**, not code: `.summa/architecture.json`. It
declares the bundles, the hub articles and what hangs off each one, the top-level
folders and their purpose, what is not an article, what is never categorised, and
the category seed.

Until Phase 12 all of that was TypeScript — five predicates in `lib/identity.ts`,
23 categories in `lib/categories.ts`, two bundles and a regex in `src/config.ts`,
a table in the JSX. That works perfectly for one vault, and makes "choose an
architecture" impossible to build as a feature: it would be a fork.

`src/architecture.ts` holds the contract; `src/architectures/` holds the packs
(`identidad`, `para`, `plano`) and the loader. A vault that declares nothing gets
`identidad`, written into `.summa/` on first run so it can be edited.

**Creating a vault** (`/setup`, shown when no vault is configured) writes the
chosen pack's folders, hub articles, per-folder `CLAUDE.md`/`AGENTS.md` and
`.summa/`. All of it is *generated from the pack* — `src/scaffold.ts` reads the
contract, so adding an architecture means declaring it, not writing six articles
and four context files by hand.

Path matching is one rule everywhere (`src/match.ts`, no `node:fs` so clients
share it): a path matches if it **equals** the pattern or **starts with** it.
Trailing slash means folder, no slash means exact file. No globs — the five
original predicates were all disjunctions of those two forms.

## Ingest

Bringing outside folders into the vault, in two halves. The app **copies**; the
agent **files**.

A deterministic pre-pass runs before the model sees anything: `node_modules`,
`.git`, hidden files, binaries, anything over 100 MB, empty files, and exact
duplicates (sha1) never reach it. Only what needs reading to decide does — the
measured lesson from Phase 6 stage A, applied before spending.

Everything lands in the architecture's `inbox`, keeping the source folder
structure. Sorting it during the scan would be guessing: a path does not say
whether a document is a project or a reference.

Originals are never moved or deleted. `.summa/ingest-<ts>.json` records what came
from where — that ledger is both the undo and the audit.

The agent runs the `vault-ingest` skill, written into the vault at
`.claude/skills/` and regenerated per ingest from the live architecture, so it
carries that architecture's `routing` rules. `claude` is located by asking a
**login shell**, not this process's PATH — a Dock-launched app would otherwise
miss a Homebrew or nvm install and tell someone to install what they already have.

## Layout

```
src/types.ts        index shape shared by app and CLI
src/appdata.mjs     machine-level settings; vault resolution (plain JS: Electron reads it too)
src/architecture.ts the information-architecture contract + the built-in pack
src/match.ts        path matching and **bold** splitting; no node:fs, so clients share it
src/architectures/  the shipped packs + the loader
src/scaffold.ts     writes a new vault from a pack
src/config.ts       vault path, .summa/ paths, bundles, exclusions
src/indexer.ts      walk, parse frontmatter, extract links, resolve, backlinks
src/search.ts       ranked search, graph neighbourhood, health checks
src/cli.ts          command line entry
bin/wiki            wrapper script
```

`index.json` is gitignored: it is derived, and rebuilding takes ~250ms.
