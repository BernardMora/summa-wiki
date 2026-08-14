import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, invalidate } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

function safe(rel: string): string | null {
  const abs = path.resolve(VAULT, rel);
  const root = path.resolve(VAULT);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const rel = form.get("rel");
  const file = form.get("file");

  if (typeof rel !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "rel y file requeridos" }, { status: 400 });
  }

  const destAbs = safe(rel);
  if (!destAbs || !fs.existsSync(destAbs) || !fs.statSync(destAbs).isDirectory()) {
    return NextResponse.json({ error: "destino inválido" }, { status: 400 });
  }

  const finalName = file.name;
  const finalPath = path.join(destAbs, finalName);
  
  if (fs.existsSync(finalPath)) {
    return NextResponse.json({ error: "el archivo ya existe" }, { status: 409 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(finalPath, buf);

  invalidate();
  return NextResponse.json({ ok: true, name: finalName });
}
