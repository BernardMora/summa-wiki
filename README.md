<h1 align="center">Summa Wiki</h1>

<p align="center">
  A desktop encyclopedia for your own notes.<br>
  Point it at a folder of Markdown files and read them like a reference work — not like a file tree.
</p>

<p align="center">
  <a href="https://github.com/BernardMora/summa-wiki/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/BernardMora/summa-wiki?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-lightgrey?style=flat-square">
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Summa Wiki: front page, search, and an article with its backlinks" width="820">
</p>

## Download

Grab the file for your platform from the [latest release](https://github.com/BernardMora/summa-wiki/releases/latest):

- **macOS** — `.dmg` (Apple Silicon and Intel builds are separate; pick the one for your Mac)
- **Windows** — the `.exe` installer
- **Linux** — `.AppImage` (run it anywhere) or `.deb`

There is nothing to install alongside it. The app ships its own runtime, so you do
not need Node.

> **The builds are not code-signed yet.** On macOS, right-click the app and choose
> *Open* the first time, or Gatekeeper will refuse it. On Windows, SmartScreen shows
> a warning — choose *More info → Run anyway*. Signing certificates are on the
> roadmap; until then this is the honest state of things.

## What it is

Summa Wiki reads a folder of Markdown files — a *vault* — and presents it as an
encyclopedia: a front page with the subject index, a masthead search, a categorized
sidebar, and articles that carry their own backlinks. Nothing is uploaded, nothing
is bundled into a service. It reads the files on your disk and writes them back.

It exists because a folder of notes stops being navigable somewhere around two
hundred files. A file tree tells you where something is filed; it never tells you
what you know.

- **Search that answers in milliseconds.** One index over the whole vault, with
  filters by type, topic, author, tag and date, and a `--why` flag that shows you
  why a result matched.
- **The graph, made useful.** Backlinks on every article, a neighbourhood view, and
  an orphan list of notes nothing links to.
- **Categories are rules, not lists.** A note is filed by what it *is* — its
  frontmatter, its folder, its tags — so writing a note files it, with no
  maintenance. A note can sit in several categories at once.
- **Edit in place.** A Markdown editor with syntax highlighting, a PDF reader, a
  canvas viewer, and an integrated terminal, all against the same vault.
- **Built for working with an agent.** The same index the app reads is the one an
  LLM reads, and edits made by an agent are marked as such, so you never lose track
  of who wrote which paragraph.
- **Bring your own structure.** Ships three information-architecture packs and can
  scaffold a brand-new vault from any of them. The shape of a vault is data, not
  code.

## First run

The app asks for a folder the first time you open it. Either point it at Markdown
notes you already have, or let it create a new vault from one of the bundled
architectures — it writes the folders, the hub articles and the config for you.

Your vault stays yours: Summa Wiki keeps its own state in a `.summa/` directory at
the vault root and never reorganizes your files behind your back.

## The command line

The same index powers a CLI, useful on its own and the fastest way to let an agent
search your notes:

```
wiki search <query> [--type --pillar --author --tag --since --limit --why]
wiki show <slug>            metadata, links, backlinks, provenance
wiki related <slug> --depth 2
wiki orphans                notes nothing links to
wiki health                 validate the vault against the spec
wiki tree [path] [--depth N --titles]
wiki index                  rebuild the index
```

Set `WIKI_VAULT` to point it at a vault without touching the app's settings.

## Build from source

Requires Node 22.6 or newer.

```
git clone https://github.com/BernardMora/summa-wiki.git
cd summa-wiki
npm install
npm run dev          # http://localhost:4321
npm run desktop      # the Electron shell
```

To produce installers for your own platform:

```
npm run package:mac      # or package:win, package:linux
```

Each of those builds, packages, and then runs a smoke test against the *packaged*
artifact — the class of bug that only appears after installing. Releases are built
for all four targets by GitHub Actions on a version tag; see
[`.github/workflows/release.yml`](.github/workflows/release.yml).

## Documentation

- [**Architecture**](docs/architecture.md) — the vault format, the indexer, categories,
  bundles, ingest, and the reasoning behind each decision.

## Contributing

Issues and pull requests are welcome. Two things worth knowing before you open one:

- Code comments in this repository are in Spanish and explain *why*, not *what*.
  Keep that habit — a comment that restates the code is noise, one that records the
  constraint that forced the code is the reason the file is readable a year later.
- If you change what goes into the package, run `npm run smoke` on every platform
  you can reach. Packaging bugs are invisible to tests that run on the source tree.

## License

MIT — see [LICENSE](LICENSE). Use it, ship it, sell it, fork it.
