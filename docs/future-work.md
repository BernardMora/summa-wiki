# Future work

Decisions that have been *thought through* but deliberately not built. Each entry
records the reasoning so the next person — or the next session — does not have to
rediscover it. Nothing here is a commitment.

## Extensibility: plugins

The question that started this: DeepSeek Harness ([dsh](https://github.com/deepseek-ai/deepseek-harness))
ships an architecture where *everything is a plugin*, and demos a flow where a user
asks the agent for a new capability and gets one. Could Summa Wiki do the same?

Yes, but not by copying dsh, and the reason is a constraint we chose on purpose.

### The constraint: there is no compiler in the package

Next.js compiles routes and React components at build time, and the shipped app
excludes `@next/swc` (124 MB — see `electron-builder.yml`). **A plugin therefore
cannot ship a React component and have it appear in the UI.** Nothing in the
installed app knows how to compile one.

This is not an accident to be undone. Putting the compiler back costs 124 MB in
every download to support a feature that does not exist yet.

Worth noting: dsh has the same shape of answer. Its plugins do not inject UI
either — they register `ConversationNodeDefinition` objects and keyed renderers
that paint from an event log. The extensible UI is a *declarative contract*.

### Three layers, very different costs

**Agent layer — mostly already built.** The vault writes the `vault-ingest` skill
into `.claude/skills/`, regenerated per ingest from the live architecture.
`findClaude()` already locates Claude Code, and the terminal pane already hosts it.
"Ask the agent for something new and get a plugin" is close to reachable today: the
agent writes a skill file, the app picks it up. This is the shortest path to the
demo that prompted the question.

**Server layer — cheap.** New CLI commands, `/api` routes, indexer hooks, handling
for new `type:` values. Plain JS modules loaded at runtime by the server child
process. No compilation. This is where dsh's model maps over directly.

**UI layer — expensive, and the one that matters.** Summa Wiki is a UI product; the
terminal exists so different agent harnesses can be plugged in, not because the CLI
is the deliverable. So the layer to eventually pay for is precisely the expensive
one.

The reference here is **Obsidian**, not dsh: a UI product over a Markdown vault,
a large plugin ecosystem, and no compiler in the app. Its plugins are pre-bundled
JS that talks to an API and to DOM nodes — never to the component tree.

Translated to this codebase: the Next shell stays pre-compiled and declares **mount
points** (a sidebar slot, an article panel, a renderer per `type:`). A plugin gets a
DOM node and an API and owns that subtree. With React that is a `div` with a `ref`;
it does not fight the App Router and it compiles nothing.

### What extensibility already exists

Worth stating plainly, because it changes how much of the above is needed: an agent
that writes notes, skills, category rules or a whole architecture *is already
extending the app*, and the UI reflects it, because the UI is data-driven —
`.summa/architecture.json`, categories as rules, the architecture packs.

dsh needs "everything is a plugin" because it has no host. Summa Wiki can host
someone else's harness and get much of the extensibility without building the
framework. The open question is narrow: **what can a user want that the data layer
cannot express?** The answer is *new views* — and only that answer justifies the UI
layer above.

### Security, if this is ever built

dsh is a developer tool run by developers. Summa Wiki holds someone's personal
notes. Third-party code hot-loaded into Electron is arbitrary code execution over
the whole vault and machine. Non-negotiables: plugins load in the **server child
process, never the renderer with Node integration**; explicit per-plugin opt-in; a
manifest declaring what a plugin touches. Local plugins would live in
`.summa/plugins/`, consistent with the rule that vault-level state lives in
`.summa/`.

### First step, when the time comes

Not designing the contract. Write **one** throwaway plugin against the app as it
stands — a renderer for an invented `type:` — and find where it chafes. A plugin
contract designed without plugins using it gets designed wrong.

## Distribution: npm

Considered and declined **as a launch channel**, for now.

The CLI is a clean npm candidate: `src/cli.ts` imports only `node:` builtins and
its own modules, needs no build step, and the name `summa-wiki` is free on npm. It
would have been easy to publish — which is exactly the bias to watch. Easy is not
the same as right.

Someone running `npx summa-wiki search` gets a ranked list of file paths. That is
useful to an *agent*, and no evidence at all of why the app is worth installing.
The product is the reading and writing experience; the CLI is shared infrastructure
between the app and the agent.

So: **one channel, the installers on GitHub Releases.** Publishing the CLI later has
a real but narrow use — letting an agent reach a vault from outside the app, which
is what `CLAUDE.md` in the author's own vault does — but it is a convenience, not a
launch.

If plugins are ever built, one package does become necessary: **`@summa-wiki/plugin-api`**,
carrying only the types and the contract. It has to be versioned *separately from
the app*, or every app release breaks every plugin. Discovery would follow dsh's
approach, which demonstrably works: a `summa-wiki-plugin` npm keyword plus a GitHub
topic.

Shipping the whole app as `npx summa-wiki web` (dsh's model) is feasible but heavy —
the tarball would carry the Next build and `next` itself, well over 150 MB. Only
worth it for a "run it on a server, open a browser" story that nobody has asked for.

## Representation: the graph view is one idiom out of many

`components/GraphView.tsx` is a hand-written force-directed canvas — nodes colored
by `type:`, radius from `degree`, filtered by bundle, with a focus mode that pins a
neighbourhood and flies the camera to it. It is a good implementation of exactly one
visualization idiom, and it is the same idiom essentially every ontology tool ever
shipped picked.

That is worth stating as a finding rather than a preference. A survey of 37 OWL
visualization tools (Dudáš, Lohmann, Svátek & Pavlov) found them *mostly 2D, mostly
node-link, focused on the class hierarchy, with color, size and shape used with
little variation*. The field's own conclusion is that node-link is a **default, not a
result**. [`docs/research/ontology-representations.html`](research/ontology-representations.html)
is a field guide to fourteen idioms that exist — indented lists, Euler regions,
treemaps, adjacency matrices, hyperbolic disks, embedding maps, floor plans,
rewriting systems — each one drawn with the same nine-class reference ontology so
they can be compared rather than described. Read it before designing a second view.
It is also published at <https://claude.ai/code/artifact/c8d80aab-7aa3-43ac-80e0-4e1486860322>.

### What the current view cannot say

Three things the index already contains and the canvas cannot show.

**Edges have no type.** `/api/graph` emits `{ s, t }` derived from internal Markdown
links, so "cites", "is part of", "contradicts" and "mentioned once in passing" all
render as the same line. This is a *format* gap before it is a rendering one: there
is nowhere in `schema-spec.md` to put a relation type today.

**Membership is not a tree, and a force layout assumes it is.** Categories are rules
(`.summa/categories.json`) and a note can match several at once — set structure, not
hierarchy. Euler regions draw exactly that; a force layout cannot draw it at all,
because a multi-category note either sits inside one cluster or floats between
clusters, and both readings are false.

**Weight is invisible.** `words` and `pillar` are fetched by `/api/graph`, carried
into the `Node` interface, and never used for any visual encoding — only `type`
(color) and `degree` (radius) are. `isIndex` is a filter, and the alpha channel is
spent on focus dimming rather than on data. So the vault cannot answer "where is this
actually dense?" from the one view it has, even though the index knows.

### The cheapest useful additions, roughly in order

An ordering by ratio of insight to work, not a plan.

1. **Use the retinal channels already on the canvas.** The survey's most damning
   finding is that tools *have* these channels and leave them idle. `updated`
   recency as opacity, `pillar` as shape, orphan status as a ring — no new view, no
   new data, no new endpoint.

2. **A treemap by pillar → type → note.** Answers the density question the graph
   structurally cannot, reuses the index as-is, and needs no simulation — so no
   layout instability and nothing to tune.

3. **An indented tree over the graph, not the filesystem.** `FileTree.tsx` shows
   folders; a tree keyed on `pillar:`/`type:` is a different object. Fu et al. found
   indented trees *beat* node-link for exactly the list-checking and lookup tasks a
   reading app performs most.

4. **Coordinated views.** Selection in one view highlights in the others. Every
   survey since 2007 recommends it and almost no tool ships it; it is also the only
   thing that makes items 2 and 3 worth more than the sum of their parts, since each
   individual view drops something a sibling view recovers.

5. **Typed edges.** The expensive one, and it starts in the format rather than the
   UI — a way to annotate a link with a relation has to exist before anything can
   render one. Do not start here.

### Constraints that shape any of this

The simulation is hand-written **on purpose**, and `GraphView.tsx` says why: no d3,
so the project stays dependency-free and the CLI can run the same modules under
`node --experimental-strip-types` with no install step. That rules out reaching for
Cosmograph or sigma.js the moment scale bites — and it also means a treemap or an
indented tree, neither of which needs a simulation at all, is a *better* fit for this
codebase than a fancier graph would be.

Scale is not currently the problem. At ~235 notes the vault is three orders of
magnitude below where node-link diagrams break down. The reason to add a view is not
that the graph is slow; it is that the graph answers one question and the vault
raises several.

The through-line from the field guide, which is the part worth keeping if everything
else here is discarded: **every representation is a projection and each one drops
something.** Indented lists drop relations, node-link drops scale, treemaps drop
edges, embedding maps drop the axioms, hairballs drop identity. The question is never
which is best — it is which loss is acceptable for the question being asked, and
whether a second coordinated view recovers it.

## Ingest: local OCR

Spiked in July 2026 and declined, with the measurements kept here because the
blocker is not quality.

The spike ran `sahilchachra/unlimited-ocr-8bit-mlx` through `mlx-vlm` against three
deliberately different page classes: dense book prose, a technical page with
footnotes and inline math, and a designed multi-column marketing layout. The model
returns block-typed regions with bounding boxes (`header`, `title`, `text`, `image`),
so it does layout analysis rather than a flat text dump, and it held up on all three
— including the math and the multi-column reading order, which is where cheaper OCR
usually falls apart.

What it cost, on Apple Silicon:

- dense prose — 35.7s for 2,542 characters
- technical page with footnotes and math — 36.1s for 3,969 characters
- multi-column designed layout — 78.7s for 7,042 characters

Two things follow. Half a minute to a minute and a half *per page* is not a bulk
ingest story: a 300-page scanned book is somewhere between three and six hours, and
the feature people actually want is "drop a PDF in and walk away."

The disqualifying one is the second: MLX is Apple Silicon only. This app ships four
targets, and an ingest path that exists on exactly one of them is worse than no
ingest path — it makes the vault format itself platform-dependent, because notes
produced on a Mac would have no way to be produced anywhere else.

Whenever this is revisited, the constraint to design against is *cross-platform
first*, which likely means an ONNX or GGUF runtime rather than MLX, and accepting
worse per-page quality in exchange for a feature that exists everywhere.

## Ingest: cloud folders in a vault

Asked for during vault creation: let someone point at a Google Drive, iCloud,
OneDrive or Dropbox folder and have it become part of the vault — by symlink, or
by some direct reference to the cloud provider. Not built, and the reason is that
"a folder that is already on your disk" and "a folder that is a cache of a remote
one" look identical to `readdir` and behave nothing alike.

### The thing that breaks: files that exist but are not there

Every one of these providers ships on-demand files by default. The file appears
in a directory listing, `stat` reports a real size, and the bytes are on someone
else's computer until something reads them. macOS iCloud leaves `.icloud` stubs;
Windows uses reparse points flagged `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`;
Google Drive and Dropbox mount a synthetic filesystem that faults the content in.

`src/indexer.ts` walks the vault and **reads every note** — it has to, the index
is built from frontmatter and body. Point it at an on-demand folder and indexing
becomes a download of the entire folder, triggered by an app the user opened to
read one article. That can be gigabytes, on a metered connection, with no
progress bar, and on a provider that bills for egress it can cost money. Worse,
`wiki index` is exactly the command the docs tell people to run after adding
notes.

So the first requirement is not a symlink. It is a way for the indexer to ask
"is this file actually local?" and skip what is not — which is a per-platform
question with no portable answer, and the same cross-platform bind that
disqualified [local OCR](#ingest-local-ocr).

### Three more that each need an answer

**Writing into a syncing folder invites conflicts.** Summa Wiki edits notes in
place. A provider that sees a local write while a remote change is pending
resolves it by keeping both — `note (conflicted copy 2026-08-16).md` — and the
vault now has two articles where the user wrote one. The app cannot prevent this;
what it can do is not put the files it writes most often inside the synced area.

**`.summa/` must not sync.** The index in this author's vault is 6.8 MB and is
rewritten whole on every `wiki index`. Inside a synced folder that is a
multi-megabyte upload every time someone saves a note, on a file that is derived
and worthless to any other machine. If a vault ever spans cloud folders, `.summa/`
belongs outside them, which means the current rule — vault-level state lives at
`<vault>/.summa/` — needs an exception it does not have today.

**File watching is unreliable there.** The live-reload path assumes FSEvents and
inotify semantics. Synthetic filesystems deliver those events late, coalesced, or
not at all, so a note changed on another device may simply never appear until a
manual reindex. That is acceptable if it is *stated*; it is a bug report if the
app claims to watch.

### Why symlinks are the wrong first move

A symlink is easy to create and answers none of the above — it changes where the
bytes come from and nothing about whether they are present, whether writes are
safe, or whether changes are observable. It also adds its own problem: the walker
would have to decide whether to follow links, and following them makes cycles and
escapes from the vault root reachable, neither of which it currently has to
handle.

The honest smallest version, if this is picked up: **treat a cloud folder as a
source to ingest from, not as part of the vault.** That path already exists — the
setup wizard's "sources" step copies files in — and it sidesteps every item
above, because the copy happens once, with a progress indicator, and what lands
in the vault is a real local file. The cost is that it is a snapshot rather than a
live mirror, and that is the trade to put in front of the user rather than to
decide for them.

A live mirror is the feature people actually picture. It is also a sync engine,
and writing one of those is a much larger project than the app it would live in.

## Onboarding: a showcase vault

First run opens an empty vault. Every feature in this app is data-driven — the
graph, the category rules, backlinks, `wiki search`, the renderers keyed to
`type:` — which means an empty vault demonstrates exactly none of them. They are
emergent properties of content, and with no content they are invisible.

The proposal is an optional showcase vault, offered on first run beside "create a
vault": a real vault with real files that the user can open, break and delete.
Not a video, not a tour overlay pointing at empty panes.

### Why this does not reintroduce the cost scaffold.ts avoids

`src/scaffold.ts` refuses per-architecture templates on purpose — hand-written
prose per package means the fourth package never gets added. A showcase vault
looks like that same mistake and is not, *provided there is exactly one*, tied to
no architecture. What the scaffold avoids is combinatorial (architectures ×
prose); one fixed demo is a constant. The day someone proposes "a showcase per
architecture", that constant becomes the thing `scaffold.ts` was written to
prevent.

Locale is the one real multiplier: the vault ships in `en` and `es`, so the
content is written twice. That is the ceiling, and content that leans on
structure rather than prose keeps it low.

### The content is a specification, not a writing task

Each feature needs an exhibit, or it stays invisible:

- **Graph view** — enough notes and links for the layout to be non-trivial: at
  least one dense hub and one sparse periphery, or it reads as a star or as noise.
- **Backlinks and `wiki related`** — notes reached from several directions, not a
  tree.
- **Orphans** — at least one genuine orphan, so `wiki orphans` returns something
  and the report teaches what it means.
- **Categories** — rules in `.summa/categories.json` matching by `pillar`, by
  path, by `type` and by tag, including one note that lands in two at once. It is
  the only way the "rules, not lists" model becomes visible.
- **Every `type:`** — `moc`, `area`, `project`, `knowledge`, `journal`, `source`,
  `connection`, `system`, `person`. A renderer keyed to a type shows nothing when
  the type is absent.
- **A `source` note with its PDF beside it**, plus assets in WebP named by
  convention, so the ingest and OCR paths have somewhere to point.
- **A canvas**, since it is a distinct renderer.
- **Provenance** — notes with `author:` of `human`, `agent` and `mixed`, carrying
  real `<!-- ai -->` blocks, so the convention is seen before it is explained.
- **A run of consecutive daily notes**, so the journal view is not one entry.
- **A skill in `.agents/skills/`** with its adapter symlink, so the skill surface
  has something in it on first run.

### The maintenance trap, and the way out

Content shipped alongside a schema drifts from it, and the failure mode here is
specific and embarrassing: the spec changes, the showcase is not updated, and
`wiki health` reports errors against the vault whose whole job is to demonstrate
that this app keeps a vault healthy.

The fix is to stop treating it as content and treat it as a fixture — run `wiki
health` and the indexer against the showcase in CI. Then it cannot drift
silently, and the burden turns into an asset: the linter and the indexer gain the
realistic full-coverage corpus they currently lack.

Which also sets the timing. Build it after the feature set stops moving. Every
new feature adds a required exhibit, so building it early means rewriting it on
every release.

## Smaller items

- **`src/config.ts` resolves the vault at import time** (`const resolved = resolveVault()`
  at module scope). When no vault exists it falls back into the user's data
  directory, so importing the module has filesystem side effects that depend on
  whose machine it runs on. That is worth fixing on its own — a build should be
  hermetic — but note it was *investigated and cleared* as the cause of the
  Windows CI failure below. The file's own comment explains why it is a `const`:
  making it lazy means touching the ~40 call sites that import it as a value.

- **`next build` fails on Windows** with `EPERM: scandir 'C:\Users\<user>\Application Data'`
  — a legacy junction that cannot be read. The glob comes from inside Next
  (`next/dist/compiled/glob`, reached from `verify-root-layout` / `collect-build-traces`
  / `inline-static-env`), and the same class of failure is reported upstream against
  Next, Prisma and better-auth. It was never diagnosed: CI now builds the web assets
  once on Linux and shares them with all four packaging jobs, which sidesteps it and
  is better anyway — `next build` output is platform-independent, and only Electron
  and node-pty are not. If Next ever has to run on Windows again, this is unfinished.

- **`asar: false`.** Enabling it would cut install time and file count, but Next
  writes to disk at runtime and an asar archive is read-only. Requires moving those
  writes to `userData` first.

- **Code signing.** Unsigned builds mean macOS says "the app is damaged" and
  Windows shows a SmartScreen warning. The CI already wires the secrets; they just
  do not exist yet. Apple Developer is 99 USD/year; Azure Trusted Signing for
  Windows requires a business entity 3+ years old.
