import { NextRequest, NextResponse } from "next/server";
import { agyModels } from "@/src/agents.ts";

export const dynamic = "force-dynamic";

/**
 * Catálogo en vivo de modelos para el agente que lo tenga (por ahora, agy).
 * Claude Code y OpenCode siguen con la lista fija de `agent-session.ts` — sus
 * CLIs no exponen un comando equivalente para pedirla en vivo.
 */
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");
  if (agent === "antigravity") {
    return NextResponse.json({ models: await agyModels() });
  }
  return NextResponse.json({ models: null });
}
