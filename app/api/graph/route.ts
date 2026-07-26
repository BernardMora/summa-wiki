import { NextResponse } from "next/server";
import { getIndex } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/** Nodes and edges for the graph view, trimmed to what the canvas needs. */
export async function GET() {
  const idx = getIndex();
  const keep = idx.notes.filter((n) => !n.path.includes("/Templates/"));
  const ids = new Set(keep.map((n) => n.id));

  const nodes = keep.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type,
    bundle: n.bundle,
    pillar: n.pillar ?? "",
    words: n.words,
    degree: 0,
    isIndex: n.slug === "_index",
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

  return NextResponse.json({ nodes, edges });
}
