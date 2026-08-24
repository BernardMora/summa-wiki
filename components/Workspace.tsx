"use client";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import ArticlePane, { type Payload } from "./ArticlePane.tsx";
import PdfViewer from "./PdfViewer.tsx";
import GraphView from "./GraphView.tsx";
import CanvasEditor from "./CanvasEditor.tsx";
import RawFilePane from "./RawFilePane.tsx";
import AgentChat from "./AgentChat.tsx";
import { publishActive, isPdfId, isImgId, isCanvasId, isRawId, isChatId, isFileId, isGraphId, GRAPH_ID, hrefFor, forgetChatAgent } from "./Tabs.tsx";
import QuickSwitcher from "./QuickSwitcher.tsx";
import { useT } from "./I18n";
import SidebarToggle from "./SidebarToggle.tsx";
import { queueChatInput, registerChatWorkspace, chatTargets } from "./chatBridge.ts";
import { subscribeUiActions } from "./acp-ui.ts";
import { runInNewChat } from "./AgentChat.tsx";
import { newChatId, rememberChatAgent } from "./Tabs.tsx";
import { useDefaultAgent } from "./DefaultAgent.tsx";

export interface Tab { id: string; title: string; }
export interface Pane {
  key: string; tabs: Tab[]; activeId: string | null;
  /** Any number of columns; each column has at most one top and one bottom pane. */
  column: string; slot: "top" | "bottom";
}

// Definidos una sola vez en Tabs.tsx: la copia que vivía aquí no conocía el
// grafo y habría producido /note/graph%3A al sincronizar la URL.
export { isPdfId, isImgId, isCanvasId, isRawId, isChatId, isFileId, hrefFor, isGraphId, GRAPH_ID } from "./Tabs.tsx";

interface Ctx {
  open: (id: string, title: string, newTab?: boolean) => void;
  panes: Pane[];
  activePane: string;
}
const WsCtx = createContext<Ctx | null>(null);
export const useWorkspace = () => useContext(WsCtx);

const KEY = "wiki.workspace";
const newKey = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const newColumn = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const normalizePanes = (input: Pane[]) => {
  const panes = input.filter((pane) => pane.tabs.length > 0);
  return panes.map((pane) => panes.filter((candidate) => candidate.column === pane.column).length === 1
    ? { ...pane, slot: "top" as const } : pane);
};

/** "tabs" = sobre la barra de pestañas: reordenar en vez de dividir. */
type Zone = "left" | "right" | "top" | "bottom" | "center" | "tabs";
type LayoutDirection = "columns" | "rows";
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
export default function Workspace({ initial, seed, vaultKey }: {
  /**
   * La nota que trae la URL. `null` en /workspace, que monta el mismo
   * workspace sin nota — es adonde va todo lo que no es una nota (terminal,
   * grafo, PDF…) cuando se abre desde una página sin panes montados.
   */
  initial: Payload | null;
  /** Pestaña a abrir al montar, de `?open=`. Se aplica una sola vez. */
  seed?: { id: string; title: string } | null;
  /** Identidad estable del vault; impide restaurar pestañas de otro vault. */
  vaultKey: string;
}) {
  const t = useT();
  const defaultAgent = useDefaultAgent();
  const [panes, setPanes] = useState<Pane[]>([
    initial
      ? { key: "p0", column: "c0", slot: "top", tabs: [{ id: initial.id, title: initial.meta.title }], activeId: initial.id }
      : { key: "p0", column: "c0", slot: "top", tabs: [], activeId: null },
  ]);
  const [activePane, setActivePane] = useState("p0");
  const [ratio, setRatio] = useState(0.5);
  const [rowRatios, setRowRatios] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const tabBars = useRef(new Map<string, HTMLElement>());
  const [barDrag, setBarDrag] = useState<{ axis: LayoutDirection; column?: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const paneEls = useRef(new Map<string, HTMLElement>());
  // Every note pane registers its editor; a quote goes to the most recently
  // focused one.
  const noteEditors = useRef(new Map<string, EditorView>());
  const lastNotePane = useRef<string | null>(null);
  const [hasNotePane, setHasNotePane] = useState(false);
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; paneKey: string; tab: Tab } | null>(null);
  /** El submenú de "añadir a…" del menú contextual de una pestaña. */
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  /**
   * El id de la pestaña de chat cuyo nombre se está escribiendo ahora mismo.
   *
   * El id y no el par (panel, id): una pestaña puede cambiar de panel —la
   * arrastras, o la envías a un panel nuevo desde este mismo menú— y una clave
   * de panel guardada de antes apuntaría a un sitio donde la pestaña ya no
   * está. Los ids son únicos entre paneles: `open()` activa la que ya existe
   * en vez de duplicarla.
   */
  const [renaming, setRenaming] = useState<string | null>(null);

  // ---------------------------------------------------------------- persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.vault === vaultKey && Array.isArray(s.panes) && s.panes.length) {
          // Make sure the note in the URL is present and focused. Sin nota en
          // la URL (/workspace) se restaura el layout tal cual: no hay nada
          // que forzar al frente, y la pestaña que se pidió por `?open=` la
          // añade el efecto de más abajo.
          // Migration: the previous model stored one global orientation. Turn
          // horizontal panes into columns and at most the first two vertical
          // panes into the top/bottom pair of a column.
          s.panes = s.panes.map((pane: Partial<Pane>, index: number) => ({
            ...pane,
            column: pane.column ?? (s.layout === "rows" && index < 2 ? "c0" : `c${index}`),
            slot: pane.slot ?? (s.layout === "rows" && index === 1 ? "bottom" : "top"),
          }));
          if (initial) {
            const has = s.panes.some((p: Pane) => p.tabs.some((t) => t.id === initial.id));
            if (!has) {
              s.panes[0].tabs.push({ id: initial.id, title: initial.meta.title });
            }
            s.panes = s.panes.map((p: Pane) =>
              p.tabs.some((t) => t.id === initial.id) ? { ...p, activeId: initial.id } : p,
            );
          }
          setPanes(s.panes);
          setActivePane(
            (initial && s.panes.find((p: Pane) => p.activeId === initial.id)?.key) ?? s.panes[0].key,
          );
          if (typeof s.ratio === "number") setRatio(s.ratio);
          if (s.rowRatios && typeof s.rowRatios === "object") setRowRatios(s.rowRatios);
        }
      }
    } catch { /* corrupt layout: start fresh */ }
    setHydrated(true);
  }, [vaultKey]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify({ vault: vaultKey, panes, ratio, rowRatios }));
  }, [vaultKey, panes, ratio, rowRatios, hydrated]);

  // ---------------------------------------------------------------- actions
  const open = useCallback((id: string, title: string, newTab = false) => {
    setPanes((ps) => {
      // Una pestaña ya abierta se activa donde esté, incluso si vive en otro
      // panel. Esto evita duplicar vistas singleton como el grafo.
      const existing = ps.find((p) => p.tabs.some((t) => t.id === id));
      if (existing) {
        setActivePane(existing.key);
        return ps.map((p) => p.key === existing.key ? { ...p, activeId: id } : p);
      }
      return ps.map((p) => {
      if (p.key !== activePane) return p;
      // Una pestaña con sesión viva no se reemplaza: se abre una al lado.
      //
      // Reemplazar es el comportamiento normal —abrir notas desde el árbol no
      // debe llenar la barra— y para una nota no cuesta nada, porque volver a
      // abrirla la reconstruye idéntica. Una terminal no: el proceso sigue
      // corriendo en el servidor (la pty sobrevive a todo menos a `closeTab`,
      // que es la única que hace DELETE). Reemplazar su pestaña no la cerraba,
      // la volvía inalcanzable — con el comando a medio escribir y el proceso
      // vivo, sin nada en la interfaz que lo dijera.
      // Un chat cuenta como sesión viva por lo mismo que la terminal: el
      // agente corre en el servidor y puede estar a mitad de un turno.
      if (newTab || !p.activeId || isChatId(p.activeId))
        return { ...p, tabs: [...p.tabs, { id, title }], activeId: id };
      const i = p.tabs.findIndex((t) => t.id === p.activeId);
      const tabs = [...p.tabs];
      tabs[i] = { id, title };
      return { ...p, tabs, activeId: id };
      });
    });
    // Deliberately no router.push: navigating remounts the workspace, which
    // reset the pane layout and closed the split. The URL is maintained by the
    // effect above instead.
  }, [activePane]);

  /**
   * La pestaña que pidió `?open=`, una sola vez y DESPUÉS de hidratar: antes
   * de hidratar, la restauración desde localStorage la pisaría.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (!hydrated || !seed || seeded.current) return;
    seeded.current = true;
    open(seed.id, seed.title, true);
  }, [hydrated, seed, open]);

  /**
   * Rename a chat tab.
   *
   * Only a chat's title is the tab's to change. Every other tab is named after
   * something that exists outside the workspace — a note, a PDF, a canvas — and
   * a tab that said something different from the file it shows would be a label
   * lying about its contents. A conversation has no such external name: "Chat"
   * is a placeholder, and the fourth one open is indistinguishable from the
   * other three.
   *
   * Nothing extra is persisted. Tab titles already live in the workspace layout
   * in `localStorage`, `open()` leaves the title of an already-open tab alone,
   * and `chatTargets()` reads the same field — so the new name survives a
   * reload and shows up in "add to chat" without another store to keep in sync.
   */
  const renameTab = useCallback((id: string, title: string) => {
    const name = title.trim();
    setRenaming(null);
    // An empty name is a rename that undoes itself: the tab would be a bare ×
    // with nothing to grab or read. Cancelling is what the user meant.
    if (!name) return;
    setPanes((ps) => ps.map((p) => ({
      ...p,
      tabs: p.tabs.map((tab) => (tab.id === id ? { ...tab, title: name } : tab)),
    })));
  }, []);

  const closeTab = useCallback((paneKey: string, id: string) => {
    /*
     * La conversación sobrevive a cambiar de pestaña o recargar (server.ts):
     * cerrarla con la × es la única acción que debe matarla, y matarla mata al
     * agente Y a los comandos que haya lanzado, que son procesos aparte y no
     * morirían con él.
     *
     * Se cierran TODOS los harnesses de la pestaña, no solo el seleccionado.
     * Una pestaña de chat puede tener varias sesiones vivas debajo —una por
     * cada harness al que se cambió— y cerrar solo la visible dejaría a los
     * demás corriendo sin ninguna pestaña que los mostrara ni forma de
     * volverlos a encontrar. `?prefix=` es lo que le pide eso a la ruta.
     */
    if (isChatId(id)) {
      fetch(`/api/acp?prefix=${encodeURIComponent(id)}`, { method: "DELETE" });
      forgetChatAgent(id);
    }
    setPanes((ps) => {
      const next = ps.map((p) => {
        if (p.key !== paneKey) return p;
        const tabs = p.tabs.filter((t) => t.id !== id);
        const wasActive = p.activeId === id;
        return { ...p, tabs, activeId: wasActive ? (tabs[tabs.length - 1]?.id ?? null) : p.activeId };
      });
      const normalized = normalizePanes(next);      // an empty pane disappears
      if (!normalized.length) return [{ key: "p0", column: "c0", slot: "top", tabs: [], activeId: null }];
      return normalized;
    });
  }, []);

  const splitTab = useCallback((paneKey: string, tab: Tab, direction: LayoutDirection) => {
    setPanes((current) => {
      const sourceIndex = current.findIndex((pane) => pane.key === paneKey);
      if (sourceIndex < 0) return current;
      const source = current[sourceIndex];
      if (direction === "rows" && current.some((pane) => pane.column === source.column && pane.slot === "bottom")) return current;
      const keepOriginal = source.tabs.length === 1;
      const remaining = keepOriginal ? source.tabs : source.tabs.filter((item) => item.id !== tab.id);
      const updatedSource = {
        ...source,
        slot: direction === "rows" ? "top" as const : source.slot,
        tabs: remaining,
        activeId: source.activeId === tab.id && !keepOriginal ? (remaining.at(-1)?.id ?? null) : source.activeId,
      };
      const fresh: Pane = {
        key: newKey(), tabs: [tab], activeId: tab.id,
        column: direction === "rows" ? source.column : newColumn(),
        slot: direction === "rows" ? "bottom" : "top",
      };
      const next = [...current];
      next[sourceIndex] = updatedSource;
      if (direction === "rows") next.splice(sourceIndex + 1, 0, fresh);
      else {
        const lastInColumn = next.reduce((last, pane, index) => pane.column === source.column ? index : last, sourceIndex);
        next.splice(lastInColumn + 1, 0, fresh);
      }
      setActivePane(fresh.key);
      return next;
    });
  }, []);

  const openBeside = useCallback((id: string, title: string) => {
    setPanes((current) => {
      const existing = current.find((pane) => pane.tabs.some((tab) => tab.id === id));
      if (existing) {
        setActivePane(existing.key);
        return current.map((pane) => pane.key === existing.key ? { ...pane, activeId: id } : pane);
      }
      const sourceIndex = Math.max(0, current.findIndex((pane) => pane.key === activePane));
      const source = current[sourceIndex];
      const fresh: Pane = { key: newKey(), column: newColumn(), slot: "top", tabs: [{ id, title }], activeId: id };
      const next = [...current];
      const lastInColumn = next.reduce((last, pane, index) => pane.column === source.column ? index : last, sourceIndex);
      next.splice(lastInColumn + 1, 0, fresh);
      setActivePane(fresh.key);
      return next;
    });
  }, [activePane]);

  useEffect(() => {
    (globalThis as any).__wikiOpenBeside = openBeside;
    return () => { if ((globalThis as any).__wikiOpenBeside === openBeside) delete (globalThis as any).__wikiOpenBeside; };
  }, [openBeside]);

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
        const moved = ps.map((p) => {
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
        });
        return normalizePanes(moved);
      }

      if (d.zone === "center" && d.fromPane === d.overPane) return ps;
      if (sameSolo && d.zone !== "center") return ps;    // nothing to split off
      const targetPane = ps.find((pane) => pane.key === d.overPane);
      if (!targetPane) return ps;
      if ((d.zone === "top" || d.zone === "bottom")
          && ps.some((pane) => pane.column === targetPane.column && pane.key !== targetPane.key)) return ps;

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
        const vertical = d.zone === "top" || d.zone === "bottom";
        const fresh: Pane = {
          key: newKey(), tabs: [d.tab], activeId: d.tab.id,
          column: vertical ? targetPane.column : newColumn(),
          slot: vertical ? (d.zone === "top" ? "top" : "bottom") : "top",
        };
        const at = next.findIndex((p) => p.key === d.overPane);
        if (vertical) {
          next[at] = { ...next[at], slot: d.zone === "top" ? "bottom" : "top" };
          next.splice(d.zone === "top" ? at : at + 1, 0, fresh);
        } else {
          const targetColumnEnd = next.reduce((last, pane, index) => pane.column === targetPane.column ? index : last, at);
          next.splice(d.zone === "left" ? at : targetColumnEnd + 1, 0, fresh);
        }
        setActivePane(fresh.key);
      }
      return normalizePanes(next);
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

  useEffect(() => registerChatWorkspace({
    targets: () => panes.flatMap((pane) => pane.tabs.filter((tab) => isChatId(tab.id)).map((tab) => ({ id: tab.id, title: tab.title }))),
    activate: (chatId) => {
      const pane = panes.find((candidate) => candidate.tabs.some((tab) => tab.id === chatId));
      if (!pane) return;
      setPanes((current) => current.map((candidate) => candidate.key === pane.key ? { ...candidate, activeId: chatId } : candidate));
      setActivePane(pane.key);
    },
  }), [panes]);

  /**
   * Lo que el agente pide sobre la interfaz, aplicado al workspace.
   *
   * Solo se atiende lo que solo el workspace puede hacer: abrir pestañas. Lo
   * de dentro del grafo —enfocar, filtrar, resaltar— lo escucha `GraphView`
   * por su cuenta, porque es estado suyo y subirlo hasta aquí obligaría a
   * volver a bajarlo entero.
   *
   * `focus_graph` abre la pestaña del grafo si no estaba, y no hace nada más:
   * la orden ya quedó guardada en el bus, y la vista la recoge al montarse.
   * Es lo que hace que «enfoca el grafo en X» funcione a la primera, sin
   * pedir antes que se abra el grafo.
   */
  useEffect(() => subscribeUiActions((action) => {
    if (action.kind === "open_note") {
      if (action.beside) openBeside(action.id, action.title);
      else open(action.id, action.title, true);
      return;
    }
    if (action.kind === "open_graph" || action.kind === "focus_graph") {
      open(GRAPH_ID, t("nav.graph"), true);
    }
  }), [open, openBeside, t]);

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => { setTabMenu(null); setChatMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [tabMenu]);

  const pathForTab = useCallback(async (tab: Tab) => {
    if (isRawId(tab.id) || isPdfId(tab.id) || isImgId(tab.id)) return tab.id.slice(4);
    if (isCanvasId(tab.id)) return tab.id.slice(7);
    if (isChatId(tab.id) || isGraphId(tab.id)) return null;
    const response = await fetch(`/api/note-full?id=${encodeURIComponent(tab.id)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return ((await response.json()) as Payload).meta.vaultPath;
  }, []);


  useEffect(() => {
    document.body.classList.add("workspace");
    return () => document.body.classList.remove("workspace");
  }, []);

  const focused = panes.find((p) => p.key === activePane)?.activeId ?? null;
  useEffect(() => { publishActive(focused); }, [focused]);

  // Keep the address bar on the focused NOTE. Virtual/file tabs deliberately
  // do not rewrite it: reloading a standalone graph/file/terminal route would
  // land outside the workspace — no tab bar, no restored layout, and nothing
  // to come back to. The graph used to be missing from this guard, which made
  // merely focusing its tab turn the next reload into the standalone view.
  useEffect(() => {
    if (focused && !isFileId(focused) && !isChatId(focused) && !isGraphId(focused)) {
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
            const relX = (e.clientX - r.left) / r.width;
            const relY = (e.clientY - r.top) / r.height;
            zone = relY < 0.22 ? "top" : relY > 0.78 ? "bottom"
              : relX < 0.28 ? "left" : relX > 0.72 ? "right" : "center";
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
      if (!b || !barDrag) return;
      if (barDrag.axis === "columns") {
        setRatio(Math.min(0.8, Math.max(0.2, (e.clientX - b.left) / b.width)));
      } else if (barDrag.column) {
        const column = wrap.current?.querySelector<HTMLElement>(`[data-column="${barDrag.column}"]`);
        const bounds = column?.getBoundingClientRect();
        if (bounds) setRowRatios((current) => ({ ...current, [barDrag.column!]: Math.min(0.8, Math.max(0.2, (e.clientY - bounds.top) / bounds.height)) }));
      }
    };
    const up = () => { setBarDrag(null); document.body.classList.remove("resizing", "resizing-rows", "resizing-columns"); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing", "resizing-rows", "resizing-columns");
    };
  }, [barDrag]);

  const overlayFor = (paneKey: string) => {
    if (!drag || drag.overPane !== paneKey || drag.zone === "tabs") return null;
    return <div className={`dropzone ${drag.zone}`} />;
  };

  const columns = [...new Set(panes.map((pane) => pane.column))];
  const tracks = columns.length === 2
    ? `${ratio}fr 7px ${1 - ratio}fr`
    : columns.map(() => "1fr").join(" 7px ");

  return (
    <WsCtx.Provider value={{ open, panes, activePane }}>
      <QuickSwitcher onOpen={open} />
      <div className="wsgrid columns" ref={wrap} style={{ gridTemplateColumns: tracks, gridTemplateRows: "minmax(0, 1fr)" }}>
        {columns.map((column, columnIndex) => {
          const columnPanes = panes.filter((pane) => pane.column === column)
            .sort((a, b) => a.slot === b.slot ? 0 : a.slot === "top" ? -1 : 1);
          const rowRatio = rowRatios[column] ?? 0.5;
          return <Fragment key={column}>
            {columnIndex > 0 && (
              <div
                className={`splitbar columns${barDrag?.axis === "columns" ? " dragging" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); setBarDrag({ axis: "columns" });
                  document.body.classList.add("resizing", "resizing-columns");
                }}
                onDoubleClick={() => setRatio(0.5)}
                title={t("chrome.dragResizeHalf")}
              />
            )}
            <div className="wscolumn" data-column={column} style={{ gridTemplateRows: columnPanes.length === 2
              ? `${rowRatio}fr 7px ${1 - rowRatio}fr` : "minmax(0, 1fr)" }}>
            {columnPanes.map((p, rowIndex) => <Fragment key={p.key}>
            {rowIndex > 0 && <div
              className={`splitbar rows${barDrag?.axis === "rows" && barDrag.column === column ? " dragging" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault(); setBarDrag({ axis: "rows", column });
                document.body.classList.add("resizing", "resizing-rows");
              }}
              onDoubleClick={() => setRowRatios((current) => ({ ...current, [column]: 0.5 }))}
              title={t("chrome.dragResizeHalf")}
            />}
            <div
              key={p.key}
              className={`wspane${activePane === p.key ? " active" : ""}`}
              ref={(el) => { if (el) paneEls.current.set(p.key, el); else paneEls.current.delete(p.key); }}
              onMouseDown={() => setActivePane(p.key)}
            >
              <div className="panetabrow">
                {columnIndex === 0 && rowIndex === 0 && <SidebarToggle />}
                <div
                  className="panetabs"
                  data-tour="workspace-tabs"
                  ref={(el) => { if (el) tabBars.current.set(p.key, el); else tabBars.current.delete(p.key); }}
                >
                {p.tabs.map((tab, ti) => (
                  <div
                    key={tab.id}
                    className={`otab${tab.id === p.activeId ? " on" : ""}${drag?.tab.id === tab.id ? " ghosted" : ""}`
                      + (drag?.zone === "tabs" && drag.overPane === p.key && drag.index === ti ? " insbefore" : "")}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      setActivePane(p.key);
                      setPanes((ps) => ps.map((q) => (q.key === p.key ? { ...q, activeId: tab.id } : q)));
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
                          setDrag({ tab, fromPane: p.key, x: ev.clientX, y: ev.clientY, overPane: null, zone: "center", index: null });
                        }
                      };
                      el.addEventListener("pointermove", onMove as any);
                      el.addEventListener("pointerup", () => {
                        el.removeEventListener("pointermove", onMove as any);
                        try { el.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
                      }, { once: true });

                    }}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setTabMenu({ x: e.clientX, y: e.clientY, paneKey: p.key, tab });
                      setChatMenuOpen(false);
                    }}
                    title={tab.id}
                    data-tour="workspace-tab"
                  >
                    <span className="otab-title">
                      {isPdfId(tab.id) && <span className="otab-kind">PDF</span>}
                      {isImgId(tab.id) && <span className="otab-kind">IMG</span>}
                      {isCanvasId(tab.id) && <span className="otab-kind">CANVAS</span>}
                      {isChatId(tab.id) && <span className="otab-kind">CHAT</span>}
                      {renaming === tab.id ? (
                        <input
                          className="otab-rename"
                          defaultValue={tab.title}
                          aria-label={t("workspace.rename")}
                          // The tab is a drag handle and a click target; while
                          // the input is up it must be neither, or selecting
                          // text inside it starts dragging the tab out.
                          onPointerDown={(e) => e.stopPropagation()}
                          onContextMenu={(e) => e.stopPropagation()}
                          ref={(el) => el?.select()}
                          onBlur={(e) => renameTab(tab.id, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") renameTab(tab.id, e.currentTarget.value);
                            // Escape gives up on the edit, so it must not go
                            // through renameTab and commit what was typed.
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                      ) : tab.title}
                    </span>
                    <button
                      className="otab-x"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); closeTab(p.key, tab.id); }}
                      aria-label={`Cerrar ${tab.title}`}
                    >×</button>
                  </div>
                ))}
                {drag?.zone === "tabs" && drag.overPane === p.key && drag.index === p.tabs.length && (
                  <span className="insend" aria-hidden />
                )}
                </div>
              </div>

              <div className="panecontent">
                {p.activeId === null ? (
                  <p className="dim" style={{ padding: 20 }}>{t("chrome.emptyPane")}</p>
                ) : isGraphId(p.activeId) ? (
                  <div className="panescroll">
                    <article>
                      <h1>{t("nav.graph")}</h1>
                      <p className="infoline">
                        <span>{t("graph.dragToPin")}</span><span>{t("graph.wheelToPan")}</span><span>{t("graph.pinchToZoom")}</span>
                        <span>{t("graph.clickExplores")}</span><span>{t("graph.cmdClickOpens")}</span><span>{t("graph.escExits")}</span>
                      </p>
                      <GraphView />
                    </article>
                  </div>
                ) : isRawId(p.activeId) ? (
                  <RawFilePane rel={p.activeId.slice(4)} />
                ) : isCanvasId(p.activeId) ? (
                  <CanvasEditor path={p.activeId.slice(7)} />
                ) : isChatId(p.activeId) ? (
                  // Keyed por id: cada pestaña es su propia conversación y no
                  // deben compartir instancia al reordenar u ocultar paneles.
                  <AgentChat key={p.activeId} tabId={p.activeId} />
                ) : isImgId(p.activeId) ? (
                  <div className="imgview">
                    <div className="imgbar">
                      <span className="imgname">{p.activeId.slice(4).split("/").pop()}</span>
                      <a className="dim" style={{ marginLeft: "auto" }}
                         href={`/api/asset?p=${encodeURIComponent(p.activeId.slice(4))}`} download>{t("chrome.download")}</a>
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
                ) : initial && p.activeId === initial.id ? (
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
            </Fragment>)}
            </div>
          </Fragment>;
        })}
      </div>

      {tabMenu && createPortal(
        <div className="ctxmenu" data-tour="tab-context-menu" style={{ left: tabMenu.x, top: tabMenu.y }}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{tabMenu.tab.title}</div>
          {!isChatId(tabMenu.tab.id) && !isGraphId(tabMenu.tab.id) && <>
            {/* Sin submenú de agentes: se abre con el harness por omisión, el
                mismo que el botón dentro de la nota. Ver `AskAgent`. */}
            <button onClick={async () => {
              const response = await fetch(`/api/note-full?id=${encodeURIComponent(tabMenu.tab.id)}`, { cache: "no-store" });
              if (!response.ok) return;
              const note = (await response.json()) as Payload;
              const chatId = newChatId();
              rememberChatAgent(chatId, defaultAgent);
              runInNewChat(chatId, t("chat.askAboutPrompt", { title: note.meta.title }), undefined, [{
                id: note.id, title: note.meta.title, path: note.meta.pathRel,
              }]);
              open(chatId, t("chat.tabTitle"), true);
              setTabMenu(null);
            }}>{t("chat.askAbout")}</button>
            <button data-tour="tab-add-chat" onClick={async () => {
              let path = "";
              if (isRawId(tabMenu.tab.id) || isPdfId(tabMenu.tab.id) || isImgId(tabMenu.tab.id)) {
                path = tabMenu.tab.id.slice(4);
              } else if (isCanvasId(tabMenu.tab.id)) {
                path = tabMenu.tab.id.slice(7);
              } else if (!isChatId(tabMenu.tab.id) && !isGraphId(tabMenu.tab.id)) {
                const response = await fetch(`/api/note-full?id=${encodeURIComponent(tabMenu.tab.id)}`, { cache: "no-store" });
                if (response.ok) path = ((await response.json()) as any).meta.pathRel;
              }
              if (!path) path = tabMenu.tab.id;
              
              const ok = queueChatInput(undefined, "", { id: tabMenu.tab.id, title: tabMenu.tab.title, path });
              setTabMenu(null);
              if (!ok) alert(t("chat.chooseFirst"));
            }}>{t("chat.addToChat")}</button>
            <div className="ctxsub">
              <button onClick={() => setChatMenuOpen((value) => !value)}>{t("chat.addTo")}</button>
              {chatMenuOpen && <div className="ctxsubmenu">
                {chatTargets().length === 0 && <div className="ctxhead">{t("chat.noneOpen")}</div>}
                {chatTargets().map((target) => <button key={target.id} onClick={async () => {
                  let path = "";
                  if (isRawId(tabMenu.tab.id) || isPdfId(tabMenu.tab.id) || isImgId(tabMenu.tab.id)) {
                    path = tabMenu.tab.id.slice(4);
                  } else if (isCanvasId(tabMenu.tab.id)) {
                    path = tabMenu.tab.id.slice(7);
                  } else if (!isChatId(tabMenu.tab.id) && !isGraphId(tabMenu.tab.id)) {
                    const response = await fetch(`/api/note-full?id=${encodeURIComponent(tabMenu.tab.id)}`, { cache: "no-store" });
                    if (response.ok) path = ((await response.json()) as any).meta.pathRel;
                  }
                  if (!path) path = tabMenu.tab.id;

                  queueChatInput(target.id, "", { id: tabMenu.tab.id, title: tabMenu.tab.title, path });
                  setTabMenu(null);
                }}>{target.title}</button>)}
              </div>}
            </div>
          </>}
          {isChatId(tabMenu.tab.id) && (
            <button onClick={() => {
              setRenaming(tabMenu.tab.id);
              setTabMenu(null);
            }}>{t("workspace.rename")}</button>
          )}
          <button data-tour="tab-split-right" onClick={() => { splitTab(tabMenu.paneKey, tabMenu.tab, "columns"); setTabMenu(null); }}>{t("workspace.splitRight")}</button>
          <button data-tour="tab-split-down" disabled={panes.some((pane) => pane.column === panes.find((candidate) => candidate.key === tabMenu.paneKey)?.column && pane.key !== tabMenu.paneKey)}
            onClick={() => { splitTab(tabMenu.paneKey, tabMenu.tab, "rows"); setTabMenu(null); }}>{t("workspace.splitDown")}</button>
          <button onClick={() => { closeTab(tabMenu.paneKey, tabMenu.tab.id); setTabMenu(null); }}>{t("common.close")}</button>
        </div>, document.body,
      )}

      {drag && (
        <div className="dragghost" style={{ left: drag.x + 12, top: drag.y + 10 }}>
          <span className="dragghost-ico">▤</span>{drag.tab.title}
        </div>
      )}
    </WsCtx.Provider>
  );
}
