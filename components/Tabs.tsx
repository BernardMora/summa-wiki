"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface Tab { id: string; title: string; }

interface Ctx {
  tabs: Tab[];
  activeId: string | null;
  /** Navigate to a note, replacing the active tab or adding a new one. */
  open: (id: string, title: string, newTab?: boolean) => void;
  close: (id: string) => void;
  /** Called by the article page so a directly-opened note gets a real title. */
  register: (id: string, title: string) => void;
  /** Reorder: drop `src` onto the position of `dst`. */
  move: (src: string, dst: string) => void;
}

const TabsCtx = createContext<Ctx | null>(null);
export const useTabs = () => useContext(TabsCtx);

const KEY = "wiki.tabs";

/**
 * A tab holds either a note ("bundle:path") or a PDF ("pdf:<vault path>").
 * PDFs are first-class here so they can sit in the strip and in a split pane
 * alongside the note being written about them.
 */
export const isPdfId = (id: string) => id.startsWith("pdf:");
export const hrefFor = (id: string) =>
  isPdfId(id)
    ? `/pdf?p=${encodeURIComponent(id.slice(4))}`
    : `/note/${encodeURIComponent(id)}`;

export default function TabsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const activeId =
    pathname === "/pdf"
      ? (params.get("p") ? `pdf:${params.get("p")}` : null)
      : pathname?.startsWith("/note/")
        ? decodeURIComponent(pathname.slice("/note/".length))
        : null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setTabs(JSON.parse(raw));
    } catch { /* ignore corrupt state */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(KEY, JSON.stringify(tabs));
  }, [tabs, ready]);

  // Landing on a note by any route (search, backlink, direct URL) must put it
  // in the tab strip, or the strip would drift from what is actually open.
  useEffect(() => {
    if (!ready || !activeId) return;
    setTabs((t) => (t.some((x) => x.id === activeId) ? t : [...t, { id: activeId, title: activeId.split("/").pop() ?? activeId }]));
  }, [activeId, ready]);

  // Child effects run before parent effects, so the article registers its title
  // BEFORE the provider has added the placeholder tab. Insert if missing.
  const register = useCallback((id: string, title: string) => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.id === id);
      if (i < 0) return [...t, { id, title }];
      if (t[i].title === title) return t;
      const next = [...t];
      next[i] = { ...next[i], title };
      return next;
    });
  }, []);

  const open = useCallback((id: string, title: string, newTab = false) => {
    setTabs((t) => {
      if (t.some((x) => x.id === id)) return t;
      if (newTab || !activeId) return [...t, { id, title }];
      // Replace the active tab in place, browser-style.
      const i = t.findIndex((x) => x.id === activeId);
      if (i < 0) return [...t, { id, title }];
      const next = [...t];
      next[i] = { id, title };
      return next;
    });
    router.push(hrefFor(id));
  }, [activeId, router]);

  const close = useCallback((id: string) => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.id === id);
      const next = t.filter((x) => x.id !== id);
      if (id === activeId) {
        const fallback = next[Math.min(i, next.length - 1)];
        router.push(fallback ? hrefFor(fallback.id) : "/");
      }
      return next;
    });
  }, [activeId, router]);

  const move = useCallback((src: string, dst: string) => {
    setTabs((t) => {
      const from = t.findIndex((x) => x.id === src);
      const to = t.findIndex((x) => x.id === dst);
      if (from < 0 || to < 0) return t;
      const next = [...t];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  return (
    <TabsCtx.Provider value={{ tabs, activeId, open, close, register, move }}>
      {children}
    </TabsCtx.Provider>
  );
}

export function TabBar() {
  const ctx = useTabs();
  const router = useRouter();
  const [drag, setDrag] = useState<string | null>(null);
  if (!ctx || ctx.tabs.length === 0) return null;

  return (
    <div className="tabstrip">
      {ctx.tabs.map((t) => (
        <div
          key={t.id}
          className={`otab${t.id === ctx.activeId ? " on" : ""}${drag === t.id ? " dragging" : ""}`}
          draggable
          onDragStart={(e) => { setDrag(t.id); e.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDrop={(e) => { e.preventDefault(); if (drag && drag !== t.id) ctx.move(drag, t.id); setDrag(null); }}
          onMouseDown={(e) => {
            if (e.button === 1) { e.preventDefault(); ctx.close(t.id); }   // middle-click closes
          }}
          onClick={() => router.push(hrefFor(t.id))}
          title={t.id}
        >
          <span className="otab-title">{isPdfId(t.id) && <span className="otab-kind">PDF</span>}{t.title}</span>
          <button
            className="otab-x"
            onClick={(e) => { e.stopPropagation(); ctx.close(t.id); }}
            aria-label={`Cerrar ${t.title}`}
          >
            ×
          </button>
        </div>
      ))}
      {ctx.tabs.length > 1 && (
        <button
          className="otab-closeall"
          onClick={() => ctx.tabs.forEach((t) => ctx.close(t.id))}
          title="Cerrar todas"
        >
          Cerrar todas
        </button>
      )}
    </div>
  );
}
