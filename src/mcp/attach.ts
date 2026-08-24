import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import { mcpUrl } from "./registry.ts";

/**
 * Cómo se le entrega a CADA agente el servidor MCP de la app.
 *
 * ## Lo que se midió, no lo que dice el esquema
 *
 * El transporte no se elige por gusto: se elige por lo que el agente anuncia
 * en `initialize`. Contra los cuatro adaptadores instalados el 21-08-2026:
 *
 * | agente                       | `mcpCapabilities`              |
 * |------------------------------|--------------------------------|
 * | Claude Code (adaptador 0.70) | `http: true, sse: true`        |
 * | Codex (adaptador 1.6.2)      | `acp: false, http: true`       |
 * | OpenCode 1.18.21             | `http: true, sse: true`        |
 * | Hermes 0.20.5                | *no anuncia ninguna*           |
 *
 * De ahí salen las dos ramas y ninguna más:
 *
 * - **HTTP** para quien lo anuncia. Es una URL de loopback contra el servidor
 *   que la app ya tiene levantado: cero procesos nuevos.
 * - **stdio** para el resto. Es el transporte que todo agente debe soportar,
 *   así que un agente que no anuncia nada lo tiene. Lanza `stdio.mjs`, que
 *   reenvía a la misma URL — el servidor sigue siendo uno solo.
 *
 * El transporte `acp` del SDK —el que llevaría MCP por la propia conexión, sin
 * URL ni proceso— sería el más limpio de los tres y está descartado: Codex lo
 * declara `false` explícitamente y nadie lo declara `true`. Está marcado como
 * inestable en el esquema. Cuando alguien lo implemente, es una tercera rama
 * aquí y nada más.
 */

/** Nombre con el que el agente ve las herramientas. Sale en su lista. */
const SERVER_NAME = "summa-wiki";

/**
 * Ruta del puente de stdio.
 *
 * Se prueba primero junto a este módulo y se cae al directorio de trabajo. Las
 * dos rutas existen por una razón concreta: este archivo lo evalúan DOS
 * cargadores —el nativo de Node desde `server.ts` y el bundler de Next al
 * empaquetar las rutas de `app/api`— y bajo el segundo `import.meta.url`
 * apunta dentro de `.next`, donde no hay ningún `stdio.mjs`. El servidor
 * siempre arranca con el directorio raíz del proyecto como cwd (`npm run dev`
 * y `electron/main.js` con `cwd: ROOT`), así que el respaldo acierta.
 */
function bridgePath(): string | null {
  const candidates: string[] = [];
  try { candidates.push(fileURLToPath(new URL("./stdio.mjs", import.meta.url))); } catch { /* sin URL utilizable */ }
  candidates.push(path.join(process.cwd(), "src", "mcp", "stdio.mjs"));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * El servidor MCP que hay que pasarle a `session/new`, o `null`.
 *
 * `null` significa «este agente se queda sin las herramientas del wiki», y es
 * un resultado aceptable: pasa solo si no encontramos el puente en disco. La
 * conversación tiene que arrancar igual — un agente sin herramientas sigue
 * siendo un agente, y caerse aquí convertiría una carencia en una avería.
 */
export function mcpServerFor(init: acp.InitializeResponse, token: string): acp.McpServer | null {
  const url = mcpUrl(token);
  if (init.agentCapabilities?.mcpCapabilities?.http) {
    return { type: "http", name: SERVER_NAME, url, headers: [] };
  }

  const bridge = bridgePath();
  if (!bridge) return null;

  /*
   * `process.execPath` y no "node": dentro del paquete no hay ningún Node
   * instalado que se pueda dar por hecho — el ejecutable es el propio binario
   * de Electron, que hace de Node cuando se le pone `ELECTRON_RUN_AS_NODE`.
   * Es el mismo truco con el que `electron/server-env.mjs` arranca el
   * servidor, y se propaga aquí por la misma razón: el hijo tiene que ser un
   * Node, no una segunda ventana de la app.
   */
  const env: acp.EnvVariable[] = process.env.ELECTRON_RUN_AS_NODE
    ? [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }]
    : [];

  return { name: SERVER_NAME, command: process.execPath, args: [bridge, url], env };
}
