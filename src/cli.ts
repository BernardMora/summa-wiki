#!/usr/bin/env node
/**
 * El CLI del wiki: indexar y preguntarle al índice.
 *
 * ## Lo que ya NO está aquí, y por qué
 *
 * `show` y `tree` se fueron en la fase 5 de la migración a ACP. Los dos
 * existían para un agente que no tenía otra forma de mirar el vault, y los dos
 * hacían lo que `cat` y `ls` ya hacen — con la diferencia de que había que
 * anunciarlos en `CLAUDE.md` y esperar a que los leyera. Ahora el vault se
 * consulta por MCP (`src/mcp/tools.ts`), donde las herramientas aparecen solas
 * en la lista del agente, y lo que queda aquí es lo que NINGÚN comando de
 * shell contesta: búsqueda con ranking, el vecindario del grafo, los huérfanos,
 * la validación contra la spec y los candidatos.
 *
 * El criterio para volver a añadir un comando es ése: si `cat`, `ls` o `grep`
 * lo resuelven, no es un comando de esto.
 */
import fs from "node:fs";
import path from "node:path";
import { buildIndex } from "./indexer.ts";
import { search, neighbourhood, health, candidates } from "./search.ts";
import { INDEX_PATH, VAULT, VAULT_SOURCE, vaultExists } from "./config.ts";
import { settingsPath } from "./appdata.mjs";

/**
 * De dónde salió el vault. Se imprime porque "el CLI y la app no ven lo mismo"
 * es el fallo más difícil de diagnosticar de todos los que puede tener esto:
 * ambos resuelven igual, pero un `WIKI_VAULT` exportado en una shell y
 * olvidado los separa sin ninguna señal.
 */
const SOURCE_LABEL: Record<typeof VAULT_SOURCE, string> = {
  env: "de WIKI_VAULT",
  settings: `elegido en la app (${settingsPath()})`,
  legacy: "~/Documents/aios, la ruta histórica — elige uno en la app para fijarlo",
  none: "sin vault configurado",
};
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

  case "candidates": {
    const idx = load();
    const min = flag("min") ? Number(flag("min")) : 3;
    const cs = candidates(idx, min);
    if (!cs.length) { console.log("sin candidatos"); break; }
    for (const c of cs) {
      console.log(`\n[${c.kind}]  ${c.label}`);
      console.log(`   ${c.why}`);
      for (const n of c.notes) console.log(`     - ${n.title}`);
    }
    console.log(`\n${cs.length} candidato(s)`);
    break;
  }

  case "stats": {
    const s = load().stats;
    console.log(JSON.stringify(s, null, 2));
    break;
  }

  default:
    console.log(`Summa Wiki CLI — index and query the knowledge base.

  wiki index [--pretty]              rebuild index.json
  wiki search <query> [filters]      ranked search
      --type --pillar --author --bundle --tag --since --limit --why --excerpt
  wiki related <slug> [--depth N]    graph neighbourhood
  wiki orphans                       notes with no inbound links
  wiki health [--all]                spec section 9 validation
  wiki candidates [--min N]          articles worth writing, from graph structure
  wiki stats                         index statistics

Vault: ${VAULT}
       ${SOURCE_LABEL[VAULT_SOURCE]}`);
}
