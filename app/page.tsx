import Link from "next/link";
import { getIndex } from "@/lib/server.ts";
import { identityBranches, CENTRE } from "@/lib/identity.ts";

export const dynamic = "force-dynamic";

const href = (id: string) => `/note/${encodeURIComponent(id)}`;

export default function MainPage() {
  const idx = getIndex();
  const s = idx.stats;
  const branches = identityBranches();
  const centre = idx.notes.find((n) => n.id === CENTRE);

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
    .slice(0, 7);

  return (
    <>
      <div className="welcome">
        <h1>Bienvenido a Berni&apos;s Wiki</h1>
        <p>la base de conocimiento personal del AIOS, organizada por preguntas.</p>
        <p className="counts">
          {s.notes} artículos · {s.words.toLocaleString()} palabras ·{" "}
          {s.internalLinks} enlaces internos · {s.brokenLinks} rotos
        </p>
      </div>

      {centre && (
        <section className="centrecard">
          <div>
            <h2><Link href={href(centre.id)}>¿Quién es Bernardo?</Link></h2>
            <p>
              Todo retroalimenta a este nodo, y este nodo alimenta de vuelta a cada uno
              de los otros. Es la entrada del wiki.
            </p>
          </div>
          <Link className="centrego" href={href(centre.id)}>Entrar →</Link>
        </section>
      )}

      <div className="cols">
        <div>
          <section className="panel blue">
            <h2>Las preguntas</h2>
            <div className="qgrid">
              {branches.map((b) => (
                <div className="qcard" key={b.hub}>
                  <h3><Link href={href(b.hub)}>{b.label}</Link></h3>
                  <p className="qblurb">{b.blurb}</p>
                  <p className="qmeta">
                    {b.count > 0
                      ? <>{b.count} {b.count === 1 ? "artículo" : "artículos"} · {b.words.toLocaleString()} palabras</>
                      : <em>sin artículos propios todavía</em>}
                    {b.lives && <> · <code>{b.lives}</code></>}
                  </p>
                  {b.sample.length > 0 && (
                    <ul className="qlist">
                      {b.sample.map((n) => (
                        <li key={n.id}><Link href={href(n.id)}>{n.title}</Link></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel grey">
            <h2>Cómo está organizado</h2>
            <div>
              <p>
                El vault se organiza por <strong>preguntas</strong>, no por categorías
                temáticas. Las categorías se pudren; las preguntas no: <em>¿qué sabe
                Bernardo?</em> seguirá siendo la pregunta correcta en diez años.
              </p>
              <table className="structtable">
                <tbody>
                  <tr><td><code>00-Bernardo/</code></td><td>quién es — los hubs, la biografía y las personas</td></tr>
                  <tr><td><code>01-Hacer/</code></td><td>qué hace — Veridia, contenido, finanzas, salud</td></tr>
                  <tr><td><code>02-Saber/</code></td><td>qué sabe — el árbol de conocimiento</td></tr>
                  <tr><td><code>03-Journal/</code></td><td>el histórico — <strong>nunca se reescribe</strong></td></tr>
                  <tr><td><code>04-Sistema/</code></td><td>la maquinaria del AIOS</td></tr>
                </tbody>
              </table>
              <p className="dim" style={{ margin: "10px 0 0" }}>
                Dos reglas lo sostienen: las notas personales son historial estático y no
                se reescriben nunca; los artículos de síntesis son archivos nuevos
                que <strong>citan</strong> esas notas — si hay contradicción, manda la fuente.
              </p>
            </div>
          </section>
        </div>

        <div>
          <section className="panel green">
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

          <section className="panel blue">
            <h2>Explorar</h2>
            <div>
              <ul>
                <li><Link href="/graph">Grafo</Link> — el mapa de enlaces; el hover muestra el título, ⌘clic lo abre en pestaña</li>
                <li><Link href="/random">Artículo aleatorio</Link></li>
                <li><Link href="/categories">Categorías</Link> — agrupaciones propias, aparte de la estructura</li>
                <li><Link href="/health">Salud del wiki</Link> — validación contra la spec</li>
              </ul>
              <p className="dim" style={{ margin: "8px 0 0" }}>
                <kbd>⌘O</kbd> abre el buscador rápido desde cualquier parte.
              </p>
            </div>
          </section>

          <section className="panel grey">
            <h2>Procedencia</h2>
            <div>
              <p className="dim" style={{ margin: 0 }}>
                {s.byAuthor.human ?? 0} notas escritas por Bernardo ·{" "}
                {s.byAuthor.agent ?? 0} por el agente ·{" "}
                {s.byAuthor.mixed ?? 0} mixtas.
              </p>
              <p style={{ margin: "8px 0 0" }}>
                Lo que escribe el agente va envuelto en marcadores dentro del propio
                archivo. El texto sin marcar se lee como escrito por Bernardo.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
