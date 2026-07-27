"use client";
import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";

export interface Head { level: number; text: string; line: number; }

/**
 * Headings for the contents rail. Parsed from the raw markdown rather than the
 * syntax tree so it stays cheap to recompute on every keystroke, and so it
 * works before the editor has mounted.
 */
export function parseHeads(md: string): Head[] {
  const lines = md.split("\n");
  const out: Head[] = [];
  let inFence = false;
  let inFm = lines[0]?.trim() === "---";

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFm) { if (i > 0 && l.trim() === "---") inFm = false; continue; }
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(l);
    if (m) {
      out.push({
        level: m[1].length,
        // Strip inline markup so the rail reads cleanly.
        text: m[2].replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim(),
        line: i + 1,
      });
    }
  }
  return out;
}

/**
 * Contenedor que realmente hace scroll.
 *
 * El TOC se escribió cuando la ventana era el scroller. Desde que cada panel
 * tiene el suyo (`.panescroll`), `window.scrollBy` no movía nada y el evento
 * `scroll` de la ventana no se disparaba: ni el clic navegaba ni se resaltaba
 * el encabezado activo.
 */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return null;
}

export default function Toc({
  heads, view,
}: { heads: Head[]; view: EditorView | null }) {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("wiki.toc");
    if (saved === "0") setOpen(false);
  }, []);
  useEffect(() => { localStorage.setItem("wiki.toc", open ? "1" : "0"); }, [open]);

  // Highlight whichever heading is nearest the top of the viewport.
  useEffect(() => {
    if (!view || heads.length === 0) return;
    const sc = scrollerOf(view.dom);
    const top = sc ? sc.getBoundingClientRect().top : 0;
    const onScroll = () => {
      let best: number | null = null;
      for (const h of heads) {
        try {
          const pos = view.state.doc.line(h.line).from;
          const c = view.coordsAtPos(pos);
          if (c && c.top - top < 140) best = h.line;
        } catch { /* line vanished mid-edit */ }
      }
      setActive(best);
    };
    onScroll();
    const target: HTMLElement | Window = sc ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [view, heads]);

  if (heads.length === 0) return null;

  const min = Math.min(...heads.map((h) => h.level));

  function go(h: Head) {
    if (!view) return;
    let pos: number;
    try { pos = view.state.doc.line(h.line).from; } catch { return; }

    // CodeMirror virtualiza: una línea fuera del viewport no está renderizada,
    // `coordsAtPos` devuelve null, y las alturas de lo no medido son estimadas.
    // Al acercarse, esas estimaciones se sustituyen por medidas reales y el
    // destino se corre — por eso un solo salto se quedaba corto. Se corrige en
    // varias pasadas hasta que el error es despreciable.
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }) });

    const sc = scrollerOf(view.dom);
    let tries = 0;
    const settle = () => {
      const c = view.coordsAtPos(pos);
      if (!c) { if (tries++ < 6) requestAnimationFrame(settle); return; }
      const top = sc ? sc.getBoundingClientRect().top : 0;
      const delta = c.top - top - (sc ? 24 : 110);
      if (Math.abs(delta) < 3 || tries++ > 6) return;
      // Salto instantáneo: con desplazamiento suave se mide a mitad de la
      // animación y la corrección se acumula mal.
      if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta);
      requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  }

  return (
    <aside className={`toc${open ? "" : " closed"}`}>
      <button className="toctoggle" onClick={() => setOpen((v) => !v)} title="Contenidos">
        {open ? "Contenidos ›" : "‹"}
      </button>
      {open && (
        <nav>
          {heads.map((h, i) => (
            <a
              key={`${h.line}-${i}`}
              className={`tocitem${active === h.line ? " on" : ""}`}
              style={{ paddingLeft: 6 + (h.level - min) * 11 }}
              onClick={(e) => { e.preventDefault(); go(h); }}
              href="#"
              title={h.text}
            >
              {h.text}
            </a>
          ))}
        </nav>
      )}
    </aside>
  );
}
