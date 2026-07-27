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
  const VALID = new Set(["moc", "area", "project", "knowledge", "journal", "source", "connection", "system", "person"]);
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


export interface Candidate {
  kind: "tag-cluster" | "co-cited" | "orphan-cluster";
  label: string;
  why: string;
  notes: { id: string; title: string }[];
}

/**
 * Suggest articles worth writing, from structure rather than content.
 *
 * Three signals, all cheap and all explainable — a suggestion you cannot
 * justify is noise:
 *  - a tag shared by several notes with no hub tying them together
 *  - notes repeatedly cited together but never linked to each other
 *  - isolated notes that share a pillar, i.e. a topic nobody has indexed
 */
export function candidates(index: WikiIndex, min = 3): Candidate[] {
  const notes = index.notes.filter(
    (n) => n.slug !== "_index" && n.type !== "journal" && !n.path.includes("/Templates/"),
  );
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: Candidate[] = [];
  const brief = (n: Note) => ({ id: n.id, title: n.title });

  // 1. Tags with several notes but no note acting as a hub for them.
  const byTag = new Map<string, Note[]>();
  for (const n of notes) {
    for (const t of n.tags) {
      const key = t.replace(/^pillar\//, "");
      if (!key || key.length < 3) continue;
      if (!byTag.has(key)) byTag.set(key, []);
      byTag.get(key)!.push(n);
    }
  }
  for (const [tag, group] of byTag) {
    if (group.length < min) continue;
    const hub = group.some(
      (n) => n.type === "moc" || n.backlinks.length >= Math.ceil(group.length * 0.6),
    );
    if (hub) continue;
    out.push({
      kind: "tag-cluster",
      label: tag,
      why: `${group.length} notas comparten la etiqueta "${tag}" y ninguna las agrupa`,
      notes: group.slice(0, 8).map(brief),
    });
  }

  // 2. Pairs cited together by several notes but not linked to each other.
  const pairs = new Map<string, number>();
  for (const n of notes) {
    const targets = [...new Set(
      n.links.filter((l) => l.kind === "internal" && l.target).map((l) => l.target!),
    )].filter((t) => byId.has(t));
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const key = [targets[i], targets[j]].sort().join("||");
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of pairs) {
    if (count < min) continue;
    const [a, b] = key.split("||");
    const na = byId.get(a)!, nb = byId.get(b)!;
    const linked =
      na.links.some((l) => l.target === b) || nb.links.some((l) => l.target === a);
    if (linked) continue;
    out.push({
      kind: "co-cited",
      label: `${na.title} + ${nb.title}`,
      why: `${count} notas citan ambas, pero no se enlazan entre sí`,
      notes: [brief(na), brief(nb)],
    });
  }

  // 3. Isolated notes sharing a pillar: a topic nobody has indexed.
  const outbound = new Set(
    notes.filter((n) => n.links.some((l) => l.kind === "internal")).map((n) => n.id),
  );
  const isolated = notes.filter((n) => n.backlinks.length === 0 && !outbound.has(n.id));
  const byPillar = new Map<string, Note[]>();
  for (const n of isolated) {
    const k = n.pillar || "(sin pilar)";
    if (!byPillar.has(k)) byPillar.set(k, []);
    byPillar.get(k)!.push(n);
  }
  for (const [pillar, group] of byPillar) {
    if (group.length < min) continue;
    out.push({
      kind: "orphan-cluster",
      label: pillar,
      why: `${group.length} notas aisladas en el pilar "${pillar}"`,
      notes: group.slice(0, 8).map(brief),
    });
  }

  return out.sort((a, b) => b.notes.length - a.notes.length);
}
