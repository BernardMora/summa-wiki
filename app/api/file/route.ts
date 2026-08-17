import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, invalidate } from "@/lib/server.ts";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

/**
 * Leer y escribir cualquier archivo de texto del vault.
 *
 * Aparte de `/api/note` a propósito: las notas pasan por `writeNote`, que
 * sella `updated:` y aplica los marcadores de procedencia. Eso es correcto
 * para una nota y estaría mal para un `.ts` o un `.json` — les inyectaría
 * frontmatter que nadie pidió. Aquí se escribe el archivo tal cual.
 */

const MAX_EDIT = 2 * 1024 * 1024;   // 2 MB
const SNIFF = 8192;

/** Toda ruta del cliente es hostil hasta demostrar lo contrario. */
function safe(rel: string): string | null {
  const abs = path.resolve(VAULT, rel);
  const root = path.resolve(VAULT);
  if (abs === root) return null;
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/**
 * Un NUL en los primeros 8 KB es binario. Es la heurística de git y de file(1),
 * y acierta en todo lo que va a caer aquí: los formatos de texto no llevan NUL
 * y los binarios lo llevan casi siempre en la cabecera.
 *
 * El segundo criterio cubre el resto: UTF-16 y algunos binarios sin NUL
 * temprano pasan el primero, pero se delatan por la densidad de bytes de
 * control.
 */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, SNIFF);
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
    // Tabulador, salto de línea, retorno de carro y escape son texto legítimo.
    if (b < 9 || (b > 13 && b < 32 && b !== 27)) control++;
  }
  return n > 0 && control / n > 0.15;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return NextResponse.json({ error: getT()("err.pRequired") }, { status: 400 });

  const abs = safe(decodeURIComponent(p));
  if (!abs) return NextResponse.json({ error: getT()("err.invalidPath") }, { status: 400 });

  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return NextResponse.json({ error: getT()("err.doesNotExist") }, { status: 404 }); }
  if (st.isDirectory()) return NextResponse.json({ error: getT()("err.isAFolder") }, { status: 400 });

  if (st.size > MAX_EDIT) {
    return NextResponse.json({ tooBig: true, size: st.size, mtimeMs: st.mtimeMs });
  }

  const buf = fs.readFileSync(abs);
  if (looksBinary(buf)) {
    return NextResponse.json({ binary: true, size: st.size, mtimeMs: st.mtimeMs });
  }

  return NextResponse.json({
    text: buf.toString("utf8"),
    size: st.size,
    mtimeMs: st.mtimeMs,
  });
}

export async function POST(req: Request) {
  const { p, text, mtimeMs } = await req.json();
  if (typeof p !== "string" || typeof text !== "string") {
    return NextResponse.json({ error: getT()("err.pAndTextRequired") }, { status: 400 });
  }

  const abs = safe(p);
  if (!abs) return NextResponse.json({ error: getT()("err.invalidPath") }, { status: 400 });
  if (!fs.existsSync(abs)) return NextResponse.json({ error: getT()("err.doesNotExist") }, { status: 404 });

  // Mismo control optimista que writeNote: si el archivo cambió por debajo
  // (git, otro editor, un agente) se rechaza en vez de pisarlo.
  const current = fs.statSync(abs).mtimeMs;
  if (typeof mtimeMs === "number" && Math.abs(current - mtimeMs) > 1) {
    return NextResponse.json(
      { error: "stale", currentMtimeMs: current, currentContent: fs.readFileSync(abs, "utf8") },
      { status: 409 },
    );
  }

  fs.writeFileSync(abs, text, "utf8");
  // Un .md fuera del índice puede entrar en él al guardarse; y cualquier
  // cambio en 04-Sistema/*.json altera categorías o estado del wiki.
  invalidate();
  return NextResponse.json({ ok: true, mtimeMs: fs.statSync(abs).mtimeMs });
}
