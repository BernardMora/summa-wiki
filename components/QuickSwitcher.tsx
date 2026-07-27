"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Item {
  id: string; title: string; path: string; type: string;
  updated: string; words: number;
}

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Subsequence match — the Obsidian/VS Code behaviour: "prehis" hits
 * "notas-los-origenes...prehistoria". Returns a score and the matched
 * character positions so the UI can bold them; null when it doesn't match.
 */
function fuzzy(hay: string, needle: string): { score: number; hits: number[] } | null {
  if (!needle) return { score: 0, hits: [] };
  const h = norm(hay), n = norm(needle);
  const hits: number[] = [];
  let hi = 0, score = 0, streak = 0;

  for (const ch of n) {
    let found = -1;
    for (let i = hi; i < h.length; i++) if (h[i] === ch) { found = i; break; }
    if (found < 0) return null;
    // Consecutive characters and word starts are what people actually mean.
    if (found === hi && hits.length) { streak++; score += 8 + streak * 2; }
    else { streak = 0; score += 1; }
    if (found === 0 || /[\s\-_/.]/.test(h[found - 1] ?? "")) score += 10;
    hits.push(found);
    hi = found + 1;
  }
  score -= (h.length - n.length) * 0.05;   // shorter targets win ties
  return { score, hits };
}

function Marked({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>{[...text].map((c, i) =>
      set.has(i) ? <b key={i} className="qshit">{c}</b> : <span key={i}>{c}</span>,
    )}</>
  );
}

export default function QuickSwitcher({
  onOpen,
}: {
  /** newTab is true when the user held ⌘/Ctrl on Enter. */
  onOpen: (id: string, title: string, newTab: boolean) => void;
}) {
  const [show, setShow] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Load once, lazily: the list is only needed the first time it opens.
  useEffect(() => {
    if (!show || items.length) return;
    fetch("/api/index")
      .then((r) => r.json())
      .then((d) => setItems(
        (d.notes ?? [])
          .filter((n: Item) => !n.path.includes("05-Projects/"))
          .map((n: Item) => ({ ...n, path: n.path.replace(/^[a-z]+:/, "") })),
      ))
      .catch(() => {});
  }, [show, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setShow((v) => !v);
        setQ(""); setSel(0);
      }
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (show) setTimeout(() => input.current?.focus(), 0); }, [show]);

  const results = useMemo(() => {
    if (!items.length) return [];
    const scored: { it: Item; score: number; tHits: number[]; pHits: number[] }[] = [];
    for (const it of items) {
      const t = fuzzy(it.title, q);
      const p = q ? fuzzy(it.path, q) : null;
      if (!t && !p) continue;
      // A title match is worth far more than the same match buried in a path.
      const score = Math.max((t?.score ?? -1e9) * 2, p?.score ?? -1e9);
      scored.push({ it, score, tHits: t?.hits ?? [], pHits: t ? [] : (p?.hits ?? []) });
    }
    scored.sort((a, b) =>
      b.score - a.score || (b.it.updated ?? "").localeCompare(a.it.updated ?? ""));
    return scored.slice(0, 40);
  }, [items, q]);

  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".qsrow.on")
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, results]);

  const choose = useCallback((i: number, newTab: boolean) => {
    const hit = results[i];
    if (!hit) return;
    onOpen(hit.it.id, hit.it.title, newTab);
    setShow(false);
  }, [results, onOpen]);

  if (!show) return null;

  return (
    <div className="qsback" onMouseDown={() => setShow(false)}>
      <div className="qsbox" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="qsinput"
          placeholder="Buscar nota por título o ruta…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(sel, e.metaKey || e.ctrlKey); }
          }}
        />
        <ul className="qslist" ref={listRef}>
          {results.length === 0 && (
            <li className="qsempty">{items.length ? "Sin resultados" : "Cargando…"}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.it.id}
              className={`qsrow${i === sel ? " on" : ""}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(i, e.metaKey || e.ctrlKey); }}
            >
              <span className="qstitle"><Marked text={r.it.title} hits={r.tHits} /></span>
              <span className="qspath"><Marked text={r.it.path} hits={r.pHits} /></span>
              <span className="qsmeta">{r.it.type}</span>
            </li>
          ))}
        </ul>
        <div className="qsfoot">
          <span>↑↓ moverse</span><span>↵ abrir</span><span>⌘↵ pestaña nueva</span><span>esc cerrar</span>
        </div>
      </div>
    </div>
  );
}
