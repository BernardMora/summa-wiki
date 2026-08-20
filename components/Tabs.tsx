"use client";
import { useEffect, useSyncExternalStore } from "react";

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
/** Shell real dentro de la app; el sufijo solo distingue pestañas entre sí. */
export const isTermId = (id: string) => id.startsWith("term:");
export const isFileId = (id: string) => isPdfId(id) || isImgId(id) || isCanvasId(id) || isRawId(id);
export const hrefFor = (id: string) =>
  isGraphId(id) ? "/workspace?open=graph%3A"
  : isCanvasId(id) ? `/canvas?p=${encodeURIComponent(id.slice(7))}`
  : isTermId(id) ? `/terminal?id=${encodeURIComponent(id.slice(5))}`
  : isRawId(id) ? `/api/asset?p=${encodeURIComponent(id.slice(4))}`
  : isFileId(id) ? `/pdf?p=${encodeURIComponent(id.slice(4))}`
  : `/note/${encodeURIComponent(id)}`;

let termSeq = 0;
/** Id único por pestaña; el servidor no le da ningún significado, cada
 *  conexión abre su propia pty. */
export const newTermId = () => `term:${Date.now().toString(36)}${(termSeq++).toString(36)}`;

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

/** Todo lo que no es una nota: tiene ruta propia, pero no vive bien fuera del workspace. */
const isSpecialId = (id: string) =>
  isGraphId(id) || isCanvasId(id) || isRawId(id) || isPdfId(id) || isImgId(id) || isTermId(id);

/**
 * Abre una nota o un archivo en el workspace.
 *
 * Cuando el workspace no está montado — la portada, /search, /categories — hay
 * que navegar. Antes se iba a la ruta suelta del contenido (`hrefFor`), y para
 * una terminal eso significaba `/terminal?id=…`: una página con la terminal
 * sola, sin barra de pestañas, sin el resto de lo que estaba abierto y sin
 * manera de volver. El propio Workspace ya lo dice al explicar por qué nunca
 * escribe esas rutas en la barra de direcciones.
 *
 * Ahora se navega a /workspace pidiéndole que abra la pestaña. Las notas
 * siguen yendo a /note/<id>, que ya monta el workspace y da una URL legible.
 */
export function openInWorkspace(id: string, title: string, newTab = false) {
  const fn = (globalThis as any).__wikiOpen;
  if (fn) { fn(id, title, newTab); return; }
  if (typeof window === "undefined") return;
  window.location.href = isSpecialId(id)
    ? `/workspace?open=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`
    : hrefFor(id);
}

/** Abre un archivo en una nueva columna junto al panel activo. */
export function openBesideInWorkspace(id: string, title: string): boolean {
  const fn = (globalThis as any).__wikiOpenBeside;
  if (!fn) return false;
  fn(id, title);
  return true;
}

/** Shape the sidebar and tree expect. */
export function useTabs() {
  return { activeId: useActiveId(), open: openInWorkspace };
}

/** Panes carry their own tab bars now; the global strip is gone. */
export function TabBar() { return null; }

/**
 * Publica `openInWorkspace` en `window`.
 *
 * `__wikiOpen` solo existe donde el Workspace está montado; esta versión está
 * en todas las páginas, porque el provider vive en el layout. La necesita el
 * menú nativo de Electron, que no puede importar módulos de la app y llamaba a
 * `__wikiOpen` a secas — con lo que "Nueva terminal" no hacía nada en la
 * portada, en silencio.
 */
export default function TabsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    (window as any).__wikiOpenTab = openInWorkspace;
    return () => { delete (window as any).__wikiOpenTab; };
  }, []);
  return <>{children}</>;
}
