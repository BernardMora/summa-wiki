import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, resolveId } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * Id de nota -> ruta relativa al vault, sin caminar el árbol.
 *
 * El árbol del cliente ahora es perezoso: la rama de la nota abierta puede no
 * estar cargada, así que revelarla ya no se puede resolver buscando en el
 * árbol que ya tiene el cliente. `resolveId` es aritmética de rutas pura, sin
 * tocar disco, así que el único costo real aquí es el `existsSync` final.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const abs = resolveId(id);
  if (!abs || !fs.existsSync(abs)) return NextResponse.json({ rel: null });
  return NextResponse.json({ rel: path.relative(VAULT, abs).split(path.sep).join("/") });
}
