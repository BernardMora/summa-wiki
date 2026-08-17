import { NextResponse } from "next/server";
import { getIndex } from "@/lib/server.ts";
import { health, candidates } from "@/src/search.ts";

export const dynamic = "force-dynamic";

/**
 * El diagnóstico del vault, en JSON.
 *
 * Existe para la skill `/audit`. La página `/health` ya pintaba esto, pero un
 * agente no puede leer JSX, y el CLI (`wiki health`) vive en el proyecto de la
 * app, no dentro del vault — desde una skill que viaja con el vault no se
 * alcanza. Un endpoint es lo único que ambos, la interfaz y el agente, pueden
 * consumir de la misma fuente.
 *
 * Los `issues` van COMPLETOS, no una muestra: quien lo lee tiene que agrupar por
 * causa, y agrupar sobre una muestra da conteos falsos —«tres enlaces rotos»
 * cuando son cuarenta— que es justo el error que la skill intenta evitar.
 *
 * Los `candidates` sí se cortan. Son heurísticos y vienen ordenados por fuerza;
 * en el vault de este repo salen 90, que pesan dos tercios de la respuesta para
 * algo que la skill reduce a tres. Mandar los 90 no compra ni un candidato
 * mejor. `?full=1` los trae todos para quien quiera revisar la cola.
 */
const TOP_CANDIDATES = 12;

export async function GET(req: Request) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const idx = getIndex();
  const issues = health(idx);

  const byKind: Record<string, number> = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;

  const all = candidates(idx);

  return NextResponse.json({
    generatedAt: idx.generatedAt,
    stats: { ...idx.stats, notes: idx.notes.length },
    counts: byKind,
    issues,
    candidates: full ? all : all.slice(0, TOP_CANDIDATES),
    candidatesTotal: all.length,
    orphans: idx.notes
      .filter((n) => n.backlinks.length === 0)
      .map((n) => ({ id: n.id, title: n.title, type: n.type, path: n.path })),
  });
}
