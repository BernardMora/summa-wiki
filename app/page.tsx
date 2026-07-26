import Link from "next/link";
import { getIndex } from "@/lib/server.ts";
import { navGroups } from "@/lib/nav.ts";

export const dynamic = "force-dynamic";

const href = (id: string) => `/note/${encodeURIComponent(id)}`;

export default function MainPage() {
  const idx = getIndex();
  const s = idx.stats;
  const groups = navGroups(4);

  // Templates carry placeholder frontmatter ("updated: YYYY-MM-DD"), which
  // sorts above every real date. They are scaffolding, not articles.
  const isReal = (n: { path: string; slug: string; updated: string; type: string }) =>
    n.slug !== "_index" &&
    n.type !== "system" &&
    !n.path.includes("/Templates/") &&
    /^\d{4}-\d{2}-\d{2}$/.test(n.updated);

  const recent = [...idx.notes]
    .filter(isReal)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 6);

  // Featured: the best-connected substantial article, so the portal always
  // opens on something worth reading rather than a stub.
  const featured = [...idx.notes]
    .filter((n) => n.words > 250 && isReal(n) && n.type !== "journal")
    .sort((a, b) => b.backlinks.length - a.backlinks.length || b.words - a.words)[0];

  return (
    <>
      <div className="welcome">
        <h1>Bienvenido a Berni&apos;s Wiki</h1>
        <p>la base de conocimiento personal compilada del AIOS.</p>
        <p className="counts">
          {s.notes} artículos en {groups.length} categorías · {s.words.toLocaleString()} palabras ·{" "}
          {s.internalLinks} enlaces internos
        </p>
      </div>

      <div className="cols">
        <div>
          {featured && (
            <section className="panel blue">
              <h2>Artículo destacado</h2>
              <div>
                <div className="featured">
                  <div className="thumb">{featured.title.slice(0, 1).toUpperCase()}</div>
                  <p style={{ margin: 0 }}>
                    <Link href={href(featured.id)}><strong>{featured.title}</strong></Link>{" "}
                    <span className="dim">({featured.type})</span> — {featured.excerpt.slice(0, 230)}…
                  </p>
                </div>
                <p style={{ margin: "10px 0 0" }}>
                  <Link href={href(featured.id)}>Leer más →</Link>
                </p>
              </div>
            </section>
          )}

          <section className="panel green">
            <h2>Explorar por categoría</h2>
            <div>
              {groups.map((g) => (
                <div className="catgroup" key={g.label}>
                  <h3>{g.label} <span className="dim">({g.total})</span></h3>
                  <ul>
                    {g.items.map((i) => (
                      <li key={i.id}><Link href={href(i.id)}>{i.title}</Link></li>
                    ))}
                  </ul>
                </div>
              ))}
              <p style={{ margin: "6px 0 0" }}><Link href="/categories">Ver todas las categorías →</Link></p>
            </div>
          </section>
        </div>

        <div>
          <section className="panel blue">
            <h2>Actualizado recientemente</h2>
            <div>
              <ul>
                {recent.map((n) => (
                  <li key={n.id}>
                    <Link href={href(n.id)}>{n.title}</Link>{" "}
                    <span className="dim">({n.updated})</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="panel grey">
            <h2>Acerca de</h2>
            <div>
              <p>
                Berni&apos;s Wiki es la base de conocimiento personal del AIOS, compilada
                de notas, journal y del Drive de Veridia. Los artículos representan
                conocimiento y patrones, no eventos.
              </p>
              <p className="dim" style={{ margin: 0 }}>
                {s.byAuthor.human ?? 0} escritos por Bernardo · {s.byAuthor.agent ?? 0} por el
                agente · {s.byAuthor.mixed ?? 0} mixtos · {s.brokenLinks} enlaces rotos
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
