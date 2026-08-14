import { NextResponse } from "next/server";
import { readConfig, writeConfig, configIconPath, vaultExists } from "@/src/config.ts";

export const dynamic = "force-dynamic";

/**
 * Identidad de la wiki para quien no puede leer el vault directamente: el
 * cliente, y el proceso principal de Electron una vez que el servidor está en
 * pie. `hasIcon` evita que quien la consume tenga que pedir la imagen solo
 * para descubrir que no hay ninguna configurada.
 */
export async function GET() {
  const cfg = readConfig();
  return NextResponse.json({ ...cfg, hasIcon: configIconPath() !== null });
}

/** Guarda el nombre y la bajada desde el panel de configuración. */
export async function POST(req: Request) {
  // Sin vault en disco no hay dónde guardar, y `writeConfig` crearía el árbol
  // con un `mkdirSync` recursivo — fabricando una carpeta que el usuario no
  // pidió, en una ruta que puede ser un punto de montaje desconectado. Mismo
  // razonamiento que en `writeCategories`.
  if (!vaultExists()) {
    return NextResponse.json({ error: "no se encuentra el vault" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    // Vacío no se acepta: dejaría la app sin nombre en el título, el splash y
    // la barra lateral. Para volver al de fábrica se borra la clave del JSON.
    if (!name) return NextResponse.json({ error: "el nombre no puede quedar vacío" }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: "nombre demasiado largo" }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.tagline === "string") {
    if (body.tagline.trim().length > 80) {
      return NextResponse.json({ error: "bajada demasiado larga" }, { status: 400 });
    }
    patch.tagline = body.tagline.trim();
  }

  const cfg = writeConfig(patch);
  return NextResponse.json({ ...cfg, hasIcon: configIconPath() !== null });
}
