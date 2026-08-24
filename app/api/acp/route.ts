import { NextRequest, NextResponse } from "next/server";
import { acpSessions, killAcpSession } from "@/lib/acpSessions.ts";

export const dynamic = "force-dynamic";

/**
 * Cerrar la pestaña de un chat mata al agente y a los comandos que lanzó.
 *
 * Por HTTP y no por el WebSocket: para cuando la conexión se entera de que se
 * cerró, la pestaña ya salió del estado, y desconectarse NO significa cerrar
 * —cambiar de panel o recargar también desconecta—. Solo la × es intención.
 *
 * Dos formas de decir qué cerrar, y la segunda es la que usa la interfaz:
 *
 * - `?id=` cierra UNA sesión.
 * - `?prefix=` cierra la pestaña ENTERA. Una pestaña de chat tiene una sesión
 *   por cada harness al que se cambió (`<pestaña>::<agente>`), todas vivas a
 *   la vez para que volver a uno lo encuentre donde se dejó. Cerrar solo la
 *   visible dejaría a los demás corriendo sin pestaña que los mostrara: un
 *   proceso de agente huérfano por cada vez que alguien probó otro harness.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) killAcpSession(id);

  const prefix = req.nextUrl.searchParams.get("prefix");
  if (prefix) {
    // Se materializa la lista antes de borrar: `killAcpSession` muta el mismo
    // mapa que se estaría recorriendo.
    const doomed = [...acpSessions.keys()].filter((key) => key === prefix || key.startsWith(`${prefix}::`));
    for (const key of doomed) killAcpSession(key);
  }

  return NextResponse.json({ ok: true });
}
