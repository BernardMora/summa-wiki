import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import { VAULT, VAULT_SOURCE, HAS_VAULT, MIGRATED, vaultExists } from "@/src/config.ts";
import { readSettings, rememberVault, inspectVault, writeSettings } from "@/src/appdata.mjs";

export const dynamic = "force-dynamic";

/**
 * Qué vault está abierto y cómo cambiarlo.
 *
 * El cambio NO surte efecto en esta petición: `VAULT` se resuelve al cargar el
 * módulo (ver `src/config.ts`), así que lo único que hace el POST es dejar la
 * elección escrita en la configuración de máquina. Quien reinicia es el
 * proceso principal de Electron, que ya sabe levantar y matar el servidor.
 * Por eso la respuesta trae `needsRestart`: el cliente no debe fingir que ya
 * cambió algo.
 */

function homeRelative(abs: string): string {
  const home = os.homedir();
  return abs === home || abs.startsWith(home + path.sep) ? "~" + abs.slice(home.length) : abs;
}

export async function GET() {
  const { recents } = readSettings();
  return NextResponse.json({
    vault: HAS_VAULT ? VAULT : null,
    display: HAS_VAULT ? homeRelative(VAULT) : null,
    source: VAULT_SOURCE,
    exists: vaultExists(),
    // Solo informativo: la migración ya ocurrió al cargar el módulo. Sirve
    // para poder decir en la interfaz qué se movió en vez de que el usuario
    // descubra el rename por su cuenta en `git status`.
    migrated: MIGRATED,
    recents: recents.map((r) => ({ path: r, display: homeRelative(r), current: r === VAULT })),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw = body && typeof body.path === "string" ? body.path.trim() : "";
  if (!raw) return NextResponse.json({ error: "falta la ruta" }, { status: 400 });

  // `~` se expande aquí y no en el cliente: quien escribe la ruta a mano en el
  // navegador no tiene forma de saber cuál es el home del proceso servidor.
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  const abs = path.resolve(expanded);

  // Se exige absoluta DESPUÉS de expandir: una relativa se resolvería contra
  // el directorio de trabajo del servidor, que no es un sitio que el usuario
  // conozca ni pueda predecir.
  if (!path.isAbsolute(expanded)) {
    return NextResponse.json({ error: "la ruta tiene que ser absoluta" }, { status: 400 });
  }

  const kind = inspectVault(abs);
  if (kind === "missing") {
    return NextResponse.json({ error: "esa carpeta no existe" }, { status: 400 });
  }
  // Una carpeta vacía SÍ se acepta: es el vault que todavía no se ha creado, y
  // rechazarla obligaría a fabricar una nota falsa antes de poder abrirla. La
  // interfaz avisa; la decisión es del usuario.

  if (abs === VAULT) {
    return NextResponse.json({ ok: true, vault: abs, needsRestart: false, kind });
  }

  const settings = rememberVault(abs);
  // Abrir Atlas mantiene el recorrido en curso. Cualquier otro vault elegido
  // explícitamente completa el onboarding: el usuario ya llegó a su espacio.
  if (settings.demoVault?.path !== abs && settings.onboarding.status === "in_progress") {
    writeSettings({ onboarding: { ...settings.onboarding, status: "completed", stage: "done", lesson: null } });
  }
  return NextResponse.json({ ok: true, vault: abs, display: homeRelative(abs), needsRestart: true, kind });
}
