"use client";
import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";

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
    const onScroll = () => {
      let best: number | null = null;
      for (const h of heads) {
        try {
          const pos = view.state.doc.line(h.line).from;
          const c = view.coordsAtPos(pos);
          if (c && c.top < 140) best = h.line;
        } catch { /* line vanished mid-edit */ }
      }
      setActive(best);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [view, heads]);

  if (heads.length === 0) return null;

  const min = Math.min(...heads.map((h) => h.level));

  function go(h: Head) {
    if (!view) return;
    try {
      const pos = view.state.doc.line(h.line).from;
      const c = view.coordsAtPos(pos);
      if (c) window.scrollBy({ top: c.top - 110, behavior: "smooth" });
    } catch { /* ignore */ }
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
