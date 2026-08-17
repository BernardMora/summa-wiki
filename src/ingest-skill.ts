import { execFile } from "node:child_process";
import type { Architecture } from "./architecture.ts";
import { writeSkill, localNote, type SkillWrite } from "./skills.ts";
import type { Locale } from "./locales.mjs";

/**
 * La skill que corre el agente para repartir lo ingerido.
 *
 * Se escribe **dentro del vault** —ver `src/skills.ts` para dónde exactamente y
 * por qué ahí— y no se manda como prompt de un solo tiro. Tres razones, en
 * orden de peso:
 *
 * 1. Sirve otra vez. La ingesta no es un evento único: dentro de un mes habrá
 *    otra carpeta que meter, y entonces basta con `/vault-ingest`.
 * 2. Se puede ajustar. Si el reparto sale torcido, el criterio se corrige en un
 *    archivo que el usuario lee, en vez de en el código de la app.
 * 3. Viaja con el vault, igual que la arquitectura y las categorías.
 *
 * Se regenera en cada ingesta porque incorpora las reglas de la arquitectura
 * vigente: si el usuario editó `architecture.json`, la skill tiene que decir lo
 * que dice ese archivo hoy, no lo que decía el día que se creó el vault. Ese
 * mismo hecho es lo que hace que la razón 2 necesite `local.md`: lo generado se
 * pisa, lo propio no.
 */

function ingestSkillEs(arch: Architecture, ledgerRel: string): string {
  const rules = arch.routing
    .map((r) => `| ${r.when} | \`${r.to}\` |`)
    .join("\n");
  const folders = arch.folders
    .map((f) => `- \`${f.path}\` — ${f.purpose.replace(/\*\*/g, "")}`)
    .join("\n");

  return `---
name: vault-ingest
description: Reparte lo que acaba de entrar a la bandeja del vault en la estructura correcta, normalizando el frontmatter. Úsala después de una ingesta, o cuando la bandeja se acumule.
---

# Repartir la bandeja

Arquitectura de este vault: **${arch.name}** — ${arch.description}

El ledger de la última ingesta está en \`${ledgerRel}\`: dice qué archivo salió
de dónde. **Léelo primero**; es la única fuente de qué entró y de dónde venía, y
la ruta de origen suele ser la mejor pista sobre qué es una nota.

## Qué hacer, en este orden

1. **Lee el ledger** y agrupa lo copiado por carpeta de origen. Archivos que
   venían juntos casi siempre van juntos.
2. **Lee cada nota antes de moverla.** El nombre del archivo miente a menudo;
   \`notas.md\` puede ser cualquier cosa. Sin leerla no hay decisión, hay
   adivinanza.
3. **Normaliza el frontmatter** según el formato de \`CLAUDE.md\`.
4. **Mueve** el archivo a su destino y renómbralo a slug si hace falta.
5. **No reindexes.** La app reconstruye su índice sola a los pocos segundos de
   cualquier cambio en disco. (\`wiki index\` solo hace falta para el CLI, que
   vive en el proyecto de la app y no dentro del vault — desde aquí no lo
   alcanzas.)

## Adónde va cada cosa

| Cuando… | Va a |
|---|---|
${rules}

Las carpetas del vault:

${folders}

## Imágenes

Las imágenes no son notas: llegaron sin texto que las explique, y sueltas no
valen nada. Entran a la bandeja en la carpeta \`assets/\` de su carpeta de
origen, al lado de las notas que venían con ellas — esa vecindad es la mejor
pista de a qué texto pertenecen.

Para cada una, en este orden:

1. **Ábrela y mírala.** Sin ver la imagen no hay pie de foto posible: el nombre
   del archivo (\`IMG_4821.jpg\`) casi nunca dice qué se ve.
2. **Decide a qué nota ilustra.** La candidata natural es una nota que vino de la
   misma carpeta de origen y cuyo texto habla de lo que se ve. Si ninguna encaja,
   **la imagen se queda en la bandeja** — igual que una nota que no sabes dónde
   va. Inventar una nota para colgar una foto es peor que dejarla donde está.
3. **Muévela** a la carpeta \`assets/\` hermana de la nota destino, renombrada
   \`<slug-de-la-nota>-<n>.<ext>\` (\`reforma-agraria-1.jpg\`, \`-2\`, \`-3\`…).
4. **Insértala en el punto del texto que ilustra**, no amontonadas al final. Una
   imagen al pie de la nota no ilustra nada; es un archivo adjunto.

### Cómo se escribe

El pie de foto es el \`title\` de markdown de toda la vida, entre comillas dentro
del paréntesis:

\`\`\`markdown
![texto alternativo](assets/mi-nota-1.jpg "Lo que se ve en la foto")
\`\`\`

Con pie, la app la dibuja como **miniatura flotada a la derecha**, al estilo de
Wikipedia. Sin pie se queda en bloque, a todo lo ancho. Al principio del pie
—antes del texto— caben atajos entre corchetes que la app interpreta:

| Atajo | Qué hace | Cuándo usarlo |
|---|---|---|
| \`[izq]\` | miniatura flotada a la izquierda | alternar lados cuando hay varias seguidas en la misma sección |
| \`[ancho]\` | ancho completo, centrada, sin texto alrededor | diagramas, capturas de pantalla, mapas, cualquier cosa con texto dentro |
| \`[w=220]\` | ancho en píxeles (de 2 a 4 cifras) | fotos verticales, que a 300px se comen media pantalla de alto |

Se combinan y el orden da igual: \`"[izq][w=220] Mi pie"\`. Lo que no sea un atajo
conocido se lee como texto del pie, así que un corchete de más no rompe nada: se
ve.

Criterio por defecto, si nada sugiere otra cosa:

- Foto o retrato suelto → sin atajo (derecha, 300px, que es lo que se ve mejor
  junto a un párrafo).
- Diagrama, captura, mapa o documento fotografiado → \`[ancho]\`. Envolver texto
  alrededor de algo que hay que leer lo vuelve ilegible.
- Foto vertical → \`[w=220]\`.

Y sobre el texto:

- **El pie describe lo que se ve**, y añade lo que la foto no dice por sí sola
  (quién, dónde, cuándo) solo si lo sabes por el ledger o por la nota. No repitas
  el nombre del archivo.
- **El alt es para quien no ve la imagen**, no un adorno: descríbela en pocas
  palabras. Vacío solo si la imagen es puramente decorativa.
- **El pie lo escribiste tú**, así que el bloque va envuelto en
  \`<!-- ai -->\` … \`<!-- /ai -->\` como todo lo demás.
- **Si dudas del pie, ponlo corto.** Un pie que describe de más es una
  afirmación inventada dentro de una nota que no es tuya.

## Reglas que no se negocian

- **No borres nada de la bandeja sin haberlo movido.** Si no sabes qué es, se
  queda donde está: la bandeja es un destino válido, no un fallo.
- **No reescribas el contenido de una nota.** La ingesta normaliza metadatos y
  cambia rutas. El texto es de quien lo escribió, aunque esté mal redactado.
- **\`created\` no se inventa.** Si no se puede derivar del nombre del archivo o
  del propio texto, se deja vacío. El \`mtime\` del sistema dice cuándo se copió,
  no cuándo se escribió.
- **Marca lo tuyo.** Todo lo que escribas tú va envuelto en
  \`<!-- ai -->\` … \`<!-- /ai -->\`, y la nota pasa a \`author: mixed\` si ya tenía
  contenido humano. Una nota que solo tú tocaste va \`author: agent\`.
- **Las notas compañeras de PDF ya existen** y dicen que el documento no se ha
  leído. Si lo lees, actualiza el resumen y quita esa advertencia.
- **Trabaja por lotes de ~20 archivos** y ve informando. Si el reparto va mal,
  quien mira quiere poder pararte antes del archivo 300.

## Al terminar

Escribe un resumen corto: cuántos archivos moviste, a dónde, cuántos se
quedaron en la bandeja y por qué. Los que se quedaron son la lista de trabajo
pendiente, no un error.

Si te apartaste de la tabla de arriba en algún caso, dilo y explica por qué. Las
reglas son el criterio por defecto, no una camisa de fuerza: material que venía
junto y que la tabla separaría es el caso donde apartarse suele ser correcto.
${localNote("vault-ingest", "es")}`;
}

function ingestSkillEn(arch: Architecture, ledgerRel: string): string {
  const rules = arch.routing
    .map((r) => `| ${r.when} | \`${r.to}\` |`)
    .join("\n");
  const folders = arch.folders
    .map((f) => `- \`${f.path}\` — ${f.purpose.replace(/\*\*/g, "")}`)
    .join("\n");

  return `---
name: vault-ingest
description: Sorts whatever just landed in the vault's inbox into the right structure, normalising the frontmatter. Use it after an ingest, or when the inbox piles up.
---

# Sort the inbox

This vault's architecture: **${arch.name}** — ${arch.description}

The last ingest's ledger is at \`${ledgerRel}\`: it says which file came from
where. **Read it first**; it's the only record of what came in and where from,
and the source path is usually the best clue about what a note is.

## What to do, in this order

1. **Read the ledger** and group what was copied by source folder. Files that
   came in together almost always belong together.
2. **Read each note before moving it.** Filenames lie often; \`notes.md\` could be
   anything. Without reading it there is no decision, only a guess.
3. **Normalise the frontmatter** according to the format in \`CLAUDE.md\`.
4. **Move** the file to its destination and rename it to a slug if needed.
5. **Don't reindex.** The app rebuilds its index on its own within seconds of any
   change on disk. (\`wiki index\` is only needed for the CLI, which lives in the
   app's project and not inside the vault — you can't reach it from here.)

## Where each thing goes

| When… | Goes to |
|---|---|
${rules}

The vault's folders:

${folders}

## Images

Images are not notes: they arrived with no text explaining them, and on their own
they are worth nothing. They land in the inbox inside the \`assets/\` folder of
their source folder, next to the notes that came with them — that neighbourhood
is the best clue about which text they belong to.

For each one, in this order:

1. **Open it and look at it.** Without seeing the image there is no possible
   caption: the filename (\`IMG_4821.jpg\`) almost never says what's in it.
2. **Decide which note it illustrates.** The natural candidate is a note that came
   from the same source folder and whose text talks about what's shown. If none
   fits, **the image stays in the inbox** — same as a note you don't know where to
   put. Inventing a note to hang a photo on is worse than leaving it be.
3. **Move it** into the \`assets/\` folder beside the destination note, renamed
   \`<note-slug>-<n>.<ext>\` (\`land-reform-1.jpg\`, \`-2\`, \`-3\`…).
4. **Insert it at the point in the text it illustrates**, not piled up at the end.
   An image at the foot of a note illustrates nothing; it's an attachment.

### How it's written

The caption is markdown's own \`title\`, in quotes inside the parentheses:

\`\`\`markdown
![alt text](assets/my-note-1.jpg "What the photo shows")
\`\`\`

With a caption the app draws it as a **thumbnail floated to the right**, Wikipedia
style. Without one it stays a full-width block. At the START of the caption —
before the text — you can put shortcuts in brackets that the app interprets:

| Shortcut | What it does | When to use it |
|---|---|---|
| \`[left]\` | thumbnail floated left | alternating sides when several run down the same section |
| \`[wide]\` | full width, centred, no text wrapping | diagrams, screenshots, maps, anything with text inside it |
| \`[w=220]\` | width in pixels (2 to 4 digits) | portrait photos, which at 300px eat half the screen height |

They stack and the order doesn't matter: \`"[left][w=220] My caption"\`. Anything
that isn't a known shortcut is read as caption text, so a stray bracket breaks
nothing: it shows up.

Default judgement, when nothing suggests otherwise:

- Loose photo or portrait → no shortcut (right, 300px, which reads best beside a
  paragraph).
- Diagram, screenshot, map or photographed document → \`[wide]\`. Wrapping text
  around something meant to be read makes it illegible.
- Portrait-orientation photo → \`[w=220]\`.

And about the text:

- **The caption describes what is shown**, and adds what the photo can't say on
  its own (who, where, when) only if you know it from the ledger or the note.
  Don't repeat the filename.
- **Alt text is for whoever can't see the image**, not decoration: describe it in
  a few words. Empty only if the image is purely decorative.
- **You wrote the caption**, so the block goes wrapped in \`<!-- ai -->\` …
  \`<!-- /ai -->\` like everything else.
- **When in doubt, keep the caption short.** A caption that describes too much is
  an invented claim inside a note that isn't yours.

## Non-negotiable rules

- **Don't delete anything from the inbox without having moved it.** If you don't
  know what it is, it stays where it is: the inbox is a valid destination, not a
  failure.
- **Don't rewrite a note's content.** Ingest normalises metadata and changes
  paths. The text belongs to whoever wrote it, however badly phrased.
- **\`created\` is not invented.** If it can't be derived from the filename or the
  text itself, leave it empty. The filesystem's \`mtime\` says when it was copied,
  not when it was written.
- **Mark what's yours.** Everything you write goes wrapped in
  \`<!-- ai -->\` … \`<!-- /ai -->\`, and the note moves to \`author: mixed\` if it
  already had human content. A note only you touched goes \`author: agent\`.
- **PDF companion notes already exist** and say the document hasn't been read. If
  you read it, update the summary and remove that warning.
- **Work in batches of ~20 files** and report as you go. If the sorting is going
  wrong, whoever is watching wants to be able to stop you before file 300.

## When you finish

Write a short summary: how many files you moved, where to, how many stayed in
the inbox and why. The ones that stayed are the pending work list, not an error.

If you departed from the table above in any case, say so and explain why. The
rules are the default criteria, not a straitjacket: material that came in
together and that the table would separate is the case where departing is
usually right.
${localNote("vault-ingest", "en")}`;
}

/** La skill, en el idioma del vault. Ver la cabecera de `audit-skill.ts`. */
export function ingestSkill(arch: Architecture, ledgerRel: string, locale: Locale = "en"): string {
  return locale === "es" ? ingestSkillEs(arch, ledgerRel) : ingestSkillEn(arch, ledgerRel);
}

export function writeIngestSkill(
  vault: string,
  arch: Architecture,
  ledgerRel: string,
  locale: Locale = "en",
): SkillWrite {
  return writeSkill(vault, "vault-ingest", ingestSkill(arch, ledgerRel, locale));
}

/**
 * ¿Está `claude` instalado?
 *
 * Se pregunta a una **shell de login**, no al PATH de este proceso. Una app
 * lanzada desde el Dock recibe un PATH mínimo que no incluye ni `/opt/homebrew/bin`
 * ni `~/.local/bin` ni el shim de un gestor de versiones de Node — que es donde
 * vive `claude` en casi todas las instalaciones. Preguntando desde el proceso
 * daría "no instalado" a gente que lo tiene, y ese es el peor error posible
 * aquí: manda a instalar algo que ya está.
 *
 * En Windows la pregunta cambia entera, y durante un tiempo no lo hizo. La
 * versión anterior daba por hecho POSIX en dos sitios a la vez:
 *
 *   1. `process.env.SHELL ?? "/bin/zsh"` — SHELL no es una variable de Windows.
 *      No existe ni para el usuario ni para la máquina; solo la define Git Bash
 *      dentro de su propia sesión. Así que en desarrollo, arrancando el servidor
 *      desde Git Bash, esto funcionaba; en la app instalada, que se abre desde
 *      el menú de inicio sin SHELL, caía a `/bin/zsh` y fallaba siempre.
 *
 *   2. `out.startsWith("/")` — Git Bash devuelve `/c/Users/…/claude`, con
 *      pinta de ruta POSIX, y por eso el filtro dejaba pasar el resultado. Una
 *      ruta de Windows de verdad (`C:\…`) no empieza por barra: arreglar solo
 *      el punto 1 habría seguido devolviendo null, con el fallo ya escondido
 *      detrás de una shell correcta.
 *
 * De ahí que la comprobación de "ruta absoluta" dependa ahora de la plataforma
 * y no de un carácter. Es el mismo reparto por plataforma que ya hacía
 * `runInUserShell` en src/agents.ts.
 */
export function findClaude(): Promise<string | null> {
  const win = process.platform === "win32";
  const shell = win ? "powershell.exe" : (process.env.SHELL ?? "/bin/zsh");

  // `Get-Command …).Source` es el `command -v` de PowerShell: la ruta del
  // ejecutable, o nada. -NoProfile porque el perfil del usuario puede imprimir
  // banners que ensuciarían stdout, y -NonInteractive para que nada se quede
  // esperando en un prompt hasta agotar el timeout.
  const args = win
    ? ["-NoProfile", "-NonInteractive", "-Command",
       "(Get-Command claude -ErrorAction SilentlyContinue).Source"]
    : ["-lic", "command -v claude"];

  return new Promise((resolve) => {
    execFile(shell, args, { timeout: 8000 }, (err, stdout) => {
      const out = (stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
      const absolute = win ? /^[a-zA-Z]:[\\/]/.test(out) : out.startsWith("/");
      resolve(!err && absolute ? out : null);
    });
  });
}
