import Link from "next/link";
import { navGroups } from "@/lib/nav.ts";

export const dynamic = "force-dynamic";

export default function Categories() {
  const all = navGroups(10_000);
  const groups = all.filter((g) => !g.hidden);
  const hidden = all.filter((g) => g.hidden);
  return (
    <article>
      <h1>Todas las categorías</h1>
      <p className="infoline">
        <span>{groups.length} categorías</span>
        {hidden.length > 0 && <span>{hidden.length} ocultas</span>}
      </p>
      {groups.map((g) => (
        <section key={g.label} id={encodeURIComponent(g.label)}>
          <h2>{g.label} <span className="dim">({g.total})</span></h2>
          <ul style={{ columns: 2, columnGap: 28 }}>
            {g.items.map((i) => (
              <li key={i.id}><Link href={`/note/${encodeURIComponent(i.id)}`}>{i.title}</Link></li>
            ))}
          </ul>
        </section>
      ))}

      {hidden.length > 0 && (
        <>
          <h2 className="dim">Ocultas</h2>
          <p className="dim" style={{ fontSize: 12.5 }}>
            Siguen existiendo y conservan sus notas fijadas; solo no aparecen en la barra lateral.
          </p>
          {hidden.map((g) => (
            <section key={g.id} id={encodeURIComponent(g.label)} style={{ opacity: 0.75 }}>
              <h2>{g.label} <span className="dim">({g.total})</span></h2>
              <ul style={{ columns: 2, columnGap: 28 }}>
                {g.items.map((i) => (
                  <li key={i.id}><Link href={`/note/${encodeURIComponent(i.id)}`}>{i.title}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </article>
  );
}
