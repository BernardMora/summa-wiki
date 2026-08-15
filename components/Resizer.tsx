"use client";
import { useEffect, useRef, useState } from "react";

const MIN = 140, MAX = 520, KEY = "wiki.sidew";

/** Drag handle on the sidebar's right edge. Width persists across sessions. */
export default function Resizer() {
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const w = useRef(195);

  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= MIN && saved <= MAX) {
      w.current = saved;
      document.documentElement.style.setProperty("--sidew", `${saved}px`);
    }
    if (localStorage.getItem("wiki.sidecollapsed") === "1") {
      document.documentElement.style.setProperty("--sidew", "0px");
      document.documentElement.dataset.side = "collapsed";
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const next = Math.min(MAX, Math.max(MIN, e.clientX));
      w.current = next;
      document.documentElement.style.setProperty("--sidew", `${next}px`);
    };
    const up = () => {
      setDragging(false);
      document.body.classList.remove("resizing");
      localStorage.setItem(KEY, String(w.current));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging]);

  return (
    <>
      <button
        className="sidetoggle"
        style={{ left: "var(--sidew)" }}
        onClick={() => {
          const next = collapsed ? `${localStorage.getItem(KEY) || 195}px` : "0px";
          document.documentElement.style.setProperty("--sidew", next);
          // El atributo va con la variable: la barra se apaga con `display`,
          // porque a 0 el padding la dejaba asomando. Ver globals.css.
          if (collapsed) delete document.documentElement.dataset.side;
          else document.documentElement.dataset.side = "collapsed";
          localStorage.setItem("wiki.sidecollapsed", collapsed ? "0" : "1");
          setCollapsed(!collapsed);
        }}
        title="Contraer / expandir la barra lateral"
        aria-label="Contraer barra lateral"
      >
        {collapsed ? "›" : "‹"}
      </button>
    <div
      className={`resizer${dragging ? " dragging" : ""}`}
      style={{ left: "var(--sidew)" }}
      onMouseDown={(e) => { e.preventDefault(); setDragging(true); document.body.classList.add("resizing"); }}
      onDoubleClick={() => {
        w.current = 195;
        document.documentElement.style.setProperty("--sidew", "195px");
        localStorage.setItem(KEY, "195");
      }}
      title="Arrastra para redimensionar · doble clic para restablecer"
      role="separator"
      aria-orientation="vertical"
    />
    </>
  );
}
