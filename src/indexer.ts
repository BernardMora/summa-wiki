import fs from "node:fs";
import path from "node:path";
import { VAULT, bundles, EXCLUDE_DIRS, isExcluded, bundleOf } from "./config.ts";
import type { Note, Link, Provenance, WikiIndex, IndexStats, NoteType, Author } from "./types.ts";

export const INDEX_VERSION = 1;

// ---------------------------------------------------------------- frontmatter

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Minimal YAML: flat `key: value` plus `[a, b]` inline lists. Enough for the spec's ten fields. */
export function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = text.match(FM_RE);
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fm, body: text.slice(m[0].length) };
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

// ---------------------------------------------------------------- provenance

const AI_BLOCK = /<!--\s*ai\s*-->([\s\S]*?)<!--\s*\/ai\s*-->/g;
const HUMAN_BLOCK = /<!--\s*human\s*-->([\s\S]*?)<!--\s*\/human\s*-->/g;

const wc = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Attribute words to human vs agent using the markers from spec section 4.
 * Nested <!-- human --> inside <!-- ai --> is subtracted back out, so a human
 * sentence inserted into an agent paragraph counts as the human's.
 */
export function analyzeProvenance(raw: string, declared: string): Provenance {
  // Markers shown inside code are documentation of the format — the spec and
  // the project note both do this — not actual attribution. Strip fenced AND
  // inline code before counting, or those docs report as malformed.
  const body = raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  const opens = (body.match(/<!--\s*(ai|human)\s*-->/g) ?? []).length;
  const closes = (body.match(/<!--\s*\/(ai|human)\s*-->/g) ?? []).length;
  const malformed = opens !== closes;

  let agentWords = 0;
  let nestedHuman = 0;
  for (const m of body.matchAll(AI_BLOCK)) {
    agentWords += wc(m[1].replace(HUMAN_BLOCK, ""));
    for (const h of m[1].matchAll(HUMAN_BLOCK)) nestedHuman += wc(h[1]);
  }
  let humanWords = 0;
  const outsideAi = body.replace(AI_BLOCK, "");
  humanWords = wc(outsideAi.replace(/<!--\s*\/?(ai|human)\s*-->/g, "")) + nestedHuman;

  // No markers at all: the file-level author field decides. Unmarked reads as human.
  if (opens === 0) {
    const total = wc(body);
    if (declared === "agent") return { humanWords: 0, agentWords: total, malformed };
    return { humanWords: total, agentWords: 0, malformed };
  }
  return { humanWords, agentWords, malformed };
}

// ---------------------------------------------------------------- links

// El `title` opcional —`[texto](ruta "título")`— es markdown estándar, y el
// lector lo usa como pie de foto. Sin contemplarlo aquí, una imagen con pie
// desaparecía de `assets` y un enlace con título desaparecía del grafo entero:
// ni backlinks ni comprobación de enlaces rotos.
const LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/gm;
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|mov|pdf|docx|pptx|xlsx|msapp|zip)$/i;

function stripFences(body: string): string {
  // Links inside fenced code are documentation examples, not graph edges.
  return body.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

// ---------------------------------------------------------------- walk

function walk(root: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory() || e.isSymbolicLink()) {
      if (EXCLUDE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
      }
      if (isDir) walk(full, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------- build

export function buildIndex(): WikiIndex {
  // Se recorren TODOS los bundles declarados, no dos por nombre. Antes eran
  // `find(...)!` sobre "personal" y "veridia": con un bundle menos —el vault de
  // alguien que no tiene Veridia— la aserción reventaba el índice entero. `walk`
  // ya devuelve vacío para una raíz que no existe, así que un bundle ausente
  // simplemente no aporta archivos.
  const files = new Set<string>();
  for (const b of bundles) for (const f of walk(b.root)) files.add(f);

  const notes: Note[] = [];
  const byAbs = new Map<string, Note>();

  for (const abs of [...files].sort()) {
    const b = bundleOf(abs);
    const rel = path.relative(b.root, abs).split(path.sep).join("/");
    const relFromVault = path.relative(VAULT, abs).split(path.sep).join("/");
    if (isExcluded(relFromVault)) continue;

    const raw = fs.readFileSync(abs, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const clean = stripFences(body);

    const headings = [...body.matchAll(HEADING_RE)].map((m) => m[1].trim());
    const plain = body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#*_`>|-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const note: Note = {
      id: `${b.id}:${rel}`,
      bundle: b.id,
      path: rel,
      abs,
      slug: path.basename(rel, ".md"),
      title: fm.title || path.basename(rel, ".md"),
      type: (fm.type as NoteType) ?? "",
      created: fm.created ?? "",
      updated: fm.updated ?? "",
      author: (fm.author as Author) ?? "",
      pillar: fm.pillar || undefined,
      status: fm.status || undefined,
      priority: fm.priority || undefined,
      resource: fm.resource || undefined,
      tags: parseTags(fm.tags),
      words: wc(body),
      excerpt: plain.slice(0, 320),
      headings,
      links: [],
      backlinks: [],
      assets: [],
      provenance: analyzeProvenance(body, fm.author ?? ""),
    };
    notes.push(note);
    byAbs.set(abs.normalize("NFC"), note);
  }

  // Second pass: resolve links now that every note id exists.
  for (const note of notes) {
    const raw = fs.readFileSync(note.abs, "utf8");
    const { body } = parseFrontmatter(raw);
    const clean = stripFences(body);
    const dir = path.dirname(note.abs);

    for (const m of clean.matchAll(LINK_RE)) {
      const [, bang, text, href] = m;
      if (bang === "!" || ASSET_EXT.test(href)) {
        if (bang === "!") note.assets.push(decodeURIComponent(href));
        note.links.push({ href, text, kind: "asset" });
        continue;
      }
      if (/^https?:|^mailto:/.test(href)) {
        note.links.push({ href, text, kind: "external" });
        continue;
      }
      if (href.startsWith("aios://")) {
        const rest = href.slice("aios://".length);
        const slash = rest.indexOf("/");
        const bid = rest.slice(0, slash);
        const p = decodeURIComponent(rest.slice(slash + 1));
        const target = bundles.find((x) => x.id === bid)
          ? `${bid}:${bid === "personal" ? p : p}`
          : undefined;
        note.links.push({ href, text, kind: "cross-bundle", target });
        continue;
      }
      if (href.startsWith("#")) continue;
      if (!href.endsWith(".md")) continue;

      // macOS stores filenames in NFD (í = i + combining acute) but editors
      // write NFC. Same trap as the case-only renames: the file is right there
      // and the lookup still misses. Normalise both sides.
      const abs = path.resolve(dir, decodeURIComponent(href)).normalize("NFC");
      const t = byAbs.get(abs);
      note.links.push({
        href, text,
        target: t?.id,
        kind: t ? "internal" : "broken",
      });
    }
  }

  // Backlinks.
  const byId = new Map(notes.map((n) => [n.id, n]));
  for (const note of notes) {
    for (const l of note.links) {
      if (l.kind !== "internal" || !l.target) continue;
      const t = byId.get(l.target);
      if (t && !t.backlinks.includes(note.id)) t.backlinks.push(note.id);
    }
  }

  const outbound = new Set(
    notes.filter((n) => n.links.some((l) => l.kind === "internal")).map((n) => n.id),
  );
  const stats: IndexStats = {
    notes: notes.length,
    words: notes.reduce((a, n) => a + n.words, 0),
    internalLinks: notes.reduce((a, n) => a + n.links.filter((l) => l.kind === "internal").length, 0),
    brokenLinks: notes.reduce((a, n) => a + n.links.filter((l) => l.kind === "broken").length, 0),
    crossBundleLinks: notes.reduce((a, n) => a + n.links.filter((l) => l.kind === "cross-bundle").length, 0),
    isolated: notes.filter((n) => n.backlinks.length === 0 && !outbound.has(n.id)).length,
    orphans: notes.filter((n) => n.backlinks.length === 0).length,
    byType: {}, byAuthor: {}, byBundle: {},
  };
  for (const n of notes) {
    stats.byType[n.type || "(none)"] = (stats.byType[n.type || "(none)"] ?? 0) + 1;
    stats.byAuthor[n.author || "(none)"] = (stats.byAuthor[n.author || "(none)"] ?? 0) + 1;
    stats.byBundle[n.bundle] = (stats.byBundle[n.bundle] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    version: INDEX_VERSION,
    bundles: bundles.map((b) => ({ ...b })),
    notes,
    stats,
  };
}
