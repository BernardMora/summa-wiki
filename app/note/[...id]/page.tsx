import path from "node:path";

import ArticleClient from "@/components/ArticleClient.tsx";
import { getIndex, readNote, VAULT } from "@/lib/server.ts";
import { renderNote } from "@/lib/render.ts";
import { parseFrontmatter } from "@/src/indexer.ts";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string[] }> }) {
  const { id: parts } = await params;
  const id = decodeURIComponent(parts.join("/"));

  const idx = getIndex();
  const note = idx.notes.find((n) => n.id === id);
  const file = readNote(id);
  if (!note || !file) {
    return (<article><h1>No encontrada</h1><p className="infoline">{id}</p></article>);
  }

  const { body } = parseFrontmatter(file.content);
  const pathToId = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );
  const dirFromVault = path.dirname(path.relative(VAULT, note.abs)).split(path.sep).join("/");
  const html = renderNote(body, { id, dirFromVault, pathToId }, note.title);

  const byId = new Map(idx.notes.map((n) => [n.id, n]));
  const backlinks = note.backlinks
    .map((b) => byId.get(b))
    .filter(Boolean)
    .map((n) => ({ id: n!.id, title: n!.title, path: n!.path }));
  const outbound = note.links
    .filter((l) => l.kind === "internal" && l.target)
    .map((l) => byId.get(l.target!))
    .filter(Boolean)
    .map((n) => ({ id: n!.id, title: n!.title, path: n!.path }));

  return (
    <ArticleClient
      id={id}
      meta={{
        title: note.title, type: note.type, bundle: note.bundle, pathRel: note.path,
        created: note.created, updated: note.updated, author: note.author,
        pillar: note.pillar ?? "", status: note.status ?? "", resource: note.resource ?? "",
        tags: note.tags, words: note.words,
        humanWords: note.provenance.humanWords, agentWords: note.provenance.agentWords,
      }}
      html={html}
      initialContent={file.content}
      mtimeMs={file.mtimeMs}
      backlinks={backlinks}
      outbound={outbound}
    />
  );
}
