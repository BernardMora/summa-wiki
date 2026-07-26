import { NextResponse } from "next/server";
import fs from "node:fs";
import { getIndex, resolveId, invalidate } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * Highlights for a PDF, read back out of the notes that reference it.
 *
 * There is no separate highlight store: a highlight IS a link in a note, in
 * the pdf-plus shape (spec section 6). That keeps Obsidian and this app
 * reading the same annotations instead of each keeping its own set.
 *
 *   [file, p.3](….pdf#page=3&selection=1,0,4,22&color=yellow)
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return NextResponse.json({ error: "p required" }, { status: 400 });

  const base = p.split("/").pop() ?? p;
  const idx = getIndex();
  const out: {
    page: number; coords: number[]; color: string; text: string;
    noteId: string; noteTitle: string;
  }[] = [];

  const RE = /\[([^\]]*)\]\(([^)\s]*?)#page=(\d+)&selection=([\d,]+)(?:&color=([a-z]+))?\)/g;

  for (const n of idx.notes) {
    let raw: string;
    // require() is not available in an ES module; it threw and the catch
    // swallowed it, silently skipping every note.
    try { raw = fs.readFileSync(n.abs, "utf8"); } catch { continue; }
    if (!raw.includes("#page=")) continue;
    for (const m of raw.matchAll(RE)) {
      const href = decodeURIComponent(m[2]);
      if (!href.endsWith(base)) continue;              // same PDF?
      out.push({
        page: Number(m[3]),
        coords: m[4].split(",").map(Number),
        color: m[5] ?? "yellow",
        text: m[1],
        noteId: n.id,
        noteTitle: n.title,
      });
    }
  }
  return NextResponse.json({ highlights: out });
}


/**
 * Remove a highlight: delete the link from the note that holds it, plus the
 * blockquote it sits in, since a pdf-plus quote is written as
 *   > text
 *   >
 *   > — [file, p.N](path#page=N&selection=...)
 * Leaving the quote behind without its link would strand the text.
 */
export async function DELETE(req: Request) {
  const { noteId, page, coords } = await req.json();
  if (!noteId || !page || !coords) {
    return NextResponse.json({ error: "noteId, page y coords requeridos" }, { status: 400 });
  }
  const abs = resolveId(noteId);
  if (!abs || !fs.existsSync(abs)) return NextResponse.json({ error: "nota no encontrada" }, { status: 404 });

  const needle = `#page=${page}&selection=${coords}`;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  if (at < 0) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  // Expand over the contiguous blockquote around the link.
  let from = at, to = at;
  while (from > 0 && lines[from - 1].trimStart().startsWith(">")) from--;
  while (to < lines.length - 1 && lines[to + 1].trimStart().startsWith(">")) to++;
  // Swallow one blank line after the block so paragraphs do not double-space.
  if (lines[to + 1]?.trim() === "") to++;

  lines.splice(from, to - from + 1);
  fs.writeFileSync(abs, lines.join("\n"), "utf8");
  invalidate();
  return NextResponse.json({ ok: true });
}
