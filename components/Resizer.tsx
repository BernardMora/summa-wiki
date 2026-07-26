"use client";
import { useEffect, useRef, useState } from "react";

const MIN = 140, MAX = 520, KEY = "wiki.sidew";

/** Drag handle on the sidebar's right edge. Width persists across sessions. */
export default function Resizer() {
  const [dragging, setDragging] = useState(false);
  const w = useRef(195);

  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= MIN && saved <= MAX) {
      w.current = saved;
      document.documentElement.style.setProperty("--sidew", `${saved}px`);
    }
    if (localStorage.getItem("wiki.sidecollapsed") === "1") {
      document.documentElement.style.setProperty("--sidew", "0px");
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
          const cur = getComputedStyle(document.documentElement).getPropertyValue("--sidew").trim();
          const collapsed = cur === "0px";
          const next = collapsed ? String(localStorage.getItem(KEY) || 195) + "px" : "0px";
          document.documentElement.style.setProperty("--sidew", next);
          localStorage.setItem("wiki.sidecollapsed", collapsed ? "0" : "1");
        }}
        title="Contraer / expandir la barra lateral"
        aria-label="Contraer barra lateral"
      >
        ⋮
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
