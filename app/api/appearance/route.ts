import { NextResponse } from "next/server";
import { readAppearance, writeAppearance } from "@/src/appearance/store.ts";
import { resolveAppearance } from "@/src/appearance/catalog.ts";
import { vaultExists } from "@/src/config.ts";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = readAppearance();
  return NextResponse.json({ config, resolved: resolveAppearance(config) });
}

export async function POST(req: Request) {
  if (!vaultExists()) return NextResponse.json({ error: getT()("err.vaultNotFound") }, { status: 409 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: getT()("err.invalidBody") }, { status: 400 });
  try {
    const config = writeAppearance(body);
    return NextResponse.json({ config, resolved: resolveAppearance(config) });
  } catch {
    return NextResponse.json({ error: getT()("settings.saveFailed") }, { status: 500 });
  }
}
