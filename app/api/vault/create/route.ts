import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getPacks, getPack } from "@/src/architectures/index.ts";
import { createVault } from "@/src/scaffold.ts";
import { validateCreate, blocking } from "@/src/validate.ts";
import { getLocale } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

/**
 * Crear un vault nuevo con una arquitectura elegida.
 *
 * El GET publica el catálogo para pintar el selector; el cliente no puede
 * importar los paquetes porque viven en módulos que tocan `node:fs`.
 */
export async function GET() {
  return NextResponse.json({
    packs: getPacks(getLocale()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      folders: p.folders.map((f) => ({ path: f.path, purpose: f.purpose })),
      hubs: p.hubs.map((h) => h.label),
      categories: p.categories.length,
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw = body && typeof body.path === "string" ? body.path.trim() : "";
  const name = body && typeof body.name === "string" ? body.name.trim() : "";
  const packId = body && typeof body.architecture === "string" ? body.architecture : "";
  const requestedAgent = body && typeof body.agent === "string" ? body.agent : "claude";
  const agent = ["claude", "antigravity", "opencode", "codex"].includes(requestedAgent)
    ? requestedAgent
    : "claude";

  const problems = validateCreate(name, raw);
  const errors = blocking(problems);

  const pack = getPack(packId, getLocale());
  if (!pack) errors.push({ field: "path", level: "error", message: "arquitectura desconocida" });

  // `?check=1` valida y no escribe nada. Es lo que consulta la interfaz
  // mientras el usuario teclea, para poder decir qué falta ANTES de que pulse
  // el botón en vez de después.
  if (new URL(req.url).searchParams.get("check") === "1") {
    return NextResponse.json({ ok: errors.length === 0, problems });
  }

  if (errors.length) {
    return NextResponse.json({ error: errors[0].message, problems }, { status: 400 });
  }

  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  const dir = path.resolve(expanded);

  let result;
  try {
    result = createVault(dir, name.trim(), pack!, agent, getLocale());
  } catch (e) {
    return NextResponse.json({ error: `no se pudo escribir: ${(e as Error).message}` }, { status: 500 });
  }

  // NO se marca como activo aquí. Crear la estructura y cambiarse a ella son
  // dos actos distintos, y el asistente todavía tiene dos pasos por delante —
  // traer archivos y repartirlos. Marcarlo al crear dejaba al usuario "dentro"
  // de un vault vacío mientras seguía en el asistente, y bastaba con que
  // cerrara la app a mitad para que reabriera en un vault que nunca terminó de
  // montar. El cambio lo hace `POST /api/vault` cuando le da a «Abrir mi wiki».
  return NextResponse.json({
    ok: true,
    vault: dir,
    created: result.created.length,
    skipped: result.skipped,
    needsRestart: true,
  });
}
