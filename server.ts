// El `dev` script en package.json ya exporta UV_THREADPOOL_SIZE=64 antes de
// llegar aquí; esto es un respaldo por si algún día se corre `node server.ts`
// a mano sin pasar por npm. Tiene que quedar ANTES de cualquier import que
// toque el threadpool — Node lo lee al inicializarlo, no después.
process.env.UV_THREADPOOL_SIZE ??= "64";

import fs from "node:fs";
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { VAULT, readConfig } from "./src/config.ts";
import {
  acpSessions, answerPermission, authenticateSession, cancelSession, launchAuthCommand,
  listConversations, loadConversation, openSession, promptSession, relaunch, replay,
  setConfig, syncAcpBuffer,
} from "./lib/acpSessions.ts";
import type { AcpClientMessage } from "./src/acp/wire.ts";
import { resolvePort } from "./src/ports.mjs";

/**
 * Servidor propio, no `next dev` a secas.
 *
 * El chat con agentes necesita un socket que se quede abierto — algo que las
 * rutas de `app/api` no pueden dar, porque Next las trata como request/response
 * de un solo tiro.
 *
 * Ese WebSocket vive en su PROPIO `http.Server`, en el puerto principal + 1, no
 * colgado del mismo servidor que sirve las páginas de Next. Se intentó lo
 * obvio primero — un solo `http.Server`, con `getUpgradeHandler()` de Next
 * delegando lo que no fuera suyo — y cada conexión moría con un cierre anómalo
 * a los pocos milisegundos, de forma perfectamente reproducible. Aislado con
 * una batería de servidores mínimos: un WebSocket standalone en su propio
 * servidor sobrevive sin problema; ese mismo WebSocket, con Next inicializado
 * en el mismo proceso pero escuchando en OTRO puerto, también sobrevive; el
 * único caso que falla es compartir el `http.Server` que Next usa para servir
 * páginas. Server.ts nunca reprodujo qué hace Next ahí — pero separar el
 * puerto lo evita por completo, así que ninguna teoría a medias vale más que
 * la solución que ya se verificó estable.
 *
 * El servidor MCP (`app/api/mcp/[token]`) NO necesita puerto propio y por eso
 * no lo tiene: es una petición y una respuesta, exactamente lo que una ruta de
 * Next hace bien. Lo que rompe es la ACTUALIZACIÓN a WebSocket, no el HTTP.
 *
 * UV_THREADPOOL_SIZE por defecto es 4, y la compilación y el watcher de
 * archivos de Next lo saturan por su cuenta. Se sube porque todo lo demás que
 * hace la app contra el disco —indexar el vault, leer notas, servir assets—
 * comparte ese pool y se queda esperando detrás de Next sin ninguna señal de
 * que eso es lo que pasa.
 */

const dev = process.env.NODE_ENV !== "production";
const port = resolvePort();
/**
 * El chat con agentes, en el puerto siguiente al de las páginas.
 *
 * Era `port + 2` mientras la terminal integrada ocupaba `port + 1`. Al
 * retirarse la terminal (fase 6) el hueco de en medio no se deja: el buscador
 * de puertos libres de `electron/main.js` reserva un bloque CONSECUTIVO, y un
 * hueco significaría reservar tres para usar dos, o —lo que de hecho pasaba—
 * reservar dos y usar tres.
 */
const acpPort = port + 1;
const app = next({ dev });
const handle = app.getRequestHandler();

// El servidor de escritorio corre detached para poder matar todo su grupo al
// salir, pero detached también lo deja vivo si Electron se cae antes de
// ejecutar before-quit. El PID explícito permite reconocer esa caída y evita
// que una sesión futura herede un Next huérfano con cachés desactualizadas.
const desktopParent = Number(process.env.WIKI_PARENT_PID);
if (Number.isInteger(desktopParent) && desktopParent > 1) {
  const parentWatch = setInterval(() => {
    try { process.kill(desktopParent, 0); }
    catch { clearInterval(parentWatch); process.exit(0); }
  }, 1_000);
  parentWatch.unref();
}

/**
 * Un chat con un agente por ACP.
 *
 * La conversación vive en el SERVIDOR y esta conexión solo la mira: cambiar de
 * pestaña, mover el panel o recargar la página cierra el socket, y ninguna de
 * las tres cosas debe interrumpir un turno. Lo que viaja es JSON tipado
 * (`src/acp/wire.ts`). Al conectarse se reproduce la conversación entera; a
 * partir de ahí, en vivo.
 *
 * Varias conexiones sobre el mismo id son normales y están soportadas: la
 * misma pestaña en vista dividida, o dos ventanas de la app. Todas escuchan y
 * todas ven lo mismo, incluido lo que escriba cualquiera de ellas — por eso el
 * prompt del usuario se emite de vuelta como mensaje (`sent`) en vez de que
 * cada navegador pinte el suyo por su cuenta.
 */
function onAcpConnection(ws: WebSocket, req: import("node:http").IncomingMessage) {
  const q = new URL(req.url ?? "", "http://x").searchParams;
  const id = q.get("id") ?? "";
  const agent = q.get("agent") ?? "claude-code";

  // Se admite otro directorio —el asistente ingiere a un vault recién creado
  // que todavía no es el activo— pero tiene que existir y ser uno. Si no, el
  // vault; nunca un sitio impredecible.
  let cwd = VAULT;
  const wanted = q.get("cwd");
  if (wanted) {
    try { if (fs.statSync(wanted).isDirectory()) cwd = wanted; } catch { /* se queda el vault */ }
  }

  if (!id) { ws.close(); return; }

  // `agent` solo cuenta al CREAR: reengancharse a una conversación viva con
  // otro agente en la URL no debe cambiar con quién se está hablando.
  const entry = openSession(id, agent, cwd);

  const send = (message: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  for (const message of replay(entry)) send(message);
  entry.listeners.add(send);

  ws.on("message", (raw) => {
    let message: AcpClientMessage;
    try { message = JSON.parse(raw.toString()); }
    catch { return; /* mensaje corrupto: se ignora, no se tira la sesión */ }

    if (message.t === "prompt") void promptSession(entry, message.text, message.resources, message.images);
    if (message.t === "buffer") syncAcpBuffer(entry, message.id, message.content);
    if (message.t === "cancel") cancelSession(entry);
    if (message.t === "config") void setConfig(entry, message.configId, message.value);
    if (message.t === "permission") answerPermission(entry, message.requestId, message.optionId);
    if (message.t === "authenticate") void authenticateSession(entry, message.methodId);
    if (message.t === "auth-launch") void launchAuthCommand(entry, message.methodId);
    if (message.t === "retry") relaunch(entry, message.viaNpx ?? false);
    if (message.t === "sessions") void listConversations(entry);
    if (message.t === "load") void loadConversation(entry, message.sessionId);
  });

  // Solo se suelta el oyente. El agente sigue vivo: cerrar la conversación de
  // verdad es cosa de app/api/acp/route.ts — desconectarse NO es cerrar.
  ws.on("close", () => { entry.listeners.delete(send); });
}

await app.prepare();
// Solo existe tras prepare(): expone internamente el propio servidor de Next.
// El socket de Fast Refresh (/_next/webpack-hmr) vive en ESTE servidor —
// tiene que seguir delegándose o el HMR del dev server se rompe.
const upgrade = app.getUpgradeHandler();
const server = createServer((req, res) => handle(req, res));
server.on("upgrade", upgrade);

/**
 * ⚠ El host es obligatorio. No lo quites.
 *
 * `listen(port, cb)` NO ata a localhost: el segundo argumento es el callback, y
 * sin host Node escucha en `::` — TODAS las interfaces. Durante el desarrollo
 * nunca se nota, porque uno siempre escribe `localhost` en la barra; pero
 * `lsof` decía `TCP *:<puerto>` y desde otra máquina de la red se podía, sin
 * ninguna credencial: leer cualquier archivo del vault (`/api/file`),
 * escribirlo y borrarlo (`/api/fs`), y —lo peor— abrir una shell interactiva
 * contra el puerto de la terminal integrada, que entonces existía. Comprobado
 * desde la IP de LAN: respondió a `whoami`. Eso era ejecución remota de código
 * en la laptop para cualquiera en la misma Wi-Fi: la de un café, la de la
 * universidad, la de un cliente.
 *
 * La terminal ya no está, pero la conclusión NO caduca con ella: por el socket
 * de agentes se le pide a un agente que ejecute lo que sea, y el servidor MCP
 * de `/api/mcp` mueve la interfaz del usuario. Los dos son la misma clase de
 * capacidad con otro nombre.
 *
 * Nada de lo que usa la app necesita salir de loopback: Electron, el watcher de
 * archivos y los agentes hablan todos por 127.0.0.1. Si algún día hace falta
 * leer el wiki desde el celular, la respuesta es una VPN de malla (Tailscale) o
 * un túnel SSH — no volver a abrir el puerto.
 */
const HOST = "127.0.0.1";

const acpServer = createServer();
new WebSocketServer({ server: acpServer }).on("connection", onAcpConnection);
acpServer.listen(acpPort, HOST);

server.listen(port, HOST, () => {
  console.log(`> ${readConfig().name} en http://localhost:${port} (agentes en ${acpPort})`);
});
