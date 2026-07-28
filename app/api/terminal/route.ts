import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/termSessions.ts";

export const dynamic = "force-dynamic";

/**
 * La conexión de WebSocket de una terminal no mata su pty al desconectar —
 * sobrevive a cambiar de pestaña o recargar, ver server.ts. Cerrar la
 * pestaña con la × es la única acción que de verdad debe acabar la shell, y
 * eso llega aquí en vez de por el WebSocket porque la pestaña ya se quitó
 * del estado antes de que la conexión llegue a desconectarse.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) killSession(id);
  return NextResponse.json({ ok: true });
}
