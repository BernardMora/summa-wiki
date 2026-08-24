import { NextRequest, NextResponse } from "next/server";
import { handleMcpBody } from "@/src/mcp/server.ts";
import { mcpEndpoint } from "@/src/mcp/registry.ts";
import { getIndex } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * El servidor MCP de la app, por HTTP.
 *
 * ## Por qué aquí y no en un puerto propio
 *
 * La terminal y ACP tienen puerto propio porque son WebSockets, y compartir el
 * `http.Server` de Next con una conexión que se actualiza mata la conexión —
 * está documentado en `server.ts` con la investigación que lo demostró. MCP
 * por HTTP no actualiza nada: es una petición y una respuesta, exactamente lo
 * que las rutas de Next hacen bien. Un cuarto puerto sería un cuarto puerto
 * que reservar al arrancar, para nada.
 *
 * ## Por qué el token va en la ruta y no en una cabecera
 *
 * `McpServerHttp` de ACP admite cabeceras, así que las dos cosas se pueden.
 * Pero la ruta la reenvía TODO —el proxy de stdio de más abajo, un `curl` de
 * diagnóstico, un adaptador que no propague cabeceras que no conoce— y una
 * cabecera perdida por el camino falla como «no autorizado», que es el error
 * más difícil de leer de todos. Ver `src/mcp/registry.ts` para qué separa el
 * token.
 *
 * ## Sin SSE
 *
 * El transporte «streamable HTTP» permite contestar con `application/json` a
 * secas cuando el servidor no necesita mandar nada por su cuenta, y éste no lo
 * necesita: no hay notificaciones ni progreso. `GET` y `DELETE` contestan 405,
 * que es la respuesta que la especificación prevé para un servidor sin flujo
 * de servidor.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const endpoint = mcpEndpoint(token);
  // 404 y no 401: un token que no existe no debe poder distinguirse de una
  // ruta que no existe, o probar tokens diría cuáles están vivos.
  if (!endpoint) return new NextResponse("Not found", { status: 404 });

  let body: unknown;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const response = handleMcpBody(body, {
    // El índice se relee en cada llamada. Es lo correcto y es barato: `getIndex`
    // ya cachea y se invalida sola cuando una escritura toca el vault, así que
    // el agente nunca contesta sobre una foto vieja de un vault que él mismo
    // acaba de cambiar.
    index: () => getIndex(),
    ui: endpoint.ui,
  });

  // Un lote entero de notificaciones no tiene nada que contestar.
  if (response === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(response);
}

export async function GET() {
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
