"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Hit { id: string; title: string; path: string; type: string; bundle: string; }

export default function Sidebar() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=25`);
      setHits((await r.json()).hits ?? []);
    }, 140);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <aside className="side">
      <Link href="/" className="brand">Berni&apos;s Wiki</Link>
      <input
        className="search-input"
        placeholder="Buscar…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div style={{ marginTop: 12 }}>
        {hits.map((h) => (
          <Link key={h.id} href={`/note/${encodeURIComponent(h.id)}`} className="hit">
            {h.title}
            <small>{h.bundle} · {h.type} · {h.path}</small>
          </Link>
        ))}
        {q.trim().length >= 2 && hits.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Sin resultados</p>
        )}
      </div>
    </aside>
  );
}
