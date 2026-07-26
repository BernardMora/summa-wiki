import Link from "next/link";
import { navGroups } from "@/lib/nav.ts";

export const dynamic = "force-dynamic";

export default function Categories() {
  const groups = navGroups(10_000);
  return (
    <article>
      <h1>Todas las categorías</h1>
      <p className="infoline"><span>{groups.length} categorías</span></p>
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
    </article>
  );
}
