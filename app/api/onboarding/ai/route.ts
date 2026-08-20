import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/src/appdata.mjs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const allowed = new Set(["claude", "antigravity", "opencode", "codex"]);
  const agent = allowed.has(body.agent) ? body.agent : null;
  const ai = {
    agent,
    model: typeof body.model === "string" ? body.model : "",
    configured: Boolean(agent && body.configured),
  };
  writeSettings({ ai });
  return NextResponse.json({ ok: true, ai, previous: readSettings().ai });
}
