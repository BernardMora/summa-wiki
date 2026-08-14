"use client";
import { isArticlePath } from "@/src/match.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzy, markHits } from "@/lib/fuzzy.ts";

export interface LinkTarget { id: string; title: string; path: string; bundle: string; type: string }
export interface LinkQuery { query: string; from: number; to: number; x: number; y: number }

/**
 * Buscador de notas que aparece al escribir `[[` dentro del editor.
 *
 * Inserta un **enlace markdown estándar**, no un wikilink: la spec §2 lo exige,
 * y calcular la ruta relativa correcta es justo el trabajo que esto ahorra.
 */
export default function LinkPicker({
  q, onPick, onClose,
}: {
  q: LinkQuery;
  onPick: (t: LinkTarget) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<LinkTarget[]>([]);
  const [primary, setPrimary] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let dead = false;
    fetch("/api/index")
      .then((r) => r.json())
      .then((d) => {
        if (dead) return;
        setPrimary(d.primaryBundle ?? "");
        setItems((d.notes ?? [])
          .filter((n: LinkTarget) => n.type !== "system" && isArticlePath(n.path, d.notArticles))
          .map((n: LinkTarget) => ({ id: n.id, title: n.title, path: n.path, bundle: n.bundle, type: n.type })));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const results = useMemo(() => {
    if (!items.length) return [];
    const out: { it: LinkTarget; score: number; hits: number[] }[] = [];
    for (const it of items) {
      const t = fuzzy(it.title, q.query);
      const p = q.query ? fuzzy(it.path, q.query) : null;
      if (!t && !p) continue;
      out.push({ it, score: Math.max((t?.score ?? -1e9) * 2, p?.score ?? -1e9), hits: t?.hits ?? [] });
    }
    out.sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title, "es"));
    return out.slice(0, 12);
  }, [items, q.query]);

  useEffect(() => { setSel(0); }, [q.query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".lprow.on")?.scrollIntoView({ block: "nearest" });
  }, [sel, results]);

  // El foco se queda en el editor para poder seguir escribiendo, así que las
  // teclas se capturan en la ventana. Se usa capture para ganarle a CodeMirror.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (!results.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.min(s + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        onPick(results[sel].it);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [results, sel, onPick, onClose]);

  // Se voltea hacia arriba si no cabe abajo.
  const flip = q.y > window.innerHeight - 260;
  const style: React.CSSProperties = {
    left: Math.min(q.x, window.innerWidth - 400),
    ...(flip ? { bottom: window.innerHeight - q.y + 20 } : { top: q.y + 4 }),
  };

  return (
    <div className="lpbox" style={style} onMouseDown={(e) => e.preventDefault()}>
      <ul className="lplist" ref={listRef}>
        {results.length === 0 && (
          <li className="lpempty">{items.length ? "Sin coincidencias" : "Cargando…"}</li>
        )}
        {results.map((r, i) => (
          <li
            key={r.it.id}
            className={`lprow${i === sel ? " on" : ""}`}
            onMouseEnter={() => setSel(i)}
            onMouseDown={() => onPick(r.it)}
          >
            <span className="lptitle">
              {markHits(r.it.title, r.hits).map((s, k) =>
                s.on ? <b key={k} className="qshit">{s.t}</b> : <span key={k}>{s.t}</span>)}
            </span>
            {/* El bundle primario no se etiqueta: es el caso normal y ponerle nombre
                a cada fila solo añade ruido. Cualquier otro sí, porque cruzar de
                bundle es la información que importa al enlazar. */}
            <span className="lppath">{r.it.bundle !== primary ? `${r.it.bundle} · ` : ""}{r.it.path}</span>
          </li>
        ))}
      </ul>
      <div className="lpfoot"><span>↑↓</span><span>↵ insertar</span><span>esc cancelar</span></div>
    </div>
  );
}
