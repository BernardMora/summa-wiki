import Link from "next/link";
import { getIndex } from "@/lib/server.ts";
import { health } from "@/src/search.ts";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

/** Hallazgos que NO son problemas, y por qué. Claves: lo pinta un servidor. */
const EXPECTED = {
  "no-created": "health.noCreated",
  "stale-active": "health.staleActive",
} as const;

export default function Health() {
  const t = getT();
  const idx = getIndex();
  const issues = health(idx);
  const by = new Map<string, typeof issues>();
  for (const i of issues) { if (!by.has(i.kind)) by.set(i.kind, []); by.get(i.kind)!.push(i); }

  return (
    <article>
      <h1>{t("health.title")}</h1>
      <p className="infoline">
        <span>{t("health.findings", { n: issues.length })}</span><span>{t("health.notes", { n: idx.notes.length })}</span>
        <span>{t("health.brokenLinks", { n: idx.stats.brokenLinks })}</span>
      </p>
      {[...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([kind, list]) => (
        <section key={kind}>
          <h2>{kind} <span className="dim">({list.length})</span></h2>
          {kind in EXPECTED && <p className="dim">{t(EXPECTED[kind as keyof typeof EXPECTED])}</p>}
          <ul>
            {list.slice(0, 40).map((i, n) => (
              <li key={n}>
                <Link href={`/note/${encodeURIComponent(i.note)}`}>{i.note}</Link>
                {i.detail && <span className="dim"> — {i.detail}</span>}
              </li>
            ))}
            {list.length > 40 && <li className="dim">{t("health.more", { n: list.length - 40 })}</li>}
          </ul>
        </section>
      ))}
    </article>
  );
}
