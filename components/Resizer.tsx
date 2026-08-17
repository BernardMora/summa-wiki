"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

const MIN = 140, MAX = 520, KEY = "wiki.sidew";

/** Drag handle on the sidebar's right edge. Width persists across sessions. */
export default function Resizer() {
  const t = useT();
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
        className={`sidetoggle${collapsed ? " collapsed" : ""}`}
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
        title={t("chrome.toggleSidebar")}
        aria-label={t("chrome.toggleSidebar")}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="4" width="17" height="16" rx="2" />
            <path d="M9 4v16" />
            <path className="side-arrow" d="m13 9 3 3-3 3" />
          </svg>
        ) : (
          <svg className="side-chevron" viewBox="0 0 12 20" aria-hidden="true">
            <path d="m8 5-4 5 4 5" />
          </svg>
        )}
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
      title={t("chrome.dragResize")}
      role="separator"
      aria-orientation="vertical"
    />
    </>
  );
}
