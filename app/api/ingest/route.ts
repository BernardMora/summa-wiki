import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import { VAULT, ARCH, vaultExists } from "@/src/config.ts";
import { loadArchitecture } from "@/src/architectures/index.ts";
import fs from "node:fs";
import { invalidate } from "@/lib/server.ts";
import { scanFolders, planIngest, applyPlan, writeLedger } from "@/src/ingest.ts";
import { writeIngestSkill, findClaude } from "@/src/ingest-skill.ts";

export const dynamic = "force-dynamic";

/**
 * Ingesta en dos tiempos: `?dry=1` mide, sin `dry` escribe.
 *
 * La separación no es cortesía: el escaneo de una carpeta grande tarda, y sin
 * una vista previa el usuario estaría autorizando a ciegas una operación que
 * copia miles de archivos a su vault. Es el mismo patrón del script de enlaces
 * de la Fase 9 — dry run primero, aplicar después — que ahí evitó romper 228
 * enlaces.
 */

/** Estado del motor: ¿hay agente con el que correr el reparto? */
export async function GET() {
  const claude = await findClaude();
  return NextResponse.json({
    claude,
    inbox: ARCH.inbox,
    architecture: { id: ARCH.id, name: ARCH.name },
  });
}

function expand(p: string): string {
  const e = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
  return path.resolve(e);
}

/**
 * Contra qué vault se ingiere.
 *
 * Normalmente el que está abierto. Pero durante la creación se ingiere a un
 * vault **recién hecho que todavía no es el activo**: reiniciar el servidor a
 * mitad del asistente para poder meterle archivos tiraría la pantalla en la que
 * está el usuario, y con ella el hilo de lo que estaba haciendo. Se acepta un
 * destino explícito y se valida que sea un vault de verdad — que tenga
 * `.summa/` — para que este parámetro no se convierta en "escribe donde yo te
 * diga".
 */
function targetVault(raw: unknown): { dir: string; arch: ReturnType<typeof loadArchitecture> } | null {
  if (typeof raw !== "string" || !raw.trim()) {
    return vaultExists() ? { dir: VAULT, arch: ARCH } : null;
  }
  const dir = expand(raw.trim());
  try {
    if (!fs.statSync(path.join(dir, ".summa")).isDirectory()) return null;
  } catch { return null; }
  return { dir, arch: loadArchitecture(dir) };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const target = targetVault(body?.vault);
  if (!target) {
    return NextResponse.json({ error: "no se encuentra el vault destino" }, { status: 409 });
  }
  const { dir: vault, arch } = target;

  const raw = Array.isArray(body?.folders) ? body.folders : [];
  const folders = raw.filter((f: unknown) => typeof f === "string" && f.trim()).map((f: string) => expand(f.trim()));
  if (!folders.length) return NextResponse.json({ error: "no elegiste ninguna carpeta" }, { status: 400 });

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const scan = scanFolders(folders, vault);
  const plan = planIngest(scan, arch);

  if (dry) {
    return NextResponse.json({
      counts: scan.counts,
      bytes: scan.bytes,
      duplicates: scan.duplicates,
      unreadable: scan.unreadable,
      truncated: scan.truncated,
      truncatedBy: scan.truncatedBy,
      ms: scan.ms,
      willCopy: plan.actions.length,
      willSkip: plan.skipped.length,
      // Una muestra, no la lista entera: 20,000 rutas por JSON no las lee
      // nadie y tardan más en pintarse que el escaneo en correr.
      sample: plan.actions.slice(0, 25).map((a) => ({ from: a.from, to: a.to, kind: a.kind })),
      inbox: arch.inbox,
    });
  }

  const ledger = applyPlan(plan, vault, arch, folders);
  const ledgerFile = writeLedger(vault, ledger);
  const ledgerRel = path.relative(vault, ledgerFile).split(path.sep).join("/");
  const skill = writeIngestSkill(vault, arch, ledgerRel);
  // Solo si se escribió en el vault ABIERTO: invalidar el índice de otro vault
  // no significa nada, y el de este no ha cambiado.
  if (vault === VAULT) invalidate();

  return NextResponse.json({
    ok: true,
    copied: ledger.copied.length,
    companions: ledger.companions.length,
    skipped: ledger.skipped.length,
    errors: ledger.errors,
    ledger: ledgerRel,
    skill: skill.canonical,
    skillAdapters: skill.adapters,
    vault,
    claude: await findClaude(),
  });
}
