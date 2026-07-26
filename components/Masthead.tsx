"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle.tsx";

interface Hit { id: string; title: string; path: string; type: string; bundle: string; }

export default function Masthead() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
      setHits((await r.json()).hits ?? []);
      setOpen(true);
    }, 130);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  return (
    <header className="masthead">
      <Link href="/" className="wordmark">
        <span className="name">Berni&apos;s Wiki</span>
        <span className="tag">La enciclopedia personal</span>
      </Link>

      <div className="searchwrap" ref={box}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q)}`); }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            placeholder="Buscar en el wiki"
            aria-label="Buscar"
          />
          <button type="submit">Buscar</button>
        </form>
        {open && hits.length > 0 && (
          <div className="suggest">
            {hits.map((h) => (
              <Link key={h.id} href={`/note/${encodeURIComponent(h.id)}`} onClick={() => setOpen(false)}>
                {h.title}
                <small>{h.bundle} · {h.type} · {h.path}</small>
              </Link>
            ))}
          </div>
        )}
      </div>

      <ThemeToggle />
    </header>
  );
}
