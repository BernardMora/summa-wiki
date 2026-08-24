import { MCP_TOOLS, toolByName, type McpContext } from "./tools.ts";

/**
 * El servidor MCP de la app, sin transporte.
 *
 * ## Por qué está escrito a mano y no con el SDK de MCP
 *
 * La superficie que necesita un servidor que solo expone herramientas es
 * `initialize`, `tools/list` y `tools/call`, más dos métodos de cortesía. Son
 * las ~120 líneas de abajo. El SDK oficial trae su propio transporte HTTP
 * atado a los objetos `req`/`res` de Node, que es justo lo que aquí no hay —
 * las rutas de Next hablan `Request`/`Response` del estándar web—, y arrastra
 * dependencias que esta app no tiene. La misma razón por la que `GraphView`
 * no usa d3 y el CLI corre sin paso de compilación.
 *
 * Lo que NO se hace a mano es ACP: eso sí usa su SDK, porque ahí la superficie
 * es grande y cambia. La regla es el tamaño del contrato, no la ideología.
 *
 * ## Sin estado, a propósito
 *
 * Cada petición se contesta por sí sola: no hay `Mcp-Session-Id`, no hay
 * suscripciones, no hay SSE. El protocolo lo permite explícitamente, y aquí
 * encaja porque el estado que importaría —qué conversación pregunta— ya lo
 * lleva la URL, y el que el agente querría recordar —el índice— se relee solo.
 *
 * ## Versión del protocolo
 *
 * Se responde con la que pida el cliente cuando la conocemos, y con la nuestra
 * cuando no. Es lo que manda la especificación, y es lo que evita que un
 * adaptador más nuevo que esta app se desconecte por una fecha.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: string | number | null, code: number, message: string): JsonRpcResponse =>
  ({ jsonrpc: "2.0", id, error: { code, message } });

/** El esquema que se anuncia, sin el `run` — que no es serializable ni suyo. */
const advertised = () => MCP_TOOLS.map(({ name, title, description, inputSchema }) =>
  ({ name, title, description, inputSchema }));

/**
 * Contesta un mensaje JSON-RPC.
 *
 * Devuelve `null` para las notificaciones —un mensaje sin `id`—, que por
 * contrato no llevan respuesta. Mandar una es lo que rompe a los clientes
 * estrictos: `notifications/initialized` llega siempre y siempre sin id.
 */
export function handleMcpMessage(message: JsonRpcRequest, ctx: McpContext): JsonRpcResponse | null {
  const id = message.id ?? null;
  const notification = message.id === undefined || message.id === null;

  switch (message.method) {
    case "initialize": {
      const asked = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "";
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.has(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "summa-wiki", title: "Summa Wiki", version: "0.4.0" },
        instructions:
          "Tools over the user's own knowledge vault. `search` before reading files — it is ranked "
          + "and it knows the vault's structure. The `open_note`, `open_graph` and `focus_graph` tools "
          + "act on the window the user is looking at right now: use them to SHOW an answer instead of "
          + "describing it, and never as a substitute for saying it.",
      });
    }

    // Notificaciones del ciclo de vida. Se aceptan y no se contesta nada.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return notification ? null : ok(id, {});

    case "tools/list":
      return ok(id, { tools: advertised() });

    case "tools/call": {
      const name = typeof message.params?.name === "string" ? message.params.name : "";
      const tool = toolByName(name);
      if (!tool) return err(id, -32602, `Unknown tool: ${name}`);
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, tool.run(args, ctx));
      } catch (error) {
        /*
         * Un fallo de la herramienta se devuelve como RESULTADO con
         * `isError`, no como error de JSON-RPC. Es lo que dice la
         * especificación y no es un detalle: un error de protocolo lo absorbe
         * el cliente y el modelo nunca se entera, así que reintenta lo mismo
         * para siempre. Como resultado, lo lee y corrige.
         */
        return ok(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }

    // `resources` y `prompts` no se anuncian en `capabilities`, así que un
    // cliente correcto no los pide. Alguno los pide igual al arrancar, y una
    // lista vacía es más barata que un error que se pinta como avería.
    case "resources/list":
      return notification ? null : ok(id, { resources: [] });
    case "prompts/list":
      return notification ? null : ok(id, { prompts: [] });

    default:
      return notification ? null : err(id, -32601, `Method not found: ${message.method}`);
  }
}

/**
 * Contesta un cuerpo entero, que puede ser un mensaje o un lote.
 *
 * Devuelve `null` cuando no hay nada que contestar —un lote entero de
 * notificaciones—, y quien transporte debe responder 202 sin cuerpo.
 */
export function handleMcpBody(body: unknown, ctx: McpContext): JsonRpcResponse | JsonRpcResponse[] | null {
  if (Array.isArray(body)) {
    const out = body
      .map((message) => handleMcpMessage(message as JsonRpcRequest, ctx))
      .filter((response): response is JsonRpcResponse => response !== null);
    return out.length ? out : null;
  }
  if (typeof body !== "object" || body === null) return err(null, -32700, "Parse error");
  return handleMcpMessage(body as JsonRpcRequest, ctx);
}
