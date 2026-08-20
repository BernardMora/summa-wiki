import Link from "next/link";
import { redirect } from "next/navigation";
import { getIndex } from "@/lib/server.ts";
import { identityBranches, CENTRE } from "@/lib/identity.ts";
import { navGroups } from "@/lib/nav.ts";
import { readConfig, HAS_VAULT, VAULT, VAULT_SOURCE, vaultExists, ARCH } from "@/src/config.ts";
import { readSettings } from "@/src/appdata.mjs";
import { splitBold } from "@/src/architecture.ts";
import VaultPicker from "@/components/VaultPicker";
import { getT, getLocale } from "@/lib/i18n.server.ts";
import NoteWorkspaceWarmup from "@/components/NoteWorkspaceWarmup.tsx";

export const dynamic = "force-dynamic";

const href = (id: string) => `/note/${encodeURIComponent(id)}`;

/** Pinta el `**...**` que admiten los textos de la arquitectura. */
const bold = (text: string) =>
  splitBold(text).map((c, i) => (c.bold ? <strong key={i}>{c.text}</strong> : c.text));

/**
 * Los tres estados en los que no hay portada que pintar.
 *
 * Es el sitio de la Fase 13 (el asistente que crea un vault y elige
 * arquitectura). Por ahora hace lo mínimo honesto: decir qué falta y dejar
 * elegir la carpeta.
 *
 * El tercer estado —configurado, en disco, y sin una sola nota— se descubrió
 * probando contra una carpeta vacía: la portada se pintaba entera, con los
 * seis hubs y las 23 categorías, y cero artículos en todas. Eso no se lee como
 * "vault vacío", se lee como app rota, y quien lo ve no tiene forma de saber
 * que solo le falta meter notas o apuntar a otra carpeta.
 */
function NoVault({ state }: { state: "missing" | "empty" }) {
  const t = getT();
  const TITLE = {
    missing: "home.vaultMissing",
    empty: "home.vaultEmpty",
  } as const;

  return (
    <div className="welcome">
      <h1>{t(TITLE[state])}</h1>

      {state === "missing" && (
        <p>{t("home.vaultMissingBody", { vault: VAULT })}</p>
      )}

      {state === "empty" && (
        <>
          <p>{t("home.vaultEmptyBody", { vault: VAULT })}</p>
          {/* La salida natural desde aquí es montarle una estructura, no elegir
              otra carpeta. Es adonde llega quien apuntó la app a una carpeta
              vacía esperando que se la organizara. */}
          <p><a href="/setup?new=1">{t("home.giveStructure")}</a></p>
        </>
      )}

      {VAULT_SOURCE === "env" && (
        <p className="counts">{t("home.envPathNote", { var: "WIKI_VAULT" })}</p>
      )}

      <VaultPicker current={HAS_VAULT ? VAULT : null} />
    </div>
  );
}

export default function MainPage() {
  const t = getT();
  const locale = getLocale();
  // Sin vault configurado no hay portada que degradar: se va al asistente,
  // que es una pantalla propia y no una portada vacía con un botón.
  const machine = readSettings();
  if (!HAS_VAULT && machine.onboarding.status !== "completed") redirect("/onboarding");
  if (!HAS_VAULT) redirect("/setup");
  if (!vaultExists()) return <NoVault state="missing" />;

  const idx = getIndex();
  if (idx.stats.notes === 0) return <NoVault state="empty" />;

  const s = idx.stats;
  const cfg = readConfig();
  const branches = identityBranches();
  const centre = idx.notes.find((n) => n.id === CENTRE);
  // Qué artículos del núcleo existen de verdad. Una arquitectura declara los
  // que DEBERÍA haber; el índice dice cuáles hay.
  const ids = new Set(idx.notes.map((n) => n.id));
  const hubExists = new Set(branches.map((b) => b.hub).filter((h) => ids.has(h)));
  const coreCount = hubExists.size + (centre ? 1 : 0);

  const all = navGroups(10_000);
  const groups = all.filter((g) => !g.hidden);
  const hidden = all.filter((g) => g.hidden);
  const filed = new Set(
    all.flatMap((g) => (g.id === "__uncategorised" ? [] : g.items.map((i) => i.id))),
  ).size;

  return (
    <>
      <NoteWorkspaceWarmup />
      <div className="welcome">
        <h1>{t("home.welcome", { name: cfg.name })}</h1>
        {/* La descripción de la arquitectura, no la bajada del vault: esa ya
            se pinta en el masthead y repetirla dos pulgadas más abajo no dice
            nada nuevo. Antes era una frase fija sobre el AIOS, que no describe
            el wiki de nadie más. */}
        <p>{ARCH.description}</p>
        <p className="counts">{t("home.counts", {
          notes: s.notes,
          words: s.words.toLocaleString(locale),
          links: s.internalLinks,
          broken: s.brokenLinks,
        })}</p>
      </div>

      {/* Núcleo. Va arriba y va en otro color porque no es una categoría más:
          son los artículos contra los que se lee todo lo demás.

          Se omite entero si NINGUNO de sus artículos existe: una arquitectura
          recién puesta sobre un vault que todavía no la cumple pintaba las
          tarjetas igual, enlazando a notas inexistentes. Prometía una
          estructura que no está. */}
      {coreCount > 0 && (
      <section className="core">
        <div className="corehead">
          <h2>{t("home.core")}</h2>
          <p>{t("home.coreBlurb", { n: ARCH.hubs.length + 1 })}</p>
        </div>

        {centre && (
          <div className="centrecard">
            <div>
              <h2><Link href={href(centre.id)}>{centre.title}</Link></h2>
              <p>
                {t("home.centreBlurb")}
              </p>
            </div>
            <Link className="centrego" href={href(centre.id)}>{t("home.enter")}</Link>
          </div>
        )}

        <div className="qgrid">
          {branches.filter((b) => hubExists.has(b.hub)).map((b) => (
            <div className="qcard" key={b.hub}>
              <h3><Link href={href(b.hub)}>{b.label}</Link></h3>
              <p className="qblurb">{b.blurb}</p>
              <p className="qmeta">
                {b.count > 0
                  ? t("home.cardCounts", {
                      n: b.count,
                      noun: t(b.count === 1 ? "home.articleOne" : "home.articleMany"),
                      words: b.words.toLocaleString(locale),
                    })
                  : <em>{t("home.noOwnArticles")}</em>}
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
      )}

      {/* Índice por categoría. Vive aquí, en la portada, y no en una página
          aparte: es lo que se viene a buscar. */}
      <section className="catindex" id="categorias">
        <div className="catindexhead">
          <h2>{t("home.categories")}</h2>
          <p>{t("home.categoriesBlurb", {
            n: groups.filter((g) => g.id !== "__uncategorised").length,
            filed,
          })}</p>
        </div>

        <nav className="catjump">
          {groups.map((g) => (
            <a key={g.id} href={`#cat-${g.id}`}>{g.label} <span className="catcount">{g.total}</span></a>
          ))}
        </nav>

        {groups.map((g) => (
          <section className="catblock" key={g.id} id={`cat-${g.id}`}>
            <h3>{g.label} <span className="catcount">{g.total}</span></h3>
            {g.blurb && <p className="catblurb">{g.blurb}</p>}
            {g.items.length > 0 ? (
              <ul className="catlist">
                {g.items.map((i) => (
                  <li key={i.id}>
                    {i.pinned && <span className="pinmark" title={t("home.pinned")}>▪</span>}
                    <Link href={href(i.id)}>{i.title}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim" style={{ fontSize: 13, margin: 0 }}>
                {t("home.emptyCategory")}
              </p>
            )}
          </section>
        ))}

        {hidden.length > 0 && (
          <details className="cathiddenbox">
            <summary>{t("home.hidden", { n: hidden.length })}</summary>
            {hidden.map((g) => (
              <section className="catblock" key={g.id} id={`cat-${g.id}`}>
                <h3>{g.label} <span className="catcount">{g.total}</span></h3>
                <ul className="catlist">
                  {g.items.map((i) => (
                    <li key={i.id}><Link href={href(i.id)}>{i.title}</Link></li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
        )}
      </section>

      <div className="cols">
        <div>
          <section className="panel grey">
            <h2>{t("home.howOrganised")}</h2>
            <div>
              <p>{bold(ARCH.rationale)}</p>
              <table className="structtable">
                <tbody>
                  {ARCH.folders.map((f) => (
                    <tr key={f.path}>
                      <td><code>{f.path}</code></td>
                      <td>{bold(f.purpose)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dim" style={{ margin: "10px 0 0" }}>
                {bold(t("home.twoRules"))}
              </p>
            </div>
          </section>
        </div>

        <div>
          <section className="panel blue">
            <h2>{t("home.explore")}</h2>
            <div>
              <ul>
                <li><Link href={`/workspace?open=graph%3A&title=${encodeURIComponent(t("nav.graph"))}`}>{t("home.graph")}</Link> — {t("home.graphHint")}</li>
                <li><Link href="/random">{t("home.random")}</Link></li>
                <li><Link href="#categorias">{t("home.categories")}</Link> — {t("home.categoriesLink")}</li>
                <li><Link href="/health">{t("home.health")}</Link> — {t("home.healthHint")}</li>
              </ul>
              <p className="dim" style={{ margin: "8px 0 0" }}>
                <kbd>⌘O</kbd> {t("home.quickSwitcher")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
