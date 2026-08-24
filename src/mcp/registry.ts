import { randomBytes } from "node:crypto";
import type { UiAction } from "./tools.ts";
import { resolvePort } from "../ports.mjs";

/**
 * Qué conversación está detrás de cada URL del servidor MCP.
 *
 * ## Por qué hay un token y no una sola URL para todos
 *
 * Dos razones, y la segunda es la que manda:
 *
 * 1. **Nadie más puede llamar.** El servidor escucha en loopback, pero
 *    loopback no es privado: cualquier proceso de la máquina —y cualquier
 *    página web abierta en el navegador— puede hacerle una petición. Un token
 *    imposible de adivinar es lo que separa «el agente que la app lanzó» de
 *    «lo que sea que corra en esta laptop».
 *
 * 2. **Se sabe QUIÉN pregunta.** Las herramientas de interfaz —abrir una nota,
 *    enfocar el grafo— tienen que llegar a la ventana que mira ESA
 *    conversación, no a todas. Sin un identificador en la URL, un agente
 *    abriría notas en la pestaña de otro.
 *
 * El token se registra al abrir la conversación y se borra al cerrarla, así
 * que una URL filtrada en un log deja de valer en cuanto el chat se cierra.
 *
 * `globalThis` bajo `Symbol.for` por lo mismo que `lib/acpSessions.ts`:
 * `server.ts` corre con el cargador nativo de Node y las rutas de `app/api`
 * con el bundler de Next, así que cada uno instanciaría su propio módulo y el
 * mapa de uno no sería el del otro. La ruta encontraría el token vacío
 * siempre.
 */

export interface McpEndpoint {
  /** Id de la conversación de chat a la que pertenece. */
  session: string;
  /** Entrega una acción de interfaz a quien esté mirando esa conversación. */
  ui: (action: UiAction) => void;
}

const KEY = Symbol.for("summa-wiki.mcpEndpoints");
type Registry = Map<string, McpEndpoint>;
const g = globalThis as unknown as Record<symbol, Registry>;
g[KEY] ??= new Map<string, McpEndpoint>();
const endpoints: Registry = g[KEY];

/** Da de alta un extremo y devuelve su token. 32 bytes: no se adivina. */
export function registerMcpEndpoint(endpoint: McpEndpoint): string {
  const token = randomBytes(32).toString("base64url");
  endpoints.set(token, endpoint);
  return token;
}

export function mcpEndpoint(token: string): McpEndpoint | undefined {
  return endpoints.get(token);
}

/** Retira todos los tokens de una conversación. La llama el cierre del chat. */
export function releaseMcpEndpoints(session: string) {
  for (const [token, endpoint] of endpoints) if (endpoint.session === session) endpoints.delete(token);
}

/**
 * La URL que se le da al agente.
 *
 * El puerto sale de `PORT` —la MISMA variable que lee `server.ts`— y no de una
 * constante: la app de escritorio busca un puerto libre al arrancar y se lo
 * pasa al servidor por el entorno, así que un puerto fijo apuntaría al hueco
 * cuando hay dos ventanas abiertas o cuando el primero estaba ocupado.
 */
export function mcpUrl(token: string): string {
  const port = resolvePort();
  return `http://127.0.0.1:${port}/api/mcp/${token}`;
}
