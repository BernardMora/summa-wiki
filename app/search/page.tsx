import Link from "next/link";
import { getIndex } from "@/lib/server.ts";
import { search } from "@/src/search.ts";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const hits = q ? search(getIndex(), q, { type: sp.type, pillar: sp.pillar, bundle: sp.bundle, limit: 60 }) : [];

  return (
    <article>
      <h1>Búsqueda</h1>
      {!q && <p className="dim">Escribe en el buscador de arriba.</p>}
      {q && <p className="infoline"><span>{hits.length} resultado(s) para “{q}”</span></p>}
      {hits.map((h) => (
        <div key={h.note.id} style={{ marginBottom: 14 }}>
          <Link href={`/note/${encodeURIComponent(h.note.id)}`}><strong>{h.note.title}</strong></Link>{" "}
          <span className="dim">— {h.note.type} · {h.note.bundle} · {h.note.updated}</span>
          <div style={{ fontSize: 13.4 }}>{h.note.excerpt.slice(0, 240)}…</div>
          <div className="dim" style={{ fontSize: 11.5 }}>{h.note.path}</div>
        </div>
      ))}
    </article>
  );
}
