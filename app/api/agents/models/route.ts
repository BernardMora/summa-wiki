import { NextRequest, NextResponse } from "next/server";
import { agyModels, codexModels } from "@/src/agents.ts";

export const dynamic = "force-dynamic";

/**
 * Catálogo en vivo de modelos para los CLIs que lo exponen. Claude Code y
 * OpenCode siguen con sus aliases curados en `agent-session.ts`.
 */
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");
  if (agent === "antigravity") {
    return NextResponse.json({ models: await agyModels() });
  }
  if (agent === "codex") {
    return NextResponse.json({ models: await codexModels() });
  }
  return NextResponse.json({ models: null });
}
