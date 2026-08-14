import path from "node:path";
import ArticleClient from "@/components/ArticleClient.tsx";
import { getIndex, readNote, VAULT } from "@/lib/server.ts";
import { parseFrontmatter } from "@/src/indexer.ts";
import { categoriesOf } from "@/lib/nav.ts";
import { isCore } from "@/lib/identity.ts";

export const dynamic = "force-dynamic";

// El `title` opcional es parte del formato: es el pie de foto (ver livePreview).
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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
  const dirFromVault = path.dirname(path.relative(VAULT, note.abs)).split(path.sep).join("/");
  const pathToId = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );

  /**
   * The editor is the only view now, so it must resolve links and images
   * itself. Precompute href -> app URL here, where the index lives.
   */
  const resolve: Record<string, string> = {};
  for (const m of body.matchAll(LINK_RE)) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const href = decodeURIComponent(raw);
    if (resolve[href]) continue;
    if (href.startsWith("aios://")) continue;
    const joined = path.posix.normalize(path.posix.join(dirFromVault, href));
    if (/\.md$/i.test(href)) {
      const target = pathToId.get(joined);
      if (target) resolve[href] = `/note/${encodeURIComponent(target)}`;
    } else if (/\.pdf$/i.test(href)) {
      resolve[href] = `/pdf?p=${encodeURIComponent(joined)}`;
    } else {
      resolve[href] = `/api/asset?p=${encodeURIComponent(joined)}`;
    }
  }

  const byId = new Map(idx.notes.map((n) => [n.id, n]));
  const backlinks = note.backlinks.map((b) => byId.get(b)).filter(Boolean)
    .map((n) => ({ id: n!.id, title: n!.title, path: n!.path }));
  const outbound = note.links.filter((l) => l.kind === "internal" && l.target)
    .map((l) => byId.get(l.target!)).filter(Boolean)
    .map((n) => ({ id: n!.id, title: n!.title, path: n!.path }));

  return (
    <ArticleClient
      initial={{
      id,
      content: file.content,
      mtimeMs: file.mtimeMs,
      meta: {
        title: note.title, type: note.type, bundle: note.bundle, pathRel: note.path,
        created: note.created, updated: note.updated, author: note.author,
        vaultPath: path.relative(VAULT, note.abs).split(path.sep).join("/"),
        pillar: note.pillar ?? "", status: note.status ?? "", resource: note.resource ?? "",
        tags: note.tags, words: note.words,
        humanWords: note.provenance.humanWords, agentWords: note.provenance.agentWords,
        core: isCore(id), categories: categoriesOf(id),
      },
      backlinks,
      outbound,
      resolve,
      }}
    />
  );
}
