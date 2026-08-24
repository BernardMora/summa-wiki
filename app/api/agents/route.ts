import { NextResponse } from "next/server";
import { detectAcpAgents } from "@/src/agents.ts";
import { readSettings, writeSettings } from "@/src/appdata.mjs";
import { ACP_PRESETS } from "@/src/acp/presets.ts";

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
  return NextResponse.json({ acpAgents: await detectAcpAgents() });
}

/**
 * Which harness a new chat opens with.
 *
 * A sibling of the GET above and not a route of its own: one asks which
 * harnesses this machine can run, the other which one it reaches for by
 * default. Both are the same question about the same table.
 *
 * It MERGES into `settings.ai` instead of rewriting it, which is the whole
 * difference from `/api/onboarding/ai`. That route states the outcome of the
 * onboarding — agent, model and whether the person finished configuring it —
 * and rewriting the block there is correct because the wizard supplies all
 * three. Here only the agent is being answered, and carrying `configured`
 * over matters: rewriting it to `false` would put someone who has been using
 * the app for months back into the "not set up yet" branch.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const known = new Set(ACP_PRESETS.map((preset) => preset.id));
  if (!known.has(body.agent)) {
    return NextResponse.json({ error: "unknown-agent" }, { status: 400 });
  }
  const previous = readSettings().ai ?? {};
  const ai = { ...previous, agent: body.agent, configured: true };
  writeSettings({ ai });
  return NextResponse.json({ ok: true, ai });
}
