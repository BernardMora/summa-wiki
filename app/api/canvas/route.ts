import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveAsset, VAULT } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * Lee y escribe archivos `.canvas` (formato de Obsidian Canvas): JSON con
 * `nodes` y `edges`. Ruta aparte de /api/note porque no son notas markdown y
 * no entran al índice.
 */

/** Resuelve dentro del vault y rechaza cualquier escape del árbol. */
function safePath(rel: string): string | null {
  if (!rel.endsWith(".canvas")) return null;
  const abs = path.resolve(VAULT, rel);
  return abs.startsWith(path.resolve(VAULT) + path.sep) ? abs : null;
}

/**
 * Obsidian escribe cada nodo y cada arista en una sola línea, con tabulador de
 * indentación. `JSON.stringify(x, null, "\t")` expande cada objeto en varias
 * líneas: el archivo queda equivalente pero el diff crece a más de cien líneas
 * y el historial se ensucia cada vez que Obsidian y la app se turnan.
 */
function serialize(nodes: unknown[], edges: unknown[]): string {
  const arr = (xs: unknown[]) =>
    xs.length ? `[\n\t\t${xs.map((x) => JSON.stringify(x)).join(",\n\t\t")}\n\t]` : "[]";
  return `{\n\t"nodes":${arr(nodes)},\n\t"edges":${arr(edges)}\n}`;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return NextResponse.json({ error: "p required" }, { status: 400 });
  const abs = resolveAsset(p);
  if (!abs || !abs.endsWith(".canvas")) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : { nodes: [], edges: [] };
    return NextResponse.json({
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
      mtimeMs: fs.statSync(abs).mtimeMs,
    });
  } catch (e) {
    return NextResponse.json({ error: `no se pudo leer: ${(e as Error).message}` }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { p, nodes, edges, mtimeMs } = (await req.json()) ?? {};
  if (!p || !Array.isArray(nodes) || !Array.isArray(edges))
    return NextResponse.json({ error: "p, nodes y edges requeridos" }, { status: 400 });
  const abs = safePath(p);
  if (!abs || !fs.existsSync(abs)) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Mismo trato que las notas: si cambió en disco desde que se cargó, no se
  // pisa — el cliente decide recargar o forzar.
  const current = fs.statSync(abs).mtimeMs;
  if (typeof mtimeMs === "number" && Math.abs(current - mtimeMs) > 1) {
    return NextResponse.json({ error: "stale", currentMtimeMs: current }, { status: 409 });
  }

  fs.writeFileSync(abs, serialize(nodes, edges), "utf8");
  return NextResponse.json({ ok: true, mtimeMs: fs.statSync(abs).mtimeMs });
}
