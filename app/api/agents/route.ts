import { NextResponse } from "next/server";
import { detectAgents } from "@/src/agents.ts";

export const dynamic = "force-dynamic";

/**
 * Qué agentes están instalados en esta máquina.
 *
 * Vive en el servidor porque el navegador no ve el PATH, y es lo que permite
 * que el asistente de creación deje de preguntar («¿tienes una suscripción?»)
 * y pase a comprobar. La respuesta a la pregunta que importa —¿va a correr el
 * comando?— no la sabe el usuario, la sabe el sistema de archivos.
 *
 * Se devuelven las rutas y no solo booleanos: saber DÓNDE está el binario es lo
 * que permite explicar un «lo tengo instalado y dice que no» cuando hay dos
 * versiones o el PATH del Dock difiere del de la Terminal.
 */
export async function GET() {
  return NextResponse.json({ agents: await detectAgents() });
}
