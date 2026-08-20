"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fuzzy } from "@/lib/fuzzy.ts";
import { useT } from "./I18n";
import { REVEAL_EVENT } from "./Crumb.tsx";

interface Item {
  name: string; path: string; dir: boolean; ext: string; id?: string; title?: string;
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
  const t = useT();
  const [show, setShow] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Load once, lazily: the list is only needed the first time it opens.
  useEffect(() => {
    if (!show || items.length) return;
    fetch("/api/fs")
      .then((r) => r.json())
      .then((d) => setItems(d.entries ?? []))
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
      const nameMatch = fuzzy(it.name, q);
      const titleMatch = it.title && it.title !== it.name ? fuzzy(it.title, q) : null;
      const t = nameMatch ?? titleMatch;
      const p = q ? fuzzy(it.path, q) : null;
      if (!t && !p) continue;
      // A title match is worth far more than the same match buried in a path.
      const score = Math.max((t?.score ?? -1e9) * 2, p?.score ?? -1e9);
      scored.push({ it, score, tHits: nameMatch?.hits ?? [], pHits: t ? [] : (p?.hits ?? []) });
    }
    scored.sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name));
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
    if (hit.it.dir) {
      window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: hit.it.path }));
    } else {
      const ext = hit.it.ext.toLowerCase();
      const id = hit.it.id
        ?? (ext === "canvas" ? `canvas:${hit.it.path}`
          : ext === "pdf" ? `pdf:${hit.it.path}`
          : ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) ? `img:${hit.it.path}`
          : `raw:${hit.it.path}`);
      const title = hit.it.id ? (hit.it.title || hit.it.name.replace(/\.md$/i, "")) : hit.it.name;
      onOpen(id, title, newTab);
    }
    setShow(false);
  }, [results, onOpen]);

  if (!show) return null;

  return (
    <div className="qsback" onMouseDown={() => setShow(false)}>
      <div className="qsbox" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="qsinput"
          placeholder={t("qs.placeholder")}
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
              key={r.it.path}
              className={`qsrow${i === sel ? " on" : ""}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(i, e.metaKey || e.ctrlKey); }}
            >
              <span className="qstitle"><Marked text={r.it.name} hits={r.tHits} /></span>
              <span className="qspath"><Marked text={r.it.path} hits={r.pHits} /></span>
              <span className="qsmeta">{r.it.dir ? t("qs.folder") : (r.it.ext ? `.${r.it.ext}` : t("qs.noExtension"))}</span>
            </li>
          ))}
        </ul>
        <div className="qsfoot">
          <span>{t("qs.move")}</span><span>{t("qs.open")}</span><span>{t("qs.newTab")}</span><span>{t("qs.escClose")}</span>
        </div>
      </div>
    </div>
  );
}
