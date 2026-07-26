import Link from "next/link";
import Sidebar from "@/components/Sidebar.tsx";
import { getIndex } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

export default function Home() {
  const idx = getIndex();
  const s = idx.stats;
  const recent = [...idx.notes]
    .filter((n) => n.updated)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 12);
  const orphans = idx.notes.filter((n) => n.backlinks.length === 0).length;

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <h1 style={{ margin: "0 0 6px" }}>Berni&apos;s Wiki</h1>
        <p className="meta">
          <span>{s.notes} notas</span>
          <span>{s.words.toLocaleString()} palabras</span>
          <span>{s.internalLinks} enlaces</span>
          <span>{s.brokenLinks} rotos</span>
          <span>{orphans} sin entradas</span>
        </p>

        <h2>Actualizadas recientemente</h2>
        <div>
          {recent.map((n) => (
            <Link key={n.id} href={`/note/${encodeURIComponent(n.id)}`} className="hit">
              {n.title}
              <small>{n.updated} · {n.bundle} · {n.type}</small>
            </Link>
          ))}
        </div>

        <h2>Por tipo</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tipo</th><th>Notas</th></tr></thead>
            <tbody>
              {Object.entries(s.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Autoría</h2>
        <p className="meta">
          {Object.entries(s.byAuthor).map(([k, v]) => (
            <span key={k}><span className="pill">{k}</span> {v}</span>
          ))}
        </p>
      </main>
    </div>
  );
}
