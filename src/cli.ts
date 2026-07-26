#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildIndex } from "./indexer.ts";
import { search, neighbourhood, health } from "./search.ts";
import { INDEX_PATH, VAULT, vaultExists } from "./config.ts";
import type { WikiIndex, Note } from "./types.ts";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const has = (name: string) => args.includes(`--${name}`);

function load(): WikiIndex {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`No index at ${INDEX_PATH}. Run: wiki index`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}

/** Accept a full id, a path, or a bare slug. */
function resolve(index: WikiIndex, q: string): Note | undefined {
  return index.notes.find((n) => n.id === q)
    ?? index.notes.find((n) => n.path === q)
    ?? index.notes.find((n) => n.slug === q)
    ?? index.notes.find((n) => n.slug === q.replace(/\.md$/, ""))
    ?? index.notes.find((n) => n.title.toLowerCase() === q.toLowerCase());
}

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

switch (cmd) {
  case "index": {
    if (!vaultExists()) { console.error(`Vault not found: ${VAULT}`); process.exit(1); }
    const t0 = Date.now();
    const idx = buildIndex();
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, has("pretty") ? 1 : 0));
    const s = idx.stats;
    console.log(`indexed ${s.notes} notes, ${s.words.toLocaleString()} words in ${Date.now() - t0}ms`);
    console.log(`  internal links ${s.internalLinks}   cross-bundle ${s.crossBundleLinks}   broken ${s.brokenLinks}`);
    console.log(`  isolated ${s.isolated}   orphans ${s.orphans}`);
    console.log(`  ${(fs.statSync(INDEX_PATH).size / 1024).toFixed(0)} KB -> ${INDEX_PATH}`);
    break;
  }

  case "search": {
    const idx = load();
    const q = args.slice(1).filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true).join(" ");
    const hits = search(idx, q, {
      type: flag("type"), pillar: flag("pillar"), author: flag("author"),
      bundle: flag("bundle"), tag: flag("tag"), since: flag("since"),
      limit: flag("limit") ? Number(flag("limit")) : undefined,
    });
    if (!hits.length) { console.log("no matches"); break; }
    for (const h of hits) {
      console.log(`${h.score.toFixed(1).padStart(6)}  ${pad(h.note.title, 44)}  ${h.note.path}`);
      if (has("why")) console.log(`        ${h.why.join(", ")}`);
      if (has("excerpt")) console.log(`        ${h.note.excerpt.slice(0, 150)}…`);
    }
    console.log(`\n${hits.length} result(s)`);
    break;
  }

  case "show": {
    const idx = load();
    const n = resolve(idx, args[1] ?? "");
    if (!n) { console.error("not found"); process.exit(1); }
    console.log(`# ${n.title}`);
    console.log(`  id       ${n.id}`);
    console.log(`  type     ${n.type}   author ${n.author}   words ${n.words}`);
    console.log(`  created  ${n.created || "(blank — not derivable)"}   updated ${n.updated}`);
    if (n.pillar) console.log(`  pillar   ${n.pillar}`);
    if (n.tags.length) console.log(`  tags     ${n.tags.join(", ")}`);
    if (n.resource) console.log(`  resource ${n.resource}`);
    if (n.provenance.agentWords) {
      const t = n.provenance.humanWords + n.provenance.agentWords;
      console.log(`  authored ${n.provenance.humanWords} human / ${n.provenance.agentWords} agent words (${Math.round(100 * n.provenance.agentWords / t)}% agent)`);
    }
    if (n.headings.length) console.log(`\n  headings: ${n.headings.slice(0, 8).join(" · ")}`);
    const out = n.links.filter((l) => l.kind === "internal");
    if (out.length) { console.log(`\n  links out (${out.length}):`); for (const l of out.slice(0, 15)) console.log(`    -> ${l.target}`); }
    if (n.backlinks.length) { console.log(`\n  backlinks (${n.backlinks.length}):`); for (const b of n.backlinks.slice(0, 15)) console.log(`    <- ${b}`); }
    const broken = n.links.filter((l) => l.kind === "broken");
    if (broken.length) { console.log(`\n  BROKEN (${broken.length}):`); for (const l of broken) console.log(`    !! ${l.href}`); }
    console.log(`\n  path: ${n.abs}`);
    break;
  }

  case "related": {
    const idx = load();
    const n = resolve(idx, args[1] ?? "");
    if (!n) { console.error("not found"); process.exit(1); }
    const depth = Number(flag("depth") ?? 1);
    const near = neighbourhood(idx, n.id, depth);
    console.log(`${near.length} note(s) within ${depth} hop(s) of "${n.title}":`);
    for (const m of near) console.log(`  ${pad(m.title, 44)}  ${m.path}`);
    break;
  }

  case "orphans": {
    const idx = load();
    const os = idx.notes.filter((n) => n.backlinks.length === 0);
    for (const n of os) console.log(`  ${pad(n.type || "—", 11)} ${pad(n.title, 44)} ${n.path}`);
    console.log(`\n${os.length} note(s) with no inbound links`);
    break;
  }

  case "health": {
    const idx = load();
    const issues = health(idx);
    const by = new Map<string, typeof issues>();
    for (const i of issues) { if (!by.has(i.kind)) by.set(i.kind, []); by.get(i.kind)!.push(i); }
    for (const [kind, list] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${kind}  (${list.length})`);
      for (const i of list.slice(0, has("all") ? 1e9 : 8)) console.log(`   ${i.note}${i.detail ? "  — " + i.detail : ""}`);
      if (!has("all") && list.length > 8) console.log(`   … ${list.length - 8} more (--all)`);
    }
    console.log(`\n${issues.length} issue(s) across ${idx.notes.length} notes`);
    break;
  }

  case "stats": {
    const s = load().stats;
    console.log(JSON.stringify(s, null, 2));
    break;
  }

  default:
    console.log(`Berni's Wiki CLI — index and query the knowledge base.

  wiki index [--pretty]              rebuild index.json
  wiki search <query> [filters]      ranked search
      --type --pillar --author --bundle --tag --since --limit --why --excerpt
  wiki show <slug|path|id>           metadata, links, backlinks, provenance
  wiki related <slug> [--depth N]    graph neighbourhood
  wiki orphans                       notes with no inbound links
  wiki health [--all]                spec section 9 validation
  wiki stats                         index statistics

Vault: ${VAULT}   (override with WIKI_VAULT)`);
}
