import fs from "node:fs";
import path from "node:path";
import type { Architecture } from "./architecture.ts";
import { splitBold } from "./match.ts";
import { writeAuditSkill } from "./audit-skill.ts";
import { SKILLS_HOME, SKILL_ADAPTERS } from "./skills.ts";

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
 */

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
function hubArticle(label: string, blurb: string, lives: string, name: string): string {
  return frontmatter({
    type: "moc",
    title: label,
    created: today(),
    updated: today(),
    author: "agent",
  }) + `
# ${label}

${blurb}

<!-- Este artículo lo generó la app al crear ${name}. Reescríbelo: es un hub,
     no un índice — lo que vale es la prosa que conecta, no la lista. -->

## Qué vive aquí

${lives ? `Su material está en \`${lives}\`.` : "Todavía sin material asociado."}

## Por dónde entrar

Aún nada. Conforme escribas, enlaza desde aquí los artículos que de verdad
contesten esta pregunta — en línea y dentro del texto, no como lista al pie.
`;
}

/**
 * El artículo central, cuando la arquitectura tiene uno.
 *
 * `arch.rationale` puede llevar el placeholder `{{name}}` — lo usa `identidad`
 * para que su prosa («¿qué sabe {{name}}?») hable de quien de verdad creó el
 * vault, y no de una persona fija escrita en el paquete.
 */
function centreArticle(arch: Architecture, name: string): string {
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

## Las preguntas

${links || "_Esta arquitectura no declara preguntas._"}
`;
}

/**
 * El `CLAUDE.md` de la raíz: el router que lee un agente al abrir el vault.
 *
 * Mismo papel que el de este repo — decir dónde está cada cosa y qué reglas no
 * se negocian — pero generado desde la arquitectura, así que no puede quedar
 * describiendo carpetas que se movieron.
 */
function rootAgentsFile(arch: Architecture, name: string): string {
  const folders = arch.folders
    .map((f) => {
      // TODOS los hubs de la carpeta, no el primero: `00-Identidad/` tiene
      // cinco, y anunciar uno solo deja al agente creyendo que los otros cuatro
      // son notas cualesquiera.
      const hubs = arch.hubs.filter((h) => h.hub.startsWith(f.path));
      const note = hubs.length
        ? ` Artículos hub: ${hubs.map((h) => `\`${path.basename(h.hub)}\` («${h.label}»)`).join(", ")}.`
        : "";
      return `| \`${f.path}\` | ${plain(f.purpose)}.${note} |`;
    })
    .join("\n");
  const hubs = arch.hubs
    .map((h) => `| ${h.label} | \`${h.hub}\` |`)
    .join("\n");

  return `# ${name}

Base de conocimiento en markdown, leída y escrita por Summa Wiki. Este archivo
es el router: léelo primero.

Arquitectura de información: **${arch.name}**. ${plain(arch.description)}

## Estructura

| Carpeta | Para qué |
|---|---|
${folders}

${arch.hubs.length ? `## Artículos hub

Son artículos con prosa, no índices de carpeta. Una nota no se archiva bajo un
hub: el hub enlaza a la nota desde su texto.

| Pregunta | Artículo |
|---|---|
${hubs}
` : ""}
## Formato de las notas

Frontmatter YAML en todo archivo \`.md\`:

\`\`\`yaml
---
type: moc | area | project | knowledge | journal | source | connection | system | person
title: Nombre humano de la nota
created: YYYY-MM-DD    # vacío si no se puede derivar con certeza
updated: YYYY-MM-DD
author: human | agent | mixed
tags: [tema, ...]
---
\`\`\`

- **Enlaces markdown estándar**, nunca \`[[wikilinks]]\`. Rutas relativas.
- **Nombres de archivo en slug**: minúsculas, sin acentos ni espacios. El nombre
  humano vive en \`title:\`. Las notas diarias van en ISO (\`2026-07-23.md\`).
- **Assets** en una carpeta hermana \`assets/\`.
- **Fuentes junto a sus notas.** Un PDF lleva una nota compañera con
  \`type: source\` y \`resource:\` apuntando al archivo.
- **\`created\` nunca se inventa.** Si no se puede derivar, se deja vacío.

## ⚠ Procedencia — regla obligatoria para agentes

Al editar cualquier nota, **envuelve tus propias adiciones en marcadores**:

\`\`\`markdown
<!-- ai -->
Texto que escribiste tú, el agente.
<!-- /ai -->
\`\`\`

El texto sin marcar se lee como escrito por la persona dueña del vault. Si no
marcas lo tuyo, la procedencia se corrompe en silencio. Actualiza también
\`author:\` a \`mixed\` cuando metas contenido en una nota que era \`human\`.

## Skills

Las skills de este vault viven en \`${SKILLS_HOME}/<nombre>/SKILL.md\` — la
convención neutral, para que las lean varios agentes y no solo uno.
\`${Object.values(SKILL_ADAPTERS).join("/\` y \`")}/\` son enlaces a esa carpeta, no copias.

| Skill | Para qué |
|---|---|
| \`/audit\` | Revisar la salud del vault: qué se rompió y qué falta escribir. |
| \`/vault-ingest\` | Repartir lo que entró a la bandeja. Aparece tras la primera ingesta. |

Las **regenera la app** cuando cambia la arquitectura. Para reglas propias que
sobrevivan a eso, escribe \`${SKILLS_HOME}/<nombre>/local.md\`, que nunca se toca.

## Configuración

\`.summa/\` guarda la configuración de la app: \`architecture.json\` (esta
estructura, editable), \`categories.json\` y \`config.json\`. Las categorías son
**reglas**, no listas: una nota entra por ruta, etiqueta o tipo, y puede estar
en varias a la vez.
`;
}

export function createVault(dir: string, name: string, arch: Architecture, agent: string = "claude"): ScaffoldResult {
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
  if (arch.centre) write(arch.centre, centreArticle(arch, name));
  for (const h of arch.hubs) {
    write(h.hub, hubArticle(h.label, plain(h.blurb), h.lives, name));
  }

  // 4. El router de la raíz para el agente elegido.
  const root = rootAgentsFile(arch, name);
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
  const audit = writeAuditSkill(dir, arch);
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
