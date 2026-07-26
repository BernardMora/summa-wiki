import path from "node:path";
import Link from "next/link";
import Sidebar from "@/components/Sidebar.tsx";
import NoteClient from "@/components/NoteClient.tsx";
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
    return (
      <div className="shell">
        <Sidebar />
        <main className="main"><h1>No encontrada</h1><p className="meta">{id}</p></main>
      </div>
    );
  }

  const { body } = parseFrontmatter(file.content);
  const pathToId = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );
  const dirFromVault = path.dirname(path.relative(VAULT, note.abs)).split(path.sep).join("/");
  const html = renderNote(body, { id, dirFromVault, pathToId });

  const byId = new Map(idx.notes.map((n) => [n.id, n]));
  const backlinks = note.backlinks.map((b) => byId.get(b)).filter(Boolean);
  const prov = note.provenance;
  const total = prov.humanWords + prov.agentWords;

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <article>
          <h1>{note.title}</h1>
          <p className="meta">
            <span className="pill">{note.type}</span>
            <span>{note.bundle}</span>
            <span>creada {note.created || "—"}</span>
            <span>actualizada {note.updated}</span>
            <span>{note.words} palabras</span>
            {prov.agentWords > 0 && total > 0 && (
              <span>{Math.round((100 * prov.agentWords) / total)}% agente</span>
            )}
          </p>
          <NoteClient id={id} initialContent={file.content} mtimeMs={file.mtimeMs} html={html} />
        </article>

        {backlinks.length > 0 && (
          <section style={{ marginTop: 40, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Enlaces entrantes ({backlinks.length})</h2>
            {backlinks.map((b) => (
              <Link key={b!.id} href={`/note/${encodeURIComponent(b!.id)}`} className="hit">
                {b!.title}<small>{b!.path}</small>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
