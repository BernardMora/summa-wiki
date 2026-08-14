import fs from "node:fs";
import path from "node:path";
import { configIconPath } from "@/src/config.ts";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".ico": "image/x-icon", ".avif": "image/avif",
};

/**
 * El icono de la wiki: el configurado en el vault, o el que trae la app.
 *
 * El archivo por defecto se mudó de `app/icon.svg` a `public/` a propósito.
 * En `app/` Next lo trata como convención de favicon y lo inyecta él mismo en
 * el `<head>`, lo que dejaba dos iconos compitiendo — el fijo del framework y
 * el configurable de aquí. Fuera de `app/` la única fuente es esta ruta.
 */
export async function GET() {
  const custom = configIconPath();
  const abs = custom ?? path.join(process.cwd(), "public", "wiki-icon.svg");

  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return new Response("icono no disponible", { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      // Sin caché: cambiar el icono en el JSON debe verse al recargar, no
      // cuando al navegador le apetezca.
      "Cache-Control": "no-store",
    },
  });
}
