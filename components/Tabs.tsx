"use client";
import { useSyncExternalStore } from "react";

/**
 * Tiny store shared between the workspace (which owns panes and tabs) and the
 * sidebar/file tree (which live in a different subtree of the layout).
 *
 * There used to be a second, pathname-driven tab provider here. Running both
 * meant the tree highlighted whatever the URL said while the panes showed
 * their own state, and the two drifted apart. The workspace is now the single
 * source of truth and publishes into this store.
 */
/** Pestaña virtual del grafo: no es un archivo, pero se abre y arrastra igual. */
export const GRAPH_ID = "graph:";
export const isGraphId = (id: string) => id === GRAPH_ID;
export const isCanvasId = (id: string) => id.startsWith("canvas:");
/** Archivo sin visor propio: se muestra una ficha, no se descarga en silencio. */
export const isRawId = (id: string) => id.startsWith("raw:");
export const isPdfId = (id: string) => id.startsWith("pdf:");
export const isImgId = (id: string) => id.startsWith("img:");
export const isFileId = (id: string) => isPdfId(id) || isImgId(id) || isCanvasId(id) || isRawId(id);
export const hrefFor = (id: string) =>
  isGraphId(id) ? "/graph"
  : isCanvasId(id) ? `/canvas?p=${encodeURIComponent(id.slice(7))}`
  : isRawId(id) ? `/api/asset?p=${encodeURIComponent(id.slice(4))}`
  : isFileId(id) ? `/pdf?p=${encodeURIComponent(id.slice(4))}`
  : `/note/${encodeURIComponent(id)}`;

let activeId: string | null = null;
const listeners = new Set<() => void>();

export function publishActive(id: string | null) {
  if (id === activeId) return;
  activeId = id;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useActiveId(): string | null {
  return useSyncExternalStore(subscribe, () => activeId, () => null);
}

/** Open a note/file in the workspace. Falls back to navigation if unmounted. */
export function openInWorkspace(id: string, title: string, newTab = false) {
  const fn = (globalThis as any).__wikiOpen;
  if (fn) { fn(id, title, newTab); return; }
  if (typeof window !== "undefined") window.location.href = hrefFor(id);
}

/** Shape the sidebar and tree expect. */
export function useTabs() {
  return { activeId: useActiveId(), open: openInWorkspace };
}

/** Panes carry their own tab bars now; the global strip is gone. */
export function TabBar() { return null; }
export default function TabsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
