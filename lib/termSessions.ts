import pty from "node-pty";

/**
 * Registro de shells vivas, compartido entre `server.ts` (que las abre y las
 * conecta por WebSocket) y `app/api/terminal/route.ts` (que las cierra cuando
 * se cierra la pestaña).
 *
 * La pty vive mientras dure el proceso de `next dev`, no atada a una sola
 * conexión de WebSocket: cambiar de pestaña o mover el panel no debe matar la
 * sesión, que es la mitad del punto de tener una terminal integrada. Un
 * `buffer` acotado guarda la salida reciente para redibujar la pantalla al
 * reconectar — sin él, volver a una pestaña de terminal tras un rato se ve en
 * blanco hasta la próxima línea nueva, aunque el proceso siga vivo.
 *
 * `server.ts` se ejecuta con el loader nativo de Node (`--experimental-strip-
 * types`); la ruta de abajo la carga el bundler de Next. Cada uno instancia
 * este archivo por su cuenta, así que un `Map` de nivel de módulo NO queda
 * compartido entre los dos — `killSession` desde la ruta HTTP encontraba
 * siempre un mapa vacío y no mataba nada, aunque respondiera `ok:true`.
 * `globalThis`, bajo una clave de `Symbol.for`, sí es el mismo objeto sin
 * importar qué loader cargó el archivo.
 */
export interface Session {
  term: ReturnType<typeof pty.spawn>;
  buffer: string;
}

const MAX_BUFFER = 200_000;

const KEY = Symbol.for("summa-wiki.termSessions");
type Registry = Map<string, Session>;
const g = globalThis as unknown as Record<symbol, Registry>;
g[KEY] ??= new Map<string, Session>();
export const sessions: Registry = g[KEY];

export function appendBuffer(s: Session, chunk: string) {
  s.buffer = (s.buffer + chunk).slice(-MAX_BUFFER);
}

export function killSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.term.kill(); } catch { /* ya estaba muerta */ }
}
