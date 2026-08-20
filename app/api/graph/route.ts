import { NextResponse } from "next/server";
import { getIndex } from "@/lib/server.ts";
import { ARCH } from "@/src/config.ts";
import { containsAny } from "@/src/match.ts";
import { navGroups } from "@/lib/nav.ts";

export const dynamic = "force-dynamic";

/** Nodes and edges for the graph view, trimmed to what the canvas needs. */
export async function GET() {
  const idx = getIndex();
  const keep = idx.notes.filter((n) => !containsAny(n.path, ARCH.articles.notArticles.contains));
  const ids = new Set(keep.map((n) => n.id));
  const groups = navGroups(Number.MAX_SAFE_INTEGER);
  const categoriesByNote = new Map<string, string[]>();
  for (const group of groups) for (const item of group.items) {
    const current = categoriesByNote.get(item.id) ?? [];
    current.push(group.id);
    categoriesByNote.set(item.id, current);
  }

  const nodes = keep.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type || "unknown",
    bundle: n.bundle,
    pillar: n.pillar ?? "",
    words: n.words,
    degree: 0,
    isIndex: n.slug === "_index",
    categories: categoriesByNote.get(n.id) ?? [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: { s: string; t: string }[] = [];
  const seen = new Set<string>();
  for (const n of keep) {
    for (const l of n.links) {
      if (l.kind !== "internal" || !l.target || !ids.has(l.target)) continue;
      if (l.target === n.id) continue;
      const key = `${n.id}|${l.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ s: n.id, t: l.target });
      byId.get(n.id)!.degree++;
      byId.get(l.target)!.degree++;
    }
  }

  return NextResponse.json({
    nodes, edges,
    bundles: idx.bundles.map((b) => b.id),
    categories: groups.filter((g) => !g.hidden && g.total > 0)
      .map((g) => ({ id: g.id, label: g.label, total: g.total })),
    types: [...new Set(nodes.map((n) => n.type))].sort(),
  });
}
