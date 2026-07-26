# Berni's Wiki

Local reader/editor and indexer for the AIOS knowledge base.

**Phases 0-4 done.** Indexer, CLI, and a local Next.js reader/editor styled as an
encyclopedia: masthead search, categorized sidebar, article tabs, portal main page.

    npm run dev     # http://localhost:4321

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

| Env var | Default |
|---|---|
| `WIKI_VAULT` | `~/Documents/aios` |
| `WIKI_INDEX` | `<project>/index.json` |

The vault path is configuration, never a constant — that is what lets the system be
pointed at someone else's vault (spec section 8).

## Bundles

| id | root | shared |
|---|---|---|
| `personal` | the vault | no |
| `veridia` | `01-Pillars/01-Veridia/veridia-drive` | yes, with the team |

Links crossing bundles use `aios://<bundle>/<path>` and are never reported as
broken — the reader may legitimately lack access to the other side.

## What is excluded

`05-Projects/*/` (1,524 of its 1,526 markdown files are `node_modules` READMEs),
dot-directories, repo docs (`CLAUDE.md`, `README.md`, …), and `.excalidraw.md`
payloads. Obsidian ignores dot-directories by convention; this indexer inherits
no such convention and must exclude them explicitly.

## Layout

```
src/types.ts     index shape shared by app and CLI
src/config.ts    vault path, bundles, exclusions
src/indexer.ts   walk, parse frontmatter, extract links, resolve, backlinks
src/search.ts    ranked search, graph neighbourhood, health checks
src/cli.ts       command line entry
bin/wiki         wrapper script
```

`index.json` is gitignored: it is derived, and rebuilding takes ~250ms.
