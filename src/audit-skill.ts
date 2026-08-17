import type { Architecture } from "./architecture.ts";
import { writeSkill, localNote, type SkillWrite } from "./skills.ts";
import type { Locale } from "./locales.mjs";

/**
 * La skill que audita el vault.
 *
 * Sale de `/wiki-health`, una skill escrita a mano para UN vault concreto: sus
 * rutas, sus dos bundles, su convención `aios://`, y frases como «~73 notas
 * están así y es correcto». Todo eso era cierto ahí y falso en cualquier otro
 * vault, así que aquí no se copia: se deriva de `architecture.json`, igual que
 * la skill de ingesta.
 *
 * Lo que SÍ se hereda es lo único que no se puede generar: el juicio. La
 * observación que la hacía valer más que el linter es que **la mayoría de los
 * hallazgos no son errores**, y que reportarlos todos por igual entrena a
 * ignorar la lista entera. Esa parte es prosa fija a propósito.
 *
 * ## Dos documentos, no una tabla de claves
 *
 * A diferencia de la interfaz, aquí cada idioma es una función entera. Una skill
 * es un DOCUMENTO —argumenta, encadena, tiene ritmo— y trocearlo en cincuenta
 * claves produciría una traducción que compila y no se deja leer: las tablas de
 * markdown, las listas anidadas y las condicionales de bundle no sobreviven al
 * troceo. El precio es que un cambio de fondo hay que hacerlo dos veces, y se
 * paga a gusto: este archivo cambia cuando cambia el CRITERIO de auditoría, que
 * es raro, no cuando cambia la interfaz.
 */

function auditSkillEs(arch: Architecture, port: number): string {
  const shared = arch.bundles.filter((b) => b.shared);
  const multi = arch.bundles.length > 1;

  return `---
name: audit
description: Audita la salud del vault y propone arreglos. Corre el linter contra el formato, separa lo que está roto de lo que está vacío por diseño, y sugiere qué artículos falta escribir según la estructura del grafo. No toca nada sin confirmación.
---

# Auditar el vault

Arquitectura de este vault: **${arch.name}** — ${arch.description}

Dos trabajos distintos, en este orden:

1. **Integridad** — ¿algo se rompió desde la última revisión?
2. **Crecimiento** — ¿qué artículo falta escribir?

El linter ya existe. Lo que aportas tú es el juicio: **la mayoría de los
hallazgos no son errores**, y reportarlos todos por igual entrena a quien lee a
ignorar la lista entera.

## Cuándo

- Cada semana, o después de una sesión grande de edición.
- Siempre después de renombrar, mover o borrar archivos en lote.
- Antes de compartir el vault con alguien más.

## Paso 1 — Pedir el reporte

La app publica el diagnóstico en JSON mientras está abierta:

\`\`\`bash
curl -s http://localhost:${port}/api/health
\`\`\`

Trae \`stats\` (notas, enlaces, rotos, aislados), \`counts\` (cuántos hallazgos de
cada tipo), \`issues\` (la lista completa, cada uno con \`kind\` · \`note\` ·
\`detail\`), \`candidates\` (los mejores artículos que faltan, con
\`candidatesTotal\` diciendo cuántos hay en total — \`?full=1\` los trae todos) y
\`orphans\` (notas sin enlaces entrantes).

Léelo entero. **No lo cortes con \`head\`**: partir el JSON a la mitad lo vuelve
ilegible y te deja adivinando lo que falta. Si pesa, empieza por \`counts\` para
saber qué buscar dentro de \`issues\`.

Si no responde, la app está cerrada: pídele a quien te lanzó que la abra, o
audita leyendo el vault a mano. **No inventes un diagnóstico.** Un reporte de
salud equivocado es peor que no tenerlo — se actúa sobre él.

## Paso 2 — Clasificar antes de reportar

\`issues\` viene como lista plana. **Divídela en tres cubetas.**

### Roto — hay que arreglarlo

| \`kind\` | Qué significa |
|---|---|
| \`broken-link\` | Un enlace no resuelve. Casi siempre un archivo que se movió. |
| \`missing-type\` · \`invalid-type\` | Fuera del vocabulario de \`CLAUDE.md\`. |
| \`missing-title\` · \`missing-author\` | Campos obligatorios ausentes. |
| \`created-after-updated\` | Fecha imposible: alguien la escribió mal. |
| \`non-slug-filename\` | Rompe URLs y enlaces. |
| \`source-without-resource\` | Una nota \`type: source\` que no apunta a su fuente no sirve de nada. |
| \`malformed-provenance\` | Marcadores \`<!-- ai -->\` desbalanceados. Ojo: los que están dentro de bloques de código son documentación, no atribución. |

### Por diseño — NO reportarlo como problema

| \`kind\` | Por qué está bien |
|---|---|
| \`no-created\` | La regla es dejarlo vacío antes que inventarlo. En un vault con material importado son cientos de notas y todas correctas. Dilo como **un** conteo, no como una lista. |
| \`mixed-without-markers\` | Legítimo cuando la mezcla se declaró a nivel de archivo. |

### Señal, no error — traerlo a la conversación

| Hallazgo | Qué preguntar |
|---|---|
| \`stale-active\` | ¿Sigue activo o ya se archivó en la práctica? Una nota de referencia sin tocar 40 días no dice lo mismo que un proyecto vivo. |
| \`orphans\` | ¿Falta enlazarlas, o son notas que nunca necesitan entradas — diario, plantillas, notas compañeras de un PDF? |

## Paso 3 — Proponer los arreglos, no aplicarlos

Presenta lo roto **agrupado por causa, no por archivo**. Cinco enlaces rotos por
una misma carpeta que se movió son **un** problema, no cinco.

Para cada grupo: qué pasó, cuántos archivos afecta, y el arreglo que propones.
**Espera confirmación.** Los arreglos en lote sobre un vault son exactamente
donde se pierde información.

Reglas al arreglar:

- **Nunca inventes \`created:\`.** Vacío es la respuesta correcta. El \`mtime\` del
  sistema dice cuándo se copió el archivo, no cuándo se escribió.
- **Renombrar a slug**: primero extrae al frontmatter cualquier fecha que venga
  en el nombre, después renombra. Nunca al revés — si no, la fecha se pierde.
- **Borrar contra archivar**: si la nota tiene enlaces entrantes, \`status:
  archived\` conserva el grafo y borrarla lo rompe. Propón archivar por defecto.
- **No reescribas el contenido de una nota** para arreglar metadatos. El texto es
  de quien lo escribió, aunque esté mal redactado.
- **Marca lo tuyo**: todo lo que escribas va envuelto en \`<!-- ai -->\` …
  \`<!-- /ai -->\`, y la nota pasa a \`author: mixed\` si ya tenía contenido humano.
${multi ? `- **Enlaces que cruzan de un bundle a otro** no pueden ser rutas relativas que
  se escapen de su raíz. Los bundles de este vault: ${arch.bundles.map((b) => `\`${b.id}\``).join(", ")}.
` : ""}${shared.length ? `- ⚠ **${shared.map((b) => `\`${b.id}\``).join(", ")} ${shared.length > 1 ? "son bundles compartidos" : "es un bundle compartido"}**: lo que
  cambies ahí se sincroniza con las demás personas que lo editen. Dilo antes de
  tocarlo y confirma aparte.
` : ""}
## Paso 4 — Qué falta escribir

\`candidates\` propone desde la estructura del grafo, no desde el contenido:

- **\`tag-cluster\`** — varias notas comparten etiqueta y ninguna las agrupa.
  Falta un artículo que las conecte.
- **\`co-cited\`** — dos notas que se citan juntas todo el tiempo pero no se
  enlazan entre sí. Suele haber un concepto en medio que nadie escribió.
- **\`orphan-cluster\`** — notas aisladas del mismo tema: algo que nadie ha
  indexado todavía.

**Filtra antes de sugerir.** Un candidato que no puedes justificar en una frase
es ruido. Prioriza los que cruzan temas — ahí aparecen las ideas que no se ven
leyendo una sola nota.

Si aceptan uno, el artículo **sintetiza y cita a sus fuentes, no las
reemplaza**: nace con \`author: agent\`, y cada nota fuente recibe un enlace de
vuelta envuelto en marcadores de procedencia.

## Paso 5 — Cerrar

Reporta en este orden:

1. Una línea de estado: notas, enlaces, rotos, aislados — y el delta contra la
   corrida anterior si lo sabes.
2. Lo roto, agrupado por causa, con el arreglo que propones.
3. Lo que es señal: proyectos estancados, huérfanos que sí importan.
4. Candidatos a artículo, **máximo tres**, cada uno con su porqué.

No cierres con «todo bien» si hay ochenta hallazgos por diseño. Di el número y
por qué no son problemas.

## Reglas que no se negocian

1. **Clasificar antes de reportar.** Una lista plana de ochenta hallazgos no es
   un reporte, es ruido.
2. **Confirmar antes de escribir.** Sobre todo en lote${shared.length ? ", y sobre todo en un bundle compartido" : ""}.
3. **Verificar después de arreglar.** Vuelve a pedir \`/api/health\` y confirma
   que los rotos bajaron. Un arreglo sin verificar no está hecho.
4. **No reindexes a mano.** La app reconstruye su índice sola a los pocos
   segundos de cualquier cambio en disco.
${localNote("audit", "es")}`;
}



function auditSkillEn(arch: Architecture, port: number): string {
  const shared = arch.bundles.filter((b) => b.shared);
  const multi = arch.bundles.length > 1;

  return `---
name: audit
description: Audits the vault's health and proposes fixes. Runs the linter against the format, separates what is broken from what is empty by design, and suggests which articles are missing based on the graph's structure. Touches nothing without confirmation.
---

# Audit the vault

This vault's architecture: **${arch.name}** — ${arch.description}

Two different jobs, in this order:

1. **Integrity** — did anything break since the last review?
2. **Growth** — which article is missing?

The linter already exists. What you add is judgement: **most findings are not
errors**, and reporting them all alike trains the reader to ignore the whole
list.

## When

- Every week, or after a big editing session.
- Always after renaming, moving or deleting files in bulk.
- Before sharing the vault with someone else.

## Step 1 — Ask for the report

The app publishes the diagnosis as JSON while it's open:

\`\`\`bash
curl -s http://localhost:${port}/api/health
\`\`\`

It carries \`stats\` (notes, links, broken, isolated), \`counts\` (how many
findings of each kind), \`issues\` (the full list, each with \`kind\` · \`note\` ·
\`detail\`), \`candidates\` (the best missing articles, with \`candidatesTotal\`
saying how many there are in total — \`?full=1\` brings them all) and \`orphans\`
(notes with no inbound links).

Read it whole. **Don't cut it with \`head\`**: splitting the JSON in half makes
it unreadable and leaves you guessing at what's missing. If it's heavy, start
with \`counts\` to know what to look for inside \`issues\`.

If it doesn't answer, the app is closed: ask whoever launched you to open it, or
audit by reading the vault by hand. **Don't invent a diagnosis.** A wrong health
report is worse than none — people act on it.

## Step 2 — Classify before reporting

\`issues\` arrives as a flat list. **Split it into three buckets.**

### Broken — needs fixing

| \`kind\` | What it means |
|---|---|
| \`broken-link\` | A link doesn't resolve. Almost always a file that moved. |
| \`missing-type\` · \`invalid-type\` | Outside the vocabulary in \`CLAUDE.md\`. |
| \`missing-title\` · \`missing-author\` | Required fields absent. |
| \`created-after-updated\` | Impossible date: someone typed it wrong. |
| \`non-slug-filename\` | Breaks URLs and links. |
| \`source-without-resource\` | A \`type: source\` note that doesn't point at its source is useless. |
| \`malformed-provenance\` | Unbalanced \`<!-- ai -->\` markers. Careful: the ones inside code blocks are documentation, not attribution. |

### By design — do NOT report as a problem

| \`kind\` | Why it's fine |
|---|---|
| \`no-created\` | The rule is to leave it empty rather than invent it. In a vault with imported material that's hundreds of notes, all of them correct. Say it as **one** count, not as a list. |
| \`mixed-without-markers\` | Legitimate when the mix was declared at file level. |

### Signal, not error — bring it into the conversation

| Finding | What to ask |
|---|---|
| \`stale-active\` | Still active, or archived in practice? A reference note untouched for 40 days doesn't say the same thing as a live project. |
| \`orphans\` | Do they need linking, or are they notes that never need entrances — journal, templates, a PDF's companion note? |

## Step 3 — Propose the fixes, don't apply them

Present what's broken **grouped by cause, not by file**. Five broken links from
one folder that moved are **one** problem, not five.

For each group: what happened, how many files it affects, and the fix you
propose. **Wait for confirmation.** Bulk fixes on a vault are exactly where
information gets lost.

Rules when fixing:

- **Never invent \`created:\`.** Empty is the right answer. The filesystem's
  \`mtime\` says when the file was copied, not when it was written.
- **Renaming to slug**: first pull any date in the filename into the frontmatter,
  then rename. Never the other way round — otherwise the date is lost.
- **Deleting versus archiving**: if the note has inbound links, \`status:
  archived\` preserves the graph and deleting breaks it. Propose archiving by
  default.
- **Don't rewrite a note's content** to fix metadata. The text belongs to whoever
  wrote it, however badly phrased.
- **Mark what's yours**: everything you write is wrapped in \`<!-- ai -->\` …
  \`<!-- /ai -->\`, and the note moves to \`author: mixed\` if it already had human
  content.
${multi ? `- **Links crossing from one bundle to another** can't be relative paths that
  escape their root. This vault's bundles: ${arch.bundles.map((b) => `\`${b.id}\``).join(", ")}.
` : ""}${shared.length ? `- ⚠ **${shared.map((b) => `\`${b.id}\``).join(", ")} ${shared.length > 1 ? "are shared bundles" : "is a shared bundle"}**: whatever you
  change there syncs to everyone else editing it. Say so before touching it and
  confirm separately.
` : ""}
## Step 4 — What's missing

\`candidates\` proposes from the graph's structure, not from the content:

- **\`tag-cluster\`** — several notes share a tag and none groups them. An article
  connecting them is missing.
- **\`co-cited\`** — two notes cited together all the time but not linked to each
  other. There's usually a concept in between that nobody wrote.
- **\`orphan-cluster\`** — isolated notes on the same subject: something nobody has
  indexed yet.

**Filter before suggesting.** A candidate you can't justify in one sentence is
noise. Prioritise the ones that cross subjects — that's where the ideas live
that you can't see reading a single note.

If one is accepted, the article **synthesises and cites its sources, it doesn't
replace them**: it's born with \`author: agent\`, and each source note gets a link
back wrapped in provenance markers.

## Step 5 — Close

Report in this order:

1. One status line: notes, links, broken, isolated — and the delta against the
   previous run if you know it.
2. What's broken, grouped by cause, with the fix you propose.
3. What is signal: stalled projects, orphans that actually matter.
4. Article candidates, **three at most**, each with its reason.

Don't close with "all good" if there are eighty findings by design. Say the
number and why they aren't problems.

## Non-negotiable rules

1. **Classify before reporting.** A flat list of eighty findings isn't a report,
   it's noise.
2. **Confirm before writing.** Above all in bulk${shared.length ? ", and above all in a shared bundle" : ""}.
3. **Verify after fixing.** Ask \`/api/health\` again and confirm the broken count
   went down. An unverified fix isn't done.
4. **Don't reindex by hand.** The app rebuilds its index on its own within
   seconds of any change on disk.
${localNote("audit", "en")}`;
}

/**
 * La skill, en el idioma del vault.
 *
 * Se resuelve al escribirla y nunca se retraduce: es contenido del vault desde
 * que se escribe, y una skill que cambia de idioma bajo los pies de quien ya la
 * editó sería peor que una en el idioma equivocado.
 */
export function auditSkill(arch: Architecture, port: number, locale: Locale = "en"): string {
  return locale === "es" ? auditSkillEs(arch, port) : auditSkillEn(arch, port);
}

export function writeAuditSkill(
  vault: string,
  arch: Architecture,
  port = 4321,
  locale: Locale = "en",
): SkillWrite {
  return writeSkill(vault, "audit", auditSkill(arch, port, locale));
}
