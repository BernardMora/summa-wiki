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
