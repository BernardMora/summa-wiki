import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { Architecture } from "./architecture.ts";

/**
 * La skill que corre el agente para repartir lo ingerido.
 *
 * Se escribe **dentro del vault**, en `.claude/skills/vault-ingest/`, y no se
 * manda como prompt de un solo tiro. Tres razones, en orden de peso:
 *
 * 1. Sirve otra vez. La ingesta no es un evento único: dentro de un mes habrá
 *    otra carpeta que meter, y entonces basta con `/vault-ingest`.
 * 2. Es editable. Si el reparto sale torcido, se corrige el criterio en un
 *    archivo que el usuario puede leer, en vez de en el código de la app.
 * 3. Viaja con el vault, igual que la arquitectura y las categorías.
 *
 * Se regenera en cada ingesta porque incorpora las reglas de la arquitectura
 * vigente: si el usuario editó `architecture.json`, la skill tiene que decir lo
 * que dice ese archivo hoy, no lo que decía el día que se creó el vault.
 */

export function ingestSkill(arch: Architecture, ledgerRel: string): string {
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
`;
}

export function writeIngestSkill(vault: string, arch: Architecture, ledgerRel: string): string {
  const dir = path.join(vault, ".claude", "skills", "vault-ingest");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, ingestSkill(arch, ledgerRel), "utf8");
  return file;
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
 */
export function findClaude(): Promise<string | null> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shell, ["-lic", "command -v claude"], { timeout: 8000 }, (err, stdout) => {
      const out = (stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
      resolve(!err && out.startsWith("/") ? out : null);
    });
  });
}
