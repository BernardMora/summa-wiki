import fs from "node:fs";
import type { Note, WikiIndex } from "./types.ts";

/**
 * Deliberately not RAG. At ~240 notes the LLM reads what it needs once the
 * index points it at the right files — Karpathy's observation. This ranks
 * candidates; it does not try to answer.
 */

export interface SearchFilters {
  type?: string;
  pillar?: string;
  author?: string;
  bundle?: string;
  tag?: string;
  since?: string;   // updated >= YYYY-MM-DD
  limit?: number;
}

export interface Hit {
  note: Note;
  score: number;
  why: string[];
}

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function bodyOf(note: Note): string {
  try {
    const raw = fs.readFileSync(note.abs, "utf8");
    return raw.replace(/^---[\s\S]*?\n---\n?/, "");
  } catch {
    return "";
  }
}

export function search(index: WikiIndex, query: string, f: SearchFilters = {}): Hit[] {
  const terms = norm(query).split(/\s+/).filter((t) => t.length > 1);
  const hits: Hit[] = [];

  for (const note of index.notes) {
    if (f.type && note.type !== f.type) continue;
    if (f.pillar && note.pillar !== f.pillar) continue;
    if (f.author && note.author !== f.author) continue;
    if (f.bundle && note.bundle !== f.bundle) continue;
    if (f.tag && !note.tags.some((t) => norm(t).includes(norm(f.tag!)))) continue;
    if (f.since && (!note.updated || note.updated < f.since)) continue;

    if (terms.length === 0) {
      hits.push({ note, score: 1, why: ["filter only"] });
      continue;
    }

    const title = norm(note.title);
    const slug = norm(note.slug);
    const heads = norm(note.headings.join(" "));
    const tags = norm(note.tags.join(" "));
    const body = norm(bodyOf(note));

    let score = 0;
    const why: string[] = [];
    let matchedAll = true;

    for (const t of terms) {
      let s = 0;
      if (title.includes(t)) { s += 12; why.push(`title:${t}`); }
      if (slug.includes(t)) s += 6;
      if (tags.includes(t)) { s += 5; why.push(`tag:${t}`); }
      if (heads.includes(t)) { s += 4; why.push(`heading:${t}`); }
      const n = body.split(t).length - 1;
      if (n > 0) { s += Math.min(6, 1 + Math.log2(n)); why.push(`body×${n}`); }
      if (s === 0) matchedAll = false;
      score += s;
    }
    if (score === 0) continue;
    if (matchedAll) score *= 1.5;           // all terms present beats partial
    score += Math.min(3, note.backlinks.length * 0.3);  // well-connected notes rank up

    hits.push({ note, score, why: [...new Set(why)] });
  }

  hits.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return hits.slice(0, f.limit ?? 15);
}

/** Notes reachable from a starting note within `depth` link hops, both directions. */
export function neighbourhood(index: WikiIndex, id: string, depth = 1): Note[] {
  const byId = new Map(index.notes.map((n) => [n.id, n]));
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const n = byId.get(cur);
      if (!n) continue;
      const adj = [
        ...n.links.filter((l) => l.kind === "internal" && l.target).map((l) => l.target!),
        ...n.backlinks,
      ];
      for (const a of adj) if (!seen.has(a)) { seen.add(a); next.push(a); }
    }
    frontier = next;
  }
  seen.delete(id);
  return [...seen].map((i) => byId.get(i)!).filter(Boolean);
}

/** Spec section 9 validation, plus the staleness and gap checks from Phase 5. */
export function health(index: WikiIndex) {
  const VALID = new Set(["moc", "area", "project", "knowledge", "journal", "source", "connection", "system"]);
  const issues: { kind: string; note: string; detail: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const n of index.notes) {
    if (!n.type) issues.push({ kind: "missing-type", note: n.id, detail: "no type field" });
    else if (!VALID.has(n.type)) issues.push({ kind: "invalid-type", note: n.id, detail: n.type });
    if (!n.title) issues.push({ kind: "missing-title", note: n.id, detail: "" });
    if (!n.author) issues.push({ kind: "missing-author", note: n.id, detail: "" });
    if (!n.created) issues.push({ kind: "no-created", note: n.id, detail: "left blank, not fabricated" });
    if (n.created && n.updated && n.created > n.updated)
      issues.push({ kind: "created-after-updated", note: n.id, detail: `${n.created} > ${n.updated}` });
    if (n.type === "source" && !n.resource)
      issues.push({ kind: "source-without-resource", note: n.id, detail: "" });
    if (n.provenance.malformed)
      issues.push({ kind: "malformed-provenance", note: n.id, detail: "unbalanced ai/human markers" });
    if (n.author === "mixed" && n.provenance.agentWords === 0)
      issues.push({ kind: "mixed-without-markers", note: n.id, detail: "" });
    if (!/^[a-z0-9-]+$/.test(n.slug) && !n.slug.startsWith("_"))
      issues.push({ kind: "non-slug-filename", note: n.id, detail: n.slug });
    for (const l of n.links.filter((l) => l.kind === "broken"))
      issues.push({ kind: "broken-link", note: n.id, detail: l.href });
    if (n.status === "active" && n.updated && daysBetween(n.updated, today) > 30)
      issues.push({ kind: "stale-active", note: n.id, detail: `updated ${n.updated}` });
  }
  return issues;
}

function daysBetween(a: string, b: string): number {
  const d = (Date.parse(b) - Date.parse(a)) / 86400000;
  return Number.isFinite(d) ? d : 0;
}
