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
/**
 * Conversación con un agente por ACP. `chat:<sufijo>`.
 *
 * **El agente ya NO va dentro del id.** Lo llevaba —`chat:<agente>:<sufijo>`—
 * con un buen argumento: el id es lo único que sobrevive a todo lo que puede
 * pasarle a una pestaña (localStorage, `?open=`, arrastrarla de panel). Pero
 * eso solo vale mientras el agente sea una propiedad INMUTABLE de la pestaña,
 * y dejó de serlo: dentro de un chat se cambia de harness sin abrir otro. Un
 * id que dijera `chat:claude-code:…` en una conversación que ahora habla con
 * Codex sería una mentira imposible de corregir sin cerrar la pestaña.
 *
 * Lo que ahora vive en el id es la CONVERSACIÓN; qué harness está seleccionado
 * es estado, y se guarda aparte (ver `chatAgentOf` abajo). Cada harness tiene
 * su propia sesión en el servidor, con la clave `<id de pestaña>::<agente>`.
 */
export const isChatId = (id: string) => id.startsWith("chat:");

/** Clave de la sesión de un harness concreto dentro de una pestaña de chat. */
export const chatSessionId = (tabId: string, agent: string) => `${tabId}::${agent}`;
export const isFileId = (id: string) => isPdfId(id) || isImgId(id) || isCanvasId(id) || isRawId(id);
export const hrefFor = (id: string) =>
  isGraphId(id) ? "/workspace?open=graph%3A"
  : isCanvasId(id) ? `/canvas?p=${encodeURIComponent(id.slice(7))}`
  : isChatId(id) ? `/workspace?open=${encodeURIComponent(id)}`
  : isRawId(id) ? `/api/asset?p=${encodeURIComponent(id.slice(4))}`
  : isFileId(id) ? `/pdf?p=${encodeURIComponent(id.slice(4))}`
  : `/note/${encodeURIComponent(id)}`;

let chatSeq = 0;
/** Id de una conversación nueva. Ver `isChatId` para por qué no lleva agente. */
export const newChatId = () => `chat:${Date.now().toString(36)}${(chatSeq++).toString(36)}`;

/**
 * El harness que trae un id de chat, si es que trae alguno.
 *
 * Solo lo traen los ids VIEJOS, con la forma `chat:<agente>:<sufijo>`, y por
 * eso esta función sigue existiendo: esos ids están guardados en el
 * localStorage de todo el que ya usaba la app, y al restaurar la sesión hay
 * que abrir su chat con el harness que él eligió, no con el que venga por
 * omisión. Los ids nuevos tienen dos segmentos y devuelven `""`.
 *
 * Se parte por el PRIMER separador: los ids de agente llevan guiones
 * (`claude-code`, `mistral-vibe`) pero nunca dos puntos.
 */
export const chatAgent = (id: string) => {
  const parts = id.slice(5).split(":");
  return parts.length > 1 ? parts[0]! : "";
};

/**
 * Qué harness tiene seleccionado cada pestaña de chat.
 *
 * En `localStorage` y no en el estado de React porque tiene que sobrevivir
 * exactamente a lo mismo que el id de la pestaña: recargar, restaurar el
 * workspace guardado, arrastrar la pestaña a otro panel (que la desmonta y la
 * vuelve a montar). Guardarlo en el componente lo perdería en las tres.
 *
 * El respaldo es el harness que traiga un id viejo, y solo entonces el que
 * venga por omisión. Ese orden es lo que hace que actualizar la app no le
 * cambie el agente a nadie.
 */
const AGENT_KEY = "wiki.chatAgent";

type AgentMap = Record<string, string>;

function agentMap(): AgentMap {
  try { return JSON.parse(localStorage.getItem(AGENT_KEY) || "{}") as AgentMap; }
  catch { return {}; }
}

export function chatAgentOf(tabId: string, fallback: string): string {
  if (typeof window === "undefined") return chatAgent(tabId) || fallback;
  return agentMap()[tabId] ?? (chatAgent(tabId) || fallback);
}

export function rememberChatAgent(tabId: string, agent: string) {
  try {
    const all = agentMap();
    all[tabId] = agent;
    localStorage.setItem(AGENT_KEY, JSON.stringify(all));
  } catch { /* en privado no se puede guardar; la elección dura lo que el montaje */ }
}

export function forgetChatAgent(tabId: string) {
  try {
    const all = agentMap();
    delete all[tabId];
    localStorage.setItem(AGENT_KEY, JSON.stringify(all));
  } catch { /* nada que limpiar si no se pudo guardar */ }
}

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
  isGraphId(id) || isCanvasId(id) || isRawId(id) || isPdfId(id) || isImgId(id) || isChatId(id);

/**
 * Abre una nota o un archivo en el workspace.
 *
 * Cuando el workspace no está montado — la portada, /search, /categories — hay
 * que navegar. Antes se iba a la ruta suelta del contenido (`hrefFor`), y para
 * una pestaña virtual eso significaba una página con esa cosa sola: sin barra
 * de pestañas, sin el resto de lo que estaba abierto y sin manera de volver. El
 * propio Workspace ya lo dice al explicar por qué nunca escribe esas rutas en
 * la barra de direcciones.
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
 * `__wikiOpen` a secas — con lo que su ítem de "Nuevo chat" no hacía nada en la
 * portada, en silencio.
 */
export default function TabsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    (window as any).__wikiOpenTab = openInWorkspace;
    return () => { delete (window as any).__wikiOpenTab; };
  }, []);
  return <>{children}</>;
}
