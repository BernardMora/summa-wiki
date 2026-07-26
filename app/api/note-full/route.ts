import { NextResponse } from "next/server";
import path from "node:path";
import { getIndex, readNote, VAULT } from "@/lib/server.ts";
import { parseFrontmatter } from "@/src/indexer.ts";

export const dynamic = "force-dynamic";

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)\)/g;

/**
 * Everything one article pane needs. The main pane is seeded server-side; a
 * pane opened in a split fetches this so both render from the same shape.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const idx = getIndex();
  const note = idx.notes.find((n) => n.id === id);
  const file = readNote(id);
  if (!note || !file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { body } = parseFrontmatter(file.content);
  const dirFromVault = path.dirname(path.relative(VAULT, note.abs)).split(path.sep).join("/");
  const pathToId = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );

  const resolve: Record<string, string> = {};
  for (const m of body.matchAll(LINK_RE)) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/.test(raw) || raw.startsWith("aios://")) continue;
    const href = decodeURIComponent(raw);
    if (resolve[href]) continue;
    const joined = path.posix.normalize(path.posix.join(dirFromVault, href));
    if (/\.md$/i.test(href)) {
      const t = pathToId.get(joined);
      if (t) resolve[href] = `/note/${encodeURIComponent(t)}`;
    } else if (/\.pdf$/i.test(href)) {
      resolve[href] = `/pdf?p=${encodeURIComponent(joined)}`;
    } else {
      resolve[href] = `/api/asset?p=${encodeURIComponent(joined)}`;
    }
  }

  const byId = new Map(idx.notes.map((n) => [n.id, n]));
  const ref = (n: any) => ({ id: n.id, title: n.title, path: n.path });

  return NextResponse.json({
    id,
    content: file.content,
    mtimeMs: file.mtimeMs,
    meta: {
      title: note.title, type: note.type, bundle: note.bundle, pathRel: note.path,
      created: note.created, updated: note.updated, author: note.author,
      pillar: note.pillar ?? "", status: note.status ?? "", resource: note.resource ?? "",
      tags: note.tags, words: note.words,
      humanWords: note.provenance.humanWords, agentWords: note.provenance.agentWords,
      vaultPath: path.relative(VAULT, note.abs).split(path.sep).join("/"),
    },
    backlinks: note.backlinks.map((b) => byId.get(b)).filter(Boolean).map(ref),
    outbound: note.links.filter((l) => l.kind === "internal" && l.target)
      .map((l) => byId.get(l.target!)).filter(Boolean).map(ref),
    resolve,
  });
}
