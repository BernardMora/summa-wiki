// El `dev` script en package.json ya exporta UV_THREADPOOL_SIZE=64 antes de
// llegar aquí; esto es un respaldo por si algún día se corre `node server.ts`
// a mano sin pasar por npm. Tiene que quedar ANTES de cualquier import que
// toque el threadpool (node-pty entre ellos) — Node lo lee al inicializarlo,
// no después.
process.env.UV_THREADPOOL_SIZE ??= "64";

import { createServer } from "node:http";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import pty from "node-pty";
import { VAULT } from "./src/config.ts";
import { sessions, appendBuffer, type Session } from "./lib/termSessions.ts";

/**
 * Servidor propio, no `next dev` a secas.
 *
 * La terminal necesita un socket que se quede abierto — algo que las rutas de
 * `app/api` no pueden dar, porque Next las trata como request/response de un
 * solo tiro.
 *
 * La terminal vive en su PROPIO `http.Server`, en el puerto principal + 1, no
 * colgada del mismo servidor que sirve las páginas de Next. Se intentó lo
 * obvio primero — un solo `http.Server`, con `getUpgradeHandler()` de Next
 * delegando todo lo que no fuera `/api/terminal` — y cada conexión al
 * websocket de la terminal moría con un cierre anómalo a los pocos
 * milisegundos, de forma perfectamente reproducible. Aislado con una batería
 * de servidores mínimos: un WebSocket standalone en su propio servidor
 * sobrevive sin problema; ese mismo WebSocket, con Next inicializado en el
 * mismo proceso pero escuchando en OTRO puerto, también sobrevive; el único
 * caso que falla es compartir el `http.Server` que Next usa para servir
 * páginas. Server.ts nunca reprodujo qué hace Next ahí — pero separar el
 * puerto lo evita por completo, así que ninguna teoría a medias vale más que
 * la solución que ya se verificó estable.
 *
 * UV_THREADPOOL_SIZE por defecto es 4. La compilación y el watcher de
 * archivos de Next ya lo saturan por su cuenta, y las lecturas de la pty de
 * node-pty comparten ese mismo pool: sin subirlo, una terminal abierta se
 * queda leyendo en silencio — sin error, sin pistas — cada vez que Next tiene
 * trabajo de fondo.
 */

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 4321);
const termPort = port + 1;
const app = next({ dev });
const handle = app.getRequestHandler();

/**
 * La pty se guarda en `sessions` por id (uno por pestaña) y sobrevive a la
 * conexión: cambiar de pestaña, mover el panel o incluso recargar la página
 * solo cierra el WebSocket, nunca la shell. Cerrar la pestaña con la × sí la
 * mata — ver app/api/terminal/route.ts.
 */
function onTerminalConnection(ws: WebSocket, req: import("node:http").IncomingMessage) {
  const id = new URL(req.url ?? "", "http://x").searchParams.get("id") ?? "";
  const existing = sessions.get(id);
  let session: Session;

  if (existing) {
    session = existing;
  } else {
    const shell = process.env.SHELL ?? "/bin/zsh";
    let term: ReturnType<typeof pty.spawn>;
    try {
      term = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 80, rows: 24,
        cwd: VAULT,
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      // El binario prebuilt de node-pty (spawn-helper) a veces se instala sin
      // permiso de ejecución — el `postinstall` de package.json ya lo repara,
      // pero si algo lo reintrodujo, mejor avisar en la propia terminal que
      // tirar el proceso de `next dev` entero.
      ws.send(`\r\nNo se pudo abrir la shell: ${(e as Error).message}\r\n`);
      ws.close();
      return;
    }
    session = { term, buffer: "" };
    if (id) sessions.set(id, session);
    const created = session;
    term.onData((chunk) => appendBuffer(created, chunk));
    term.onExit(() => { if (id) sessions.delete(id); });
  }

  // Redibuja lo último que se vio antes de engancharse en vivo — sin esto,
  // volver a una pestaña de terminal tras un rato se ve en blanco hasta la
  // próxima línea nueva, aunque el proceso siga corriendo.
  if (session.buffer) ws.send(session.buffer);

  const onData = session.term.onData((chunk) => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
  const onExit = session.term.onExit(() => { if (ws.readyState === ws.OPEN) ws.close(); });

  ws.on("message", (raw) => {
    const s = raw.toString();
    // Un solo byte de control distingue un resize de una pulsación: ningún
    // tecleo real empieza por \x01, así que no hay ambigüedad que resolver.
    if (s.charCodeAt(0) === 1) {
      try {
        const { cols, rows } = JSON.parse(s.slice(1));
        if (cols > 0 && rows > 0) session.term.resize(cols, rows);
      } catch { /* mensaje de resize corrupto: se ignora, no tira la sesión */ }
      return;
    }
    session.term.write(s);
  });

  // Solo se suelta el enganche de esta conexión — la pty sigue corriendo.
  ws.on("close", () => { onData.dispose(); onExit.dispose(); });
}

await app.prepare();
// Solo existe tras prepare(): expone internamente el propio servidor de Next.
// El socket de Fast Refresh (/_next/webpack-hmr) vive en ESTE servidor —
// tiene que seguir delegándose o el HMR del dev server se rompe.
const upgrade = app.getUpgradeHandler();
const server = createServer((req, res) => handle(req, res));
server.on("upgrade", upgrade);

const termServer = createServer();
new WebSocketServer({ server: termServer }).on("connection", onTerminalConnection);
termServer.listen(termPort);

server.listen(port, () => {
  console.log(`> Berni's Wiki en http://localhost:${port} (terminal en el puerto ${termPort})`);
});
