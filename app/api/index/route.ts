import { NextResponse } from "next/server";
import { getIndex } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const idx = getIndex(force);
  // Trim abs paths and excerpts out of the list payload; the reader fetches
  // full content per note anyway.
  return NextResponse.json({
    generatedAt: idx.generatedAt,
    stats: idx.stats,
    bundles: idx.bundles.map((b) => ({ id: b.id, shared: b.shared })),
    notes: idx.notes.map((n) => ({
      id: n.id, bundle: n.bundle, path: n.path, slug: n.slug, title: n.title,
      type: n.type, created: n.created, updated: n.updated, author: n.author,
      pillar: n.pillar, tags: n.tags, words: n.words,
      backlinks: n.backlinks,
      links: n.links.filter((l) => l.kind === "internal").map((l) => l.target),
    })),
  });
}
