import { NextResponse } from "next/server";
import { readNote, writeNote, getIndex, findNote } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const note = readNote(id);
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
  const meta = findNote(getIndex(), id);
  return NextResponse.json({ ...note, meta });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { id, content, mtimeMs } = body ?? {};
  if (!id || typeof content !== "string")
    return NextResponse.json({ error: "id and content required" }, { status: 400 });

  const r = writeNote(id, content, mtimeMs);
  if (!r.ok && r.reason === "stale") {
    // The file changed on disk since this buffer was loaded. Refuse rather
    // than clobber; the client decides whether to reload or force.
    return NextResponse.json(
      { error: "stale", currentMtimeMs: r.currentMtimeMs, currentContent: r.currentContent },
      { status: 409 },
    );
  }
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 404 });
  return NextResponse.json({ ok: true, mtimeMs: r.mtimeMs, wrapped: r.wrapped, authorChanged: r.authorChanged });
}
