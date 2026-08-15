import { execFile } from "node:child_process";
import type { Architecture } from "./architecture.ts";
import { writeSkill, localNote, type SkillWrite } from "./skills.ts";

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
${localNote("vault-ingest")}`;
}

export function writeIngestSkill(vault: string, arch: Architecture, ledgerRel: string): SkillWrite {
  return writeSkill(vault, "vault-ingest", ingestSkill(arch, ledgerRel));
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
