import fs from "node:fs";
import path from "node:path";
import type { Architecture } from "./architecture.ts";
import { splitBold } from "./match.ts";
import { writeAuditSkill } from "./audit-skill.ts";
import { SKILLS_HOME, SKILL_ADAPTERS } from "./skills.ts";
import type { Locale } from "./locales.mjs";

/**
 * Crear un vault: escribir en disco la arquitectura que el usuario eligió.
 *
 * Todo lo que se escribe **se deriva del paquete**. No hay plantillas por
 * arquitectura ni prosa a la medida de ninguna: si las hubiera, agregar un
 * paquete costaría escribir seis artículos y cuatro `CLAUDE.md` a mano, y el
 * cuarto paquete nunca se agregaría. Un generador que lee el contrato hace que
 * el trabajo de una arquitectura nueva sea declararla.
 *
 * Nunca sobrescribe: si un archivo ya está, se salta y se reporta. Elegir por
 * error una carpeta con contenido no puede costarle a nadie su trabajo.
 *
 * ## El idioma
 *
 * Recibe el idioma aparte de la arquitectura aunque el paquete ya venga
 * resuelto, porque son dos cosas distintas: el paquete aporta los NOMBRES
 * (carpetas, hubs, categorías) y esta prosa es del generador — el router para
 * agentes, los encabezados de los artículos, las advertencias. Un vault en
 * inglés con carpetas inglesas y un `CLAUDE.md` en español sería peor que
 * cualquiera de los dos idiomas puros.
 *
 * Como todo lo demás, se aplica UNA vez y queda escrito. Estos archivos son
 * contenido del vault desde el instante en que se crean: la app no vuelve a
 * tocarlos aunque después se cambie el idioma de la interfaz.
 */

/**
 * La prosa del generador.
 *
 * Aparte de `lib/messages/` a propósito, y la diferencia importa: aquello es
 * INTERFAZ —se repinta entera cada vez que cambia el idioma— y esto es
 * CONTENIDO que se escribe al disco una sola vez y ya es del usuario. Mezclarlas
 * invitaría a "retraducir el vault" al cambiar de idioma, que es justo lo que
 * no debe pasar.
 */
const TEXT = {
  es: {
    // Las comillas y la conjunción cambian con el idioma y no son adorno: unas
    // comillas angulares en un documento inglés delatan que el texto se tradujo
    // a medias, que es exactamente la impresión que este archivo no puede dar —
    // es lo primero que lee un agente al abrir el vault.
    quoteOpen: "«",
    quoteClose: "»",
    and: "y",
    generatedBy: "Este artículo lo generó la app al crear {name}. Reescríbelo: es un hub,\n     no un índice — lo que vale es la prosa que conecta, no la lista.",
    whatLivesHere: "Qué vive aquí",
    materialIn: "Su material está en `{lives}`.",
    noMaterial: "Todavía sin material asociado.",
    whereToStart: "Por dónde entrar",
    nothingYet: "Aún nada. Conforme escribas, enlaza desde aquí los artículos que de verdad\ncontesten esta pregunta — en línea y dentro del texto, no como lista al pie.",
    theQuestions: "Las preguntas",
    noQuestions: "_Esta arquitectura no declara preguntas._",
    routerIntro: "Base de conocimiento en markdown, leída y escrita por Summa Wiki. Este archivo\nes el router: léelo primero.",
    infoArch: "Arquitectura de información",
    structure: "Estructura",
    folder: "Carpeta",
    whatFor: "Para qué",
    hubArticles: "Artículos hub",
    hubIntro: "Son artículos con prosa, no índices de carpeta. Una nota no se archiva bajo un\nhub: el hub enlaza a la nota desde su texto.",
    question: "Pregunta",
    article: "Artículo",
    hubLabel: "Artículos hub",
    noteFormat: "Formato de las notas",
    frontmatterIntro: "Frontmatter YAML en todo archivo `.md`:",
    fmTitle: "Nombre humano de la nota",
    fmCreatedNote: "vacío si no se puede derivar con certeza",
    rules: [
      "- **Enlaces markdown estándar**, nunca `[[wikilinks]]`. Rutas relativas.",
      "- **Nombres de archivo en slug**: minúsculas, sin acentos ni espacios. El nombre",
      "  humano vive en `title:`. Las notas diarias van en ISO (`2026-07-23.md`).",
      "- **Assets** en una carpeta hermana `assets/`. Las imágenes se escriben con\n  markdown estándar y el pie va en el `title`:\n  `![alt](assets/foo.webp \"[izq][w=220] Pie\")`. Con pie, la app la dibuja como\n  miniatura flotada a la derecha; los corchetes del principio la cambian de\n  lado (`[izq]`), la ponen a todo lo ancho (`[ancho]`) o le fijan el ancho\n  (`[w=N]`).",
      "- **Fuentes junto a sus notas.** Un PDF lleva una nota compañera con",
      "  `type: source` y `resource:` apuntando al archivo.",
      "- **`created` nunca se inventa.** Si no se puede derivar, se deja vacío.",
    ].join("\n"),
    provenanceTitle: "⚠ Procedencia — regla obligatoria para agentes",
    provenanceIntro: "Al editar cualquier nota, **envuelve tus propias adiciones en marcadores**:",
    provenanceSample: "Texto que escribiste tú, el agente.",
    provenanceRule: "El texto sin marcar se lee como escrito por la persona dueña del vault. Si no\nmarcas lo tuyo, la procedencia se corrompe en silencio. Actualiza también\n`author:` a `mixed` cuando metas contenido en una nota que era `human`.",
    skills: "Skills",
    skillsIntro: "Las skills de este vault viven en `{home}/<nombre>/SKILL.md` — la\nconvención neutral, para que las lean varios agentes y no solo uno.\n`{adapters}/` son enlaces a esa carpeta, no copias.",
    skill: "Skill",
    skillAudit: "Revisar la salud del vault: qué se rompió y qué falta escribir.",
    skillIngest: "Repartir lo que entró a la bandeja. Aparece tras la primera ingesta.",
    skillsRegen: "Las **regenera la app** cuando cambia la arquitectura. Para reglas propias que\nsobrevivan a eso, escribe `{home}/<nombre>/local.md`, que nunca se toca.",
    config: "Configuración",
    configBody: "`.summa/` guarda la configuración de la app: `architecture.json` (esta\nestructura, editable), `categories.json` y `config.json`. Las categorías son\n**reglas**, no listas: una nota entra por ruta, etiqueta o tipo, y puede estar\nen varias a la vez.",
  },
  en: {
    quoteOpen: "\u201c",
    quoteClose: "\u201d",
    and: "and",
    generatedBy: "The app generated this article when {name} was created. Rewrite it: it's a\n     hub, not an index — what matters is the prose that connects, not the list.",
    whatLivesHere: "What lives here",
    materialIn: "Its material is in `{lives}`.",
    noMaterial: "No material associated yet.",
    whereToStart: "Where to start",
    nothingYet: "Nothing yet. As you write, link from here to the articles that genuinely\nanswer this question — inline and inside the text, not as a list at the foot.",
    theQuestions: "The questions",
    noQuestions: "_This architecture declares no questions._",
    routerIntro: "Markdown knowledge base, read and written by Summa Wiki. This file is the\nrouter: read it first.",
    infoArch: "Information architecture",
    structure: "Structure",
    folder: "Folder",
    whatFor: "What for",
    hubArticles: "Hub articles",
    hubIntro: "These are articles with prose, not folder indexes. A note is not filed under a\nhub: the hub links to the note from its text.",
    question: "Question",
    article: "Article",
    hubLabel: "Hub articles",
    noteFormat: "Note format",
    frontmatterIntro: "YAML frontmatter in every `.md` file:",
    fmTitle: "Human name of the note",
    fmCreatedNote: "empty if it can't be derived with certainty",
    rules: [
      "- **Standard markdown links**, never `[[wikilinks]]`. Relative paths.",
      "- **Slug filenames**: lowercase, no accents, no spaces. The human name lives",
      "  in `title:`. Daily notes go in ISO (`2026-07-23.md`).",
      "- **Assets** in a sibling `assets/` folder. Images use standard markdown and the\n  caption goes in the `title`:\n  `![alt](assets/foo.webp \"[left][w=220] Caption\")`. With a caption the app\n  draws it as a thumbnail floated right; the leading brackets flip its side\n  (`[left]`), make it full width (`[wide]`) or set its width (`[w=N]`).",
      "- **Sources beside their notes.** A PDF carries a companion note with",
      "  `type: source` and `resource:` pointing at the file.",
      "- **`created` is never invented.** If it can't be derived, leave it empty.",
    ].join("\n"),
    provenanceTitle: "⚠ Provenance — mandatory rule for agents",
    provenanceIntro: "When editing any note, **wrap your own additions in markers**:",
    provenanceSample: "Text you wrote, the agent.",
    provenanceRule: "Unmarked text reads as written by the vault's owner. If you don't mark yours,\nprovenance is corrupted silently. Also update `author:` to `mixed` when you put\ncontent into a note that was `human`.",
    skills: "Skills",
    skillsIntro: "This vault's skills live in `{home}/<name>/SKILL.md` — the neutral\nconvention, so several agents can read them and not just one.\n`{adapters}/` are links to that folder, not copies.",
    skill: "Skill",
    skillAudit: "Check the vault's health: what broke and what's missing.",
    skillIngest: "Sort what landed in the inbox. Appears after the first ingest.",
    skillsRegen: "The **app regenerates these** when the architecture changes. For your own rules\nthat survive that, write `{home}/<name>/local.md`, which is never touched.",
    config: "Configuration",
    configBody: "`.summa/` holds the app's configuration: `architecture.json` (this structure,\neditable), `categories.json` and `config.json`. Categories are **rules**, not\nlists: a note enters by path, tag or type, and can be in several at once.",
  },
} as const;

/**
 * La tabla de un idioma. `ScaffoldText` y no `Text` porque `Text` es un tipo
 * global del DOM y el `lib: ["dom"]` del tsconfig lo tiene en alcance: la
 * colisión no da error de declaración, da un "no existe la propiedad" en cada
 * uso, que apunta a todas partes menos al nombre.
 */
type ScaffoldText = (typeof TEXT)[keyof typeof TEXT];

/** Interpola `{clave}`. Mismo contrato que `makeT`, sin el diccionario detrás. */
function fill(template: string, vars: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? vars[k] : whole));
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

/** Fecha local. `toISOString()` daría UTC y estamparía mañana desde Tijuana. */
function today(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

/** Quita el `**` de los textos del paquete, para donde no se puede renderizar. */
const plain = (s: string) => splitBold(s).map((c) => c.text).join("");

/**
 * Codifica los espacios de una ruta para meterla en un enlace markdown.
 *
 * El indexador corta el href en el primer espacio (`LINK_RE` usa `[^)\s]+`),
 * así que `[Proyectos](1 Projects/projects.md)` se leía como un enlace a `1`.
 * Salió al andamiar PARA, cuyos nombres de carpeta llevan espacio por
 * convención: las cinco notas nacían aisladas y sin un solo enlace interno.
 *
 * Solo el espacio, no `encodeURI` entero: el resto de los caracteres se leen
 * mejor sin codificar, y el indexador ya hace `decodeURIComponent`.
 */
const linkPath = (p: string) => p.replace(/ /g, "%20");

function frontmatter(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${/[:#]/.test(v) ? JSON.stringify(v) : v}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

/**
 * El artículo de un hub.
 *
 * Se escribe como artículo con prosa, no como índice de carpeta: es la regla
 * dura que salió de la Fase 7 —«los nodos son artículos, no carpetas»— después
 * de borrar 48 MOCs autogenerados que solo espejeaban el árbol. Este archivo
 * nace con lo mínimo para no ser uno de esos: dice qué pregunta responde, dónde
 * vive su material, y deja el hueco donde va lo que solo el dueño puede
 * escribir.
 */
function hubArticle(label: string, blurb: string, lives: string, name: string, x: ScaffoldText): string {
  return frontmatter({
    type: "moc",
    title: label,
    created: today(),
    updated: today(),
    author: "agent",
  }) + `
# ${label}

${blurb}

<!-- ${fill(x.generatedBy, { name })} -->

## ${x.whatLivesHere}

${lives ? fill(x.materialIn, { lives }) : x.noMaterial}

## ${x.whereToStart}

${x.nothingYet}
`;
}

/**
 * El artículo central, cuando la arquitectura tiene uno.
 *
 * `arch.rationale` puede llevar el placeholder `{{name}}` — lo usa `identidad`
 * para que su prosa («¿qué sabe {{name}}?») hable de quien de verdad creó el
 * vault, y no de una persona fija escrita en el paquete.
 */
function centreArticle(arch: Architecture, name: string, x: ScaffoldText): string {
  const links = arch.hubs
    .map((h) => `- [${h.label}](${linkPath(path.relative(path.dirname(arch.centre), h.hub) || h.hub)}) — ${plain(h.blurb)}`)
    .join("\n");
  return frontmatter({
    type: "moc",
    title: name,
    created: today(),
    updated: today(),
    author: "agent",
  }) + `
# ${name}

${plain(arch.rationale).replaceAll("{{name}}", name)}

## ${x.theQuestions}

${links || x.noQuestions}
`;
}

/**
 * El `CLAUDE.md` de la raíz: el router que lee un agente al abrir el vault.
 *
 * Mismo papel que el de este repo — decir dónde está cada cosa y qué reglas no
 * se negocian — pero generado desde la arquitectura, así que no puede quedar
 * describiendo carpetas que se movieron.
 */
function rootAgentsFile(arch: Architecture, name: string, x: ScaffoldText): string {
  const folders = arch.folders
    .map((f) => {
      // TODOS los hubs de la carpeta, no el primero: `00-Identidad/` tiene
      // cinco, y anunciar uno solo deja al agente creyendo que los otros cuatro
      // son notas cualesquiera.
      const hubs = arch.hubs.filter((h) => h.hub.startsWith(f.path));
      const note = hubs.length
        ? ` ${x.hubLabel}: ${hubs.map((h) => `\`${path.basename(h.hub)}\` (${x.quoteOpen}${h.label}${x.quoteClose})`).join(", ")}.`
        : "";
      return `| \`${f.path}\` | ${plain(f.purpose)}.${note} |`;
    })
    .join("\n");
  const hubs = arch.hubs
    .map((h) => `| ${h.label} | \`${h.hub}\` |`)
    .join("\n");

  return `# ${name}

${x.routerIntro}

${x.infoArch}: **${arch.name}**. ${plain(arch.description)}

## ${x.structure}

| ${x.folder} | ${x.whatFor} |
|---|---|
${folders}

${arch.hubs.length ? `## ${x.hubArticles}

${x.hubIntro}

| ${x.question} | ${x.article} |
|---|---|
${hubs}
` : ""}
## ${x.noteFormat}

${x.frontmatterIntro}

\`\`\`yaml
---
type: moc | area | project | knowledge | journal | source | connection | system | person
title: ${x.fmTitle}
created: YYYY-MM-DD    # ${x.fmCreatedNote}
updated: YYYY-MM-DD
author: human | agent | mixed
tags: [tag, ...]
---
\`\`\`

${x.rules}

## ${x.provenanceTitle}

${x.provenanceIntro}

\`\`\`markdown
<!-- ai -->
${x.provenanceSample}
<!-- /ai -->
\`\`\`

${x.provenanceRule}

## ${x.skills}

${fill(x.skillsIntro, { home: SKILLS_HOME, adapters: Object.values(SKILL_ADAPTERS).join(`/\` ${x.and} \``) })}

| ${x.skill} | ${x.whatFor} |
|---|---|
| \`/audit\` | ${x.skillAudit} |
| \`/vault-ingest\` | ${x.skillIngest} |

${fill(x.skillsRegen, { home: SKILLS_HOME })}

## ${x.config}

${x.configBody}
`;
}

export function createVault(
  dir: string,
  name: string,
  arch: Architecture,
  agent: string = "claude",
  locale: Locale = "en",
): ScaffoldResult {
  const x = TEXT[locale] ?? TEXT.en;
  const created: string[] = [];
  const skipped: string[] = [];

  /**
   * @param replace Reescribe aunque exista. Solo para `.summa/`.
   *
   * Las notas nunca se pisan — es la garantía de que elegir por error una
   * carpeta con contenido no le cuesta a nadie su trabajo. La configuración sí,
   * y tiene que ser así: al crear solo se llega con una carpeta **sin notas**, y
   * ahí un `.summa/architecture.json` es un default que la app sembró sola, no
   * trabajo de nadie. Sin reescribirlo, elegir PARA sobre una carpeta que la app
   * ya había tocado dejaba las carpetas de PARA con la arquitectura de identidad
   * en el JSON: dos verdades distintas sobre la forma del mismo vault.
   */
  const write = (rel: string, content: string, replace = false) => {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && !replace) { skipped.push(rel); return; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    created.push(rel);
  };

  fs.mkdirSync(dir, { recursive: true });

  // 1. La configuración. Va primero: si algo falla después, el vault ya es
  // reconocible como tal y la app puede abrirlo para que se vea qué pasó.
  write(".summa/architecture.json", JSON.stringify(arch, null, 2) + "\n", true);
  write(".summa/config.json", JSON.stringify({ name, tagline: "", icon: null }, null, 2) + "\n", true);
  write(".summa/categories.json",
    JSON.stringify({ version: 2, categories: arch.categories }, null, 2) + "\n", true);

  // 2. Las carpetas. Vacías: su contexto lo da el router de la raíz.
  //
  // La primera versión escribía un CLAUDE.md y un AGENTS.md DENTRO de cada
  // carpeta. Al usarlo se vio que sobraban: repetían lo que el router de la
  // raíz ya dice de cada una, duplicaban el doble de archivos que reglas hay, y
  // convertían cualquier cambio de criterio en una edición en seis sitios. Un
  // agente lee el router al abrir el vault; no necesita que se lo repitan en
  // cada carpeta a la que entra.
  for (const f of arch.folders) fs.mkdirSync(path.join(dir, f.path), { recursive: true });

  // 3. Los artículos del núcleo.
  if (arch.centre) write(arch.centre, centreArticle(arch, name, x));
  for (const h of arch.hubs) {
    write(h.hub, hubArticle(h.label, plain(h.blurb), h.lives, name, x));
  }

  // 4. El router de la raíz para el agente elegido.
  const root = rootAgentsFile(arch, name, x);
  if (agent === "antigravity") {
    write("AGENTS.md", root);
  } else if (agent === "opencode") {
    write("OPENCODE.md", root);
  } else {
    write("CLAUDE.md", root);
  }

  // 5. Las skills que no dependen de haber ingerido nada.
  //
  // `/audit` va aquí y no en la ingesta porque no necesita un ledger: audita la
  // estructura, y un vault recién creado ya tiene estructura que auditar. La de
  // ingesta se escribe cuando hay algo que repartir, que es cuando puede decir
  // de dónde salió cada archivo.
  //
  // Fuera de `write()` a propósito: no es una nota, es un artefacto generado
  // que se regenera, y pasa por `writeSkill` porque tiene que quedar visible
  // para los tres agentes, no solo para el que se eligió aquí. Elegir Claude en
  // el asistente no es motivo para dejar el vault inutilizable desde `agy`
  // mañana.
  const audit = writeAuditSkill(dir, arch, 4321, locale);
  created.push(audit.canonical);
  for (const a of audit.adapters) {
    if (a.kind === "native") continue;           // el canon, ya contado
    // `kept` es un directorio de skill escrito a mano que no pisamos. Va a
    // `skipped` porque eso es exactamente lo que pasó, y contarlo como creado
    // le diría al usuario que su versión se reemplazó.
    (a.kind === "kept" ? skipped : created).push(a.path);
  }

  return { created, skipped };
}

/**
 * Las rutas de skills que el vault usa, para `.gitignore` o para explicarlo.
 *
 * Los adaptadores son enlaces a `SKILLS_HOME`; versionar ambos lados guarda el
 * mismo contenido dos veces.
 */
export function skillPaths(): { canonical: string; adapters: string[] } {
  return { canonical: SKILLS_HOME, adapters: Object.values(SKILL_ADAPTERS) };
}
