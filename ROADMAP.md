# Roadmap

Where Summa Wiki is going, at the level of themes. Individual work lives in
[issues](https://github.com/BernardMora/summa-wiki/issues); this file says which
issues belong together and why they matter.

**Summa Wiki reads a folder of Markdown files on your disk and presents it as an
encyclopedia.** Everything below is filtered through that: the vault is plain
files, the app is a reader and an editor over them, and nothing leaves the
machine. A feature that requires a service, an account or a network round-trip is
not a small version of this product — it is a different one.

## How to read this

- **No dates.** Themes move between sections as work lands. A milestone carries
  the one date that exists.
- **No task checkboxes.** A checkbox here would be a second backlog, and it would
  disagree with the issues within a week.
- **"Background" links to [`docs/future-work.md`](docs/future-work.md).** That
  document holds the research behind a theme — the constraints found, the numbers
  measured, the approaches that will not work and why. It is the thinking a theme
  rests on, not a list of rejected ideas. Read it before starting anything it
  covers.

---

## Now

The current season. ⟨milestone link⟩

### A stranger installs it and it works

The first-run experience is the product's narrowest gate. Someone who has never
seen the project should get from a release file to a searchable vault without
asking anyone anything — and today they cannot, because the app warns them it
might be malware before it opens.

Unsigned builds are the number one source of friction: macOS routes people
through *System Settings → Privacy & Security*, and Windows shows SmartScreen.
Apple Developer is 99 USD/year; Azure Trusted Signing requires a business entity
three or more years old, so Windows may need a different answer than macOS.

- Code signing and notarization for macOS ⟨issue⟩
- A signing answer for Windows, or a documented interim story ⟨issue⟩
- Onboarding does not appear on Windows on first run — [#9](https://github.com/BernardMora/summa-wiki/issues/9)
- Port conflict on startup — [#10](https://github.com/BernardMora/summa-wiki/issues/10)
- A getting-started page that assumes nothing ⟨issue⟩
- `docs/release-checklist.md`, so a release can be verified on a platform the
  author does not develop on ⟨issue⟩

**Done when:** someone who has never seen the project downloads a release on
macOS, Windows and Linux, opens it with no security detour, points it at a folder
and searches it — with no help from anyone.

**Background:** the CI already wires the signing secrets; they do not exist yet.
See *Smaller items* in [`docs/future-work.md`](docs/future-work.md).

### Using an agent in your vault takes no setup and no terminal

The strongest thing this app has is that an agent can read and write a whole
vault of plain files, on your machine, with no service in between. It is also the
part with the most friction: today it means installing a CLI yourself, having an
account with a provider, and knowing what to type into a terminal pane. Everyone
who has already done that finds it obvious. Nobody else gets past it.

Frictionless here is constrained by a promise the app does not break: **there is
no model SDK and no API key in the app.** The agent runs on the user's own
harness, with the user's own account. So this theme is not "add AI to the app" —
it is removing every step between opening a vault and getting an answer out of it,
without the app becoming a client for someone's API.

- Guided agent setup during onboarding: when no harness is found, walk the user
  through installing one — command, verification, a working first prompt — instead
  of showing an empty dropdown ⟨issue⟩
- Entry points where the reading happens: ask about this article, this selection,
  this search result. The app composes the prompt and the context; the user writes
  a question, not a command ⟨issue⟩
- The vault's skills as a visible surface. They exist in `.agents/skills/` and are
  invisible unless you know to look ⟨issue⟩
- Answers land back in the vault as notes, with `<!-- ai -->` provenance markers
  and `author:` written by the app rather than by whatever the agent remembered to
  do ⟨issue⟩
- Created and modified files return as visual artifact cards — preview, change
  summary or diff, provenance, and an action that opens the durable vault file —
  instead of disappearing into the file tree ⟨issue⟩
- Permissions stated in the interface in plain language — what the agent may read
  and write, before it runs, not as a flag ⟨issue⟩

**Done when:** someone who has never opened a terminal installs the app, and
within the first session asks a question about their own notes, gets an answer
that cites them, and can inspect and open the note the agent produces — without
typing a command, hunting through the file tree or reading documentation.

**Background:** `src/agents.ts`, `components/agent-session.ts` and `src/skills.ts`
carry the detection and the skill adapters, and the constraints already learned
there are worth reading before designing anything on top: detection of all four
harnesses is deliberately a single shell invocation, the interface id is not
always the binary name, models are never invented when a catalogue cannot be
queried, and the canon for skills is `.agents/skills/` with a symlink to
`.claude/skills/`. See also *Agent output: a file should arrive as an artifact,
not disappear into the vault* in [`docs/future-work.md`](docs/future-work.md).

### ⟨third theme, if the season has room⟩

⟨A season holds one or two themes, not five.⟩

---

## Next

Themes with enough thinking behind them to start, not yet scheduled.

### The vault answers more than one question

The graph view is a hand-written force-directed canvas, and it is a good
implementation of exactly one visualization idiom — the same one nearly every
ontology tool has shipped for twenty years. It answers "what is connected to
what" and structurally cannot answer "where is this dense", "which categories does
this note belong to at once", or "what kind of relation is this edge".

The index already carries data the canvas never draws: `words`, `pillar`,
`updated`, orphan status. Ordered by insight per unit of work:

- Use the retinal channels already on the canvas — `updated` as opacity, `pillar`
  as shape, orphan status as a ring. No new view, no new data, no new endpoint ⟨issue⟩
- A treemap by pillar → type → note, which answers the density question and needs
  no simulation ⟨issue⟩
- An indented tree keyed on `pillar:` / `type:`, distinct from the filesystem tree ⟨issue⟩
- Coordinated views: selection in one view highlights in the others ⟨issue⟩

**Done when:** ⟨falsifiable sentence — e.g. "a reader can answer 'where is my
vault dense?' without leaving the app"⟩

**Background:** *Representation: the graph view is one idiom out of many* in
[`docs/future-work.md`](docs/future-work.md), plus the field guide to fourteen
idioms in [`docs/research/ontology-representations.html`](docs/research/ontology-representations.html).
Note the constraint: no graph library, because the CLI runs the same modules with
`node --experimental-strip-types` and no install step.

### Getting content in

Two requests keep arriving in different disguises: "drop a PDF in and walk away",
and "point at my Google Drive folder". Both have been investigated and both have a
smaller honest version that is worth shipping before the large one.

- Treat a cloud folder as a **source to ingest from**, not as part of the vault —
  the setup wizard's sources step already copies files in ⟨issue⟩
- A cross-platform OCR path, which likely means ONNX or GGUF rather than MLX, and
  accepting worse per-page quality for a feature that exists on all four targets ⟨issue⟩

**Done when:** ⟨falsifiable sentence⟩

**Background:** *Ingest: local OCR* and *Ingest: cloud folders in a vault* in
[`docs/future-work.md`](docs/future-work.md). The OCR spike is measured (35–79
seconds per page on Apple Silicon), and the cloud-folder section lists four
distinct failure modes — on-demand files, sync conflicts, `.summa/` churn,
unreliable file watching — that any design has to answer.

### First run is not empty

Every feature in the app is data-driven: the graph, the category rules,
backlinks, search, the renderers keyed to `type:`. An empty vault demonstrates
none of them, because they are emergent properties of content.

The proposal is one optional showcase vault offered on first run — real files a
user can open, break and delete. Its content is a specification, not a writing
task: it needs a dense hub and a sparse periphery, a genuine orphan, a note in two
categories at once, every `type:`, notes with each `author:` value, a run of daily
notes.

- ⟨issue⟩

**Done when:** ⟨falsifiable sentence⟩

**Background:** *Onboarding: a showcase vault* in
[`docs/future-work.md`](docs/future-work.md). Two constraints from there matter
for scheduling: it must be run against `wiki health` and the indexer **in CI**, or
it silently drifts from the spec it exists to demonstrate; and it should be built
after the feature set stops moving, because every new feature adds a required
exhibit.

---

## Later

Real, wanted, and not ready to start — either because something has to exist
first, or because the cost is large enough that it needs a reason beyond "it
would be nice".

### Typed edges

Today `/api/graph` emits untyped links, so "cites", "is part of", "contradicts"
and "mentioned once in passing" all render as the same line. This starts as a
**format** change, not a rendering one: there is nowhere in `schema-spec.md` to
put a relation type. Do not start with the UI.

### Plugins

Three layers with very different costs. The agent layer is mostly built — the
vault already writes skills the app picks up. The server layer is cheap: plain JS
modules in the server child process. The UI layer is the expensive one, and the
reference is Obsidian rather than a plugin framework: the pre-compiled shell
declares mount points, a plugin gets a DOM node and an API and owns that subtree.
There is no compiler in the shipped package, on purpose.

First step, when the time comes: write **one** throwaway plugin against the app as
it stands and find where it chafes. A contract designed without plugins using it
gets designed wrong.

Non-negotiable if built: plugins load in the server child process, never the
renderer with Node integration; explicit per-plugin opt-in; a manifest declaring
what a plugin touches.

### Publishing the CLI to npm

Declined as a *launch channel* — one channel, the installers on GitHub Releases —
but it has a narrow real use: letting an agent reach a vault from outside the app.
If plugins are ever built, a separately versioned `@summa-wiki/plugin-api` package
becomes necessary, or every app release breaks every plugin.

### ⟨your items here⟩

---

## Foundations

Invisible to users, real for anyone working on the codebase. These do not get
their own season; they get done when they block something.

- **`src/config.ts` resolves the vault at import time**, so importing the module
  has filesystem side effects. A build should be hermetic. Made lazy, it touches
  ~40 call sites that import it as a value.
- **`next build` fails on Windows** with an `EPERM` glob over a legacy junction.
  Sidestepped by building web assets once on Linux, which is better anyway. If
  Next ever has to run on Windows again, this is unfinished.
- **`asar: false`** costs install time and file count. Enabling it requires moving
  Next's runtime writes to `userData` first.

---

## Out of scope

Not "later". These are the exclusions that define the app, and each one has
already saved a discussion more than once.

- **A sync engine.** A live mirror of a cloud folder is the feature people picture,
  and writing one is a larger project than the app it would live in. Ingest, yes;
  sync, no.
- **Telemetry.** The app does not phone home. Download counts come from the GitHub
  Releases API, not from anything running on a user's machine.
- **Model SDKs and API keys shipped in the app.** AI enters through the agent CLIs the user
  already has installed, running in the built-in terminal with the user's own
  account. This is what makes "everything stays local" true.
- **A database.** The index is a derived, regenerable `index.json`. It is not
  versioned and it is not a source of truth.
- **A graph library.** The simulation is ~40 lines by hand so the CLI can run the
  same modules with no install step.
- **Any feature that requires an account or a connection.** Summa Wiki opens a
  folder on your disk and works offline — all of it, not a reduced version of it —
  and that does not change.

---

## Changing this file

A theme moves sections in a pull request, like anything else. If a theme has been
in *Now* for two seasons, it was not a theme — it was a wish, and it should be cut
or split. Proposals for new themes belong in an issue or a discussion first; this
file records what was decided, not what is being argued about.
