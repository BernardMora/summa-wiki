import { NextResponse } from "next/server";
import { getIndex } from "@/lib/server.ts";
import { search } from "@/src/search.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = p.get("q") ?? "";
  const hits = search(getIndex(), q, {
    type: p.get("type") ?? undefined,
    pillar: p.get("pillar") ?? undefined,
    author: p.get("author") ?? undefined,
    bundle: p.get("bundle") ?? undefined,
    tag: p.get("tag") ?? undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : 30,
  });
  return NextResponse.json({
    hits: hits.map((h) => ({
      id: h.note.id, title: h.note.title, path: h.note.path, type: h.note.type,
      bundle: h.note.bundle, updated: h.note.updated, excerpt: h.note.excerpt,
      score: h.score, why: h.why,
    })),
  });
}
