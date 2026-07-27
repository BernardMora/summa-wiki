"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import ArticlePane, { type Payload } from "./ArticlePane.tsx";
import PdfViewer from "./PdfViewer.tsx";
import GraphView from "./GraphView.tsx";
import { publishActive, isPdfId, isImgId, isGraphId, GRAPH_ID, hrefFor } from "./Tabs.tsx";
import QuickSwitcher from "./QuickSwitcher.tsx";

export interface Tab { id: string; title: string; }
export interface Pane { key: string; tabs: Tab[]; activeId: string | null; }

// Definidos una sola vez en Tabs.tsx: la copia que vivía aquí no conocía el
// grafo y habría producido /note/graph%3A al sincronizar la URL.
export { isPdfId, isImgId, isFileId, hrefFor, isGraphId, GRAPH_ID } from "./Tabs.tsx";

interface Ctx {
  open: (id: string, title: string, newTab?: boolean) => void;
  panes: Pane[];
  activePane: string;
}
const WsCtx = createContext<Ctx | null>(null);
export const useWorkspace = () => useContext(WsCtx);

const KEY = "wiki.workspace";
const newKey = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** "tabs" = sobre la barra de pestañas: reordenar en vez de dividir. */
type Zone = "left" | "right" | "center" | "tabs";
interface DragState {
  tab: Tab; fromPane: string; x: number; y: number;
  overPane: string | null; zone: Zone;
  /** Posición de inserción dentro de la barra, solo cuando zone === "tabs". */
  index: number | null;
}

/**
 * Obsidian-style workspace: panes own their tabs.
 *
 * Dragging a tab shows a ghost pill under the cursor and paints the region it
 * would land in, so the outcome is visible before releasing. Dropping on the
 * left or right quarter of a pane splits; dropping in the middle moves the tab
 * into that pane.
 */
export default function Workspace({ initial }: { initial: Payload }) {
  const [panes, setPanes] = useState<Pane[]>([
    { key: "p0", tabs: [{ id: initial.id, title: initial.meta.title }], activeId: initial.id },
  ]);
  const [activePane, setActivePane] = useState("p0");
  const [ratio, setRatio] = useState(0.5);
  const [drag, setDrag] = useState<DragState | null>(null);
  const tabBars = useRef(new Map<string, HTMLElement>());
  const [barDrag, setBarDrag] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const paneEls = useRef(new Map<string, HTMLElement>());
  // Every note pane registers its editor; a quote goes to the most recently
  // focused one.
  const noteEditors = useRef(new Map<string, EditorView>());
  const lastNotePane = useRef<string | null>(null);
  const [hasNotePane, setHasNotePane] = useState(false);
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  // ---------------------------------------------------------------- persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.panes) && s.panes.length) {
          // Make sure the note in the URL is present and focused.
          const has = s.panes.some((p: Pane) => p.tabs.some((t) => t.id === initial.id));
          if (!has) {
            s.panes[0].tabs.push({ id: initial.id, title: initial.meta.title });
          }
          s.panes = s.panes.map((p: Pane) =>
            p.tabs.some((t) => t.id === initial.id) ? { ...p, activeId: initial.id } : p,
          );
          setPanes(s.panes);
          setActivePane(s.panes.find((p: Pane) => p.activeId === initial.id)?.key ?? s.panes[0].key);
          if (typeof s.ratio === "number") setRatio(s.ratio);
        }
      }
    } catch { /* corrupt layout: start fresh */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify({ panes, ratio }));
  }, [panes, ratio, hydrated]);

  // ---------------------------------------------------------------- actions
  const open = useCallback((id: string, title: string, newTab = false) => {
    setPanes((ps) => ps.map((p) => {
      if (p.key !== activePane) return p;
      if (p.tabs.some((t) => t.id === id)) return { ...p, activeId: id };
      if (newTab || !p.activeId) return { ...p, tabs: [...p.tabs, { id, title }], activeId: id };
      const i = p.tabs.findIndex((t) => t.id === p.activeId);
      const tabs = [...p.tabs];
      tabs[i] = { id, title };
      return { ...p, tabs, activeId: id };
    }));
    // Deliberately no router.push: navigating remounts the workspace, which
    // reset the pane layout and closed the split. The URL is maintained by the
    // effect above instead.
  }, [activePane]);

  const closeTab = useCallback((paneKey: string, id: string) => {
    setPanes((ps) => {
      const next = ps.map((p) => {
        if (p.key !== paneKey) return p;
        const tabs = p.tabs.filter((t) => t.id !== id);
        const wasActive = p.activeId === id;
        return { ...p, tabs, activeId: wasActive ? (tabs[tabs.length - 1]?.id ?? null) : p.activeId };
      }).filter((p) => p.tabs.length > 0);          // an empty pane disappears
      return next.length ? next : [{ key: "p0", tabs: [], activeId: null }];
    });
  }, []);

  /** Drop a dragged tab: split the target pane, or move the tab into it. */
  const drop = useCallback((d: DragState) => {
    if (!d.overPane) return;
    setPanes((ps) => {
      const from = ps.find((p) => p.key === d.fromPane);
      if (!from) return ps;
      const sameSolo = d.fromPane === d.overPane && from.tabs.length === 1;

      // Reordenar / insertar en una posición concreta de la barra.
      if (d.zone === "tabs" && d.index !== null) {
        const target = ps.find((p) => p.key === d.overPane);
        if (!target) return ps;
        if (d.fromPane === d.overPane) {
          const at = from.tabs.findIndex((t) => t.id === d.tab.id);
          // El índice se calculó sobre la lista con la pestaña todavía dentro,
          // así que al sacarla todo lo que venía después se corre uno.
          const to = d.index > at ? d.index - 1 : d.index;
          if (to === at) return ps;
          const tabs = from.tabs.filter((t) => t.id !== d.tab.id);
          tabs.splice(to, 0, d.tab);
          return ps.map((p) => (p.key === d.fromPane ? { ...p, tabs, activeId: d.tab.id } : p));
        }
        return ps.map((p) => {
          if (p.key === d.fromPane) {
            const tabs = p.tabs.filter((t) => t.id !== d.tab.id);
            return { ...p, tabs, activeId: p.activeId === d.tab.id ? (tabs.slice(-1)[0]?.id ?? null) : p.activeId };
          }
          if (p.key === d.overPane) {
            const tabs = [...p.tabs];
            tabs.splice(d.index!, 0, d.tab);
            return { ...p, tabs, activeId: d.tab.id };
          }
          return p;
        }).filter((p) => p.tabs.length > 0);
      }

      if (d.zone === "center" && d.fromPane === d.overPane) return ps;
      if (sameSolo && d.zone !== "center") return ps;    // nothing to split off

      let next = ps.map((p) =>
        p.key === d.fromPane
          ? { ...p, tabs: p.tabs.filter((t) => t.id !== d.tab.id),
              activeId: p.activeId === d.tab.id ? (p.tabs.filter((t) => t.id !== d.tab.id).slice(-1)[0]?.id ?? null) : p.activeId }
          : p,
      );

      if (d.zone === "center") {
        next = next.map((p) =>
          p.key === d.overPane ? { ...p, tabs: [...p.tabs, d.tab], activeId: d.tab.id } : p,
        );
      } else {
        const fresh: Pane = { key: newKey(), tabs: [d.tab], activeId: d.tab.id };
        const at = next.findIndex((p) => p.key === d.overPane);
        next.splice(d.zone === "left" ? at : at + 1, 0, fresh);
        setActivePane(fresh.key);
      }
      return next.filter((p) => p.tabs.length > 0);
    });
  }, []);

  /**
   * Send a PDF quote into the most recently focused note pane. Offered only
   * when such a pane exists — quoting into nothing would silently do nothing.
   */
  const insertQuote = useCallback((md: string) => {
    const key = lastNotePane.current ?? [...noteEditors.current.keys()][0];
    const v = key ? noteEditors.current.get(key) : undefined;
    if (!v) return;
    const pos = v.state.doc.lineAt(v.state.selection.main.to).to;
    v.dispatch({ changes: { from: pos, insert: `\n\n${md}` }, selection: { anchor: pos + md.length + 2 } });
    v.focus();
  }, []);

  // The sidebar and file tree live outside this subtree; expose open() to them
  // and publish the focused tab so the tree highlight follows the panes rather
  // than the URL.
  useEffect(() => {
    (window as any).__wikiOpen = open;
    return () => { delete (window as any).__wikiOpen; };
  }, [open]);

  useEffect(() => {
    document.body.classList.add("workspace");
    return () => document.body.classList.remove("workspace");
  }, []);

  const focused = panes.find((p) => p.key === activePane)?.activeId ?? null;
  useEffect(() => { publishActive(focused); }, [focused]);

  // Keep the address bar on the focused NOTE. File tabs deliberately do not
  // rewrite it: /pdf is a standalone route, and pointing the URL there would
  // reload into a single PDF instead of this workspace.
  useEffect(() => {
    if (focused && !isPdfId(focused) && !isImgId(focused)) {
      window.history.replaceState(null, "", hrefFor(focused));
    }
  }, [focused]);

  // ---------------------------------------------------------------- drag
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      let overPane: string | null = null;
      let zone: Zone = "center";
      let index: number | null = null;

      // La barra de pestañas se consulta primero: está dentro del panel, así que
      // sin esta precedencia el arrastre siempre caería en dividir o mover.
      for (const [k, bar] of tabBars.current) {
        const r = bar.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          overPane = k; zone = "tabs";
          const tabs = [...bar.querySelectorAll<HTMLElement>(".otab")];
          index = tabs.length;
          for (let i = 0; i < tabs.length; i++) {
            const tr = tabs[i].getBoundingClientRect();
            if (e.clientX < tr.left + tr.width / 2) { index = i; break; }
          }
          break;
        }
      }
      if (!overPane) {
        for (const [k, el] of paneEls.current) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            overPane = k;
            const rel = (e.clientX - r.left) / r.width;
            zone = rel < 0.28 ? "left" : rel > 0.72 ? "right" : "center";
          }
        }
      }
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, overPane, zone, index } : d));
    };
    const up = () => {
      // drop() se llamaba dentro del updater de setDrag. React invoca los
      // updaters dos veces en StrictMode, así que el efecto secundario corría
      // duplicado: un solo arrastre creaba dos paneles y clonaba la pestaña.
      // El efecto se resuscribe en cada movimiento, así que `drag` está al día.
      drop(drag);
      setDrag(null);
      document.body.classList.remove("dragging-tab");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, drop]);

  // ---------------------------------------------------------------- divider
  useEffect(() => {
    if (!barDrag) return;
    const move = (e: MouseEvent) => {
      const b = wrap.current?.getBoundingClientRect();
      if (b) setRatio(Math.min(0.8, Math.max(0.2, (e.clientX - b.left) / b.width)));
    };
    const up = () => { setBarDrag(false); document.body.classList.remove("resizing"); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [barDrag]);

  const overlayFor = (paneKey: string) => {
    if (!drag || drag.overPane !== paneKey || drag.zone === "tabs") return null;
    return <div className={`dropzone ${drag.zone}`} />;
  };

  const cols = panes.length === 2
    ? `${ratio}fr 7px ${1 - ratio}fr`
    : panes.map(() => "1fr").join(" 7px ");

  return (
    <WsCtx.Provider value={{ open, panes, activePane }}>
      <QuickSwitcher onOpen={open} />
      <div className="wsgrid" ref={wrap} style={{ gridTemplateColumns: cols }}>
        {panes.map((p, i) => (
          <Fragment key={p.key}>
            {i > 0 && (
              <div
                key={`bar${p.key}`}
                className={`splitbar${barDrag ? " dragging" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); setBarDrag(true); document.body.classList.add("resizing"); }}
                onDoubleClick={() => setRatio(0.5)}
                title="Arrastra para redimensionar · doble clic para 50/50"
              />
            )}
            <div
              key={p.key}
              className={`wspane${activePane === p.key ? " active" : ""}`}
              ref={(el) => { if (el) paneEls.current.set(p.key, el); else paneEls.current.delete(p.key); }}
              onMouseDown={() => setActivePane(p.key)}
            >
              <div
                className="panetabs"
                ref={(el) => { if (el) tabBars.current.set(p.key, el); else tabBars.current.delete(p.key); }}
              >
                {p.tabs.map((t, ti) => (
                  <div
                    key={t.id}
                    className={`otab${t.id === p.activeId ? " on" : ""}${drag?.tab.id === t.id ? " ghosted" : ""}`
                      + (drag?.zone === "tabs" && drag.overPane === p.key && drag.index === ti ? " insbefore" : "")}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      setActivePane(p.key);
                      setPanes((ps) => ps.map((q) => (q.key === p.key ? { ...q, activeId: t.id } : q)));
                      const startX = e.clientX, startY = e.clientY;
                      const el = e.currentTarget;
                      // Sin capturar el puntero, un movimiento rápido lo saca de
                      // la pestaña antes de cruzar el umbral de 5 px y el
                      // arrastre nunca arranca.
                      try { el.setPointerCapture(e.pointerId); } catch { /* no soportado */ }
                      const onMove = (ev: PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
                          el.removeEventListener("pointermove", onMove as any);
                          document.body.classList.add("dragging-tab");
                          setDrag({ tab: t, fromPane: p.key, x: ev.clientX, y: ev.clientY, overPane: null, zone: "center", index: null });
                        }
                      };
                      el.addEventListener("pointermove", onMove as any);
                      el.addEventListener("pointerup", () => {
                        el.removeEventListener("pointermove", onMove as any);
                        try { el.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
                      }, { once: true });

                    }}
                    title={t.id}
                  >
                    <span className="otab-title">
                      {isPdfId(t.id) && <span className="otab-kind">PDF</span>}
                      {isImgId(t.id) && <span className="otab-kind">IMG</span>}
                      {t.title}
                    </span>
                    <button
                      className="otab-x"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); closeTab(p.key, t.id); }}
                      aria-label={`Cerrar ${t.title}`}
                    >×</button>
                  </div>
                ))}
                {drag?.zone === "tabs" && drag.overPane === p.key && drag.index === p.tabs.length && (
                  <span className="insend" aria-hidden />
                )}
              </div>

              <div className="panecontent">
                {p.activeId === null ? (
                  <p className="dim" style={{ padding: 20 }}>Panel vacío.</p>
                ) : isGraphId(p.activeId) ? (
                  <div className="panescroll">
                    <article>
                      <h1>Grafo</h1>
                      <p className="infoline">
                        <span>arrastra un nodo para moverlo</span><span>rueda para zoom</span>
                        <span>clic abre la nota</span><span>⌘clic en pestaña nueva</span>
                      </p>
                      <GraphView />
                    </article>
                  </div>
                ) : isImgId(p.activeId) ? (
                  <div className="imgview">
                    <div className="imgbar">
                      <span className="imgname">{p.activeId.slice(4).split("/").pop()}</span>
                      <a className="dim" style={{ marginLeft: "auto" }}
                         href={`/api/asset?p=${encodeURIComponent(p.activeId.slice(4))}`} download>Descargar</a>
                    </div>
                    <div className="imgscroll">
                      <img src={`/api/asset?p=${encodeURIComponent(p.activeId.slice(4))}`}
                           alt={p.activeId.slice(4)} />
                    </div>
                  </div>
                ) : isPdfId(p.activeId) ? (
                  <PdfViewer
                    src={`/api/asset?p=${encodeURIComponent(p.activeId.slice(4))}`}
                    name={p.activeId.slice(4).split("/").pop() ?? "pdf"}
                    path={p.activeId.slice(4)}
                    // Only offered when another pane holds a note to receive it.
                    onQuote={hasNotePane ? insertQuote : undefined}
                  />
                ) : p.activeId === initial.id ? (
                  <ArticlePane key={p.activeId} initial={initial} showToc={panes.length === 1}
                    onEditorReady={(v) => {
                      noteEditors.current.set(p.key, v);
                      lastNotePane.current = p.key;
                      setHasNotePane(true);
                    }} />
                ) : (
                  // Keyed by note: switching tabs must remount. Without this
                  // React reused the pane, and CodeMirror — whose document is
                  // built once — kept showing the previous note.
                  <ArticlePane key={p.activeId} id={p.activeId} showToc={panes.length === 1}
                    onEditorReady={(v) => {
                      noteEditors.current.set(p.key, v);
                      lastNotePane.current = p.key;
                      setHasNotePane(true);
                    }} />
                )}
              </div>

              {overlayFor(p.key)}
            </div>
          </Fragment>
        ))}
      </div>

      {drag && (
        <div className="dragghost" style={{ left: drag.x + 12, top: drag.y + 10 }}>
          <span className="dragghost-ico">▤</span>{drag.tab.title}
        </div>
      )}
    </WsCtx.Provider>
  );
}
