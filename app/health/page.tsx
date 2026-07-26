import Link from "next/link";
import { getIndex } from "@/lib/server.ts";
import { health } from "@/src/search.ts";

export const dynamic = "force-dynamic";

const EXPECTED: Record<string, string> = {
  "no-created": "Por diseño: la fecha se deja vacía en vez de inventarla.",
  "stale-active": "Proyectos activos sin tocar en 30+ días.",
};

export default function Health() {
  const idx = getIndex();
  const issues = health(idx);
  const by = new Map<string, typeof issues>();
  for (const i of issues) { if (!by.has(i.kind)) by.set(i.kind, []); by.get(i.kind)!.push(i); }

  return (
    <article>
      <h1>Salud del wiki</h1>
      <p className="infoline">
        <span>{issues.length} hallazgo(s)</span><span>{idx.notes.length} notas</span>
        <span>{idx.stats.brokenLinks} enlaces rotos</span>
      </p>
      {[...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([kind, list]) => (
        <section key={kind}>
          <h2>{kind} <span className="dim">({list.length})</span></h2>
          {EXPECTED[kind] && <p className="dim">{EXPECTED[kind]}</p>}
          <ul>
            {list.slice(0, 40).map((i, n) => (
              <li key={n}>
                <Link href={`/note/${encodeURIComponent(i.note)}`}>{i.note}</Link>
                {i.detail && <span className="dim"> — {i.detail}</span>}
              </li>
            ))}
            {list.length > 40 && <li className="dim">… {list.length - 40} más</li>}
          </ul>
        </section>
      ))}
    </article>
  );
}
