import fs from "node:fs";
import { VAULT } from "@/lib/server.ts";
import { EXCLUDE_DIRS, isExcluded } from "@/src/config.ts";

export const dynamic = "force-dynamic";

/**
 * Un solo `fs.watch` recursivo sobre el vault, multiplexado por SSE a todas
 * las pestañas abiertas.
 *
 * Recursivo sobre macOS es FSEvents, que es barato: el kernel ya mantiene ese
 * registro. Lo caro sería un watcher por pestaña, o uno por carpeta — de ahí
 * el singleton con lista de suscriptores.
 *
 * Vive bajo `Symbol.for` en `globalThis` por la misma razón que
 * `lib/termSessions.ts`: en desarrollo Next reevalúa el módulo con cada
 * recompilación, y un `let` de nivel de módulo dejaría watchers huérfanos
 * acumulándose sesión tras sesión, cada uno con su handle del kernel.
 */

type Listener = (rel: string) => void;

interface Hub {
  watcher: fs.FSWatcher | null;
  listeners: Set<Listener>;
  timer: NodeJS.Timeout | null;
  /** Rutas acumuladas durante la ventana de coalescencia. */
  pending: Set<string>;
}

const KEY = Symbol.for("summa-wiki.fsHub");
const g = globalThis as unknown as Record<symbol, Hub>;
g[KEY] ??= { watcher: null, listeners: new Set(), timer: null, pending: new Set() };
const hub: Hub = g[KEY];

/**
 * Guardar una nota dispara entre dos y cinco eventos (el archivo, su
 * directorio, el temporal del editor). Sin filtro, el árbol se recargaría
 * media docena de veces por pulsación de ⌘S.
 */
function noise(rel: string): boolean {
  if (!rel) return true;
  const segs = rel.split("/");
  if (segs.some((s) => EXCLUDE_DIRS.has(s))) return true;
  if (segs.some((s) => s.startsWith("."))) return true;      // .DS_Store, .git, .next
  if (isExcluded(rel)) return true;                          // 05-Projects/*, dot-dirs
  const base = segs[segs.length - 1];
  // Temporales de editores y del propio /api/fs (rename en dos pasos).
  if (/(^~|~$|\.swp$|\.tmp$|\.__rename__$|^\d+$)/.test(base)) return true;
  return false;
}

function ensureWatcher() {
  if (hub.watcher) return;
  try {
    hub.watcher = fs.watch(VAULT, { recursive: true, persistent: false }, (_evt, filename) => {
      if (!filename) return;
      const rel = filename.toString().split("\\").join("/");
      if (noise(rel)) return;
      hub.pending.add(rel);
      if (hub.timer) return;
      // Coalescencia: mover una carpeta genera un evento por archivo movido, y
      // al cliente solo le interesa saber que tiene que releer el árbol.
      hub.timer = setTimeout(() => {
        const batch = [...hub.pending];
        hub.pending.clear();
        hub.timer = null;
        for (const l of hub.listeners) l(batch[0] ?? "");
      }, 250);
    });
  } catch {
    // Sin watcher la app sigue funcionando; solo se pierde el refresco solo.
    hub.watcher = null;
  }
}

function release() {
  if (hub.listeners.size > 0) return;
  hub.watcher?.close();
  hub.watcher = null;
  if (hub.timer) { clearTimeout(hub.timer); hub.timer = null; }
  hub.pending.clear();
}

export async function GET(req: Request) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`)); }
        catch { /* cliente ya cerrado; lo limpia el abort */ }
      };

      const listener: Listener = (rel) => send("change", JSON.stringify({ rel }));
      hub.listeners.add(listener);
      ensureWatcher();
      send("ready", JSON.stringify({ watching: hub.watcher !== null }));

      // Un comentario cada 30 s. Sin tráfico, un proxy intermedio (o el propio
      // navegador tras una suspensión) da la conexión por muerta en silencio y
      // el árbol deja de refrescarse sin que nada lo indique.
      const beat = setInterval(() => {
        try { controller.enqueue(enc.encode(": beat\n\n")); } catch { /* cerrado */ }
      }, 30_000);

      const close = () => {
        clearInterval(beat);
        hub.listeners.delete(listener);
        release();
        try { controller.close(); } catch { /* ya cerrado */ }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Next puede tener compresión por delante; con buffer, SSE no llega.
      "X-Accel-Buffering": "no",
    },
  });
}
