import fs from "node:fs";
import path from "node:path";
import type { Locale } from "./locales.mjs";

/**
 * Dónde se guarda una skill para que la vean VARIOS agentes.
 *
 * No hay un directorio que todos lean. Lo que hay, verificado:
 *
 *  - **Claude Code** lee `.claude/skills/<name>/SKILL.md` (y `~/.claude/skills/`).
 *    NO lee `.agents/skills/`.
 *  - **opencode** lee `.opencode/skills/`, `.claude/skills/` **y** `.agents/skills/`.
 *  - **Antigravity** (`agy`) lee `.agents/skills/` en la raíz del proyecto.
 *  - **Codex** lee `.agents/skills/` y usa `AGENTS.md` como router.
 *
 * La intersección está vacía; la unión no. Así que el canon vive en
 * `.agents/skills/` —la convención neutral, la única que tres de los cuatro leen
 * nativamente— y hacia `.claude/skills/` sale un **symlink al directorio**, no
 * una copia.
 *
 * Symlink y no copia porque la skill se regenera: con copias, editar el canon
 * deja a Claude leyendo la versión vieja, y ese desacuerdo es invisible hasta
 * que el agente hace algo que nadie le pidió. Con un enlace hay un solo
 * archivo y no puede haber dos verdades. (Que Claude Code sigue directorios de
 * skill enlazados está comprobado en uso: las skills de Veridia de este mismo
 * repo son symlinks a una carpeta de Drive y se cargan sin problema.)
 *
 * La copia queda de plan B para donde no se pueda enlazar —Windows sin permiso
 * de symlink, algún sistema de archivos de red— porque fallar ahí significaría
 * un vault sin skills, que es mucho peor que un vault con dos copias.
 */

/** El canon. Neutral, y lo que Antigravity y opencode leen tal cual. */
export const SKILLS_HOME = ".agents/skills";

/**
 * Adaptadores por agente. Añadir un agente aquí es una línea; es a propósito,
 * porque estas convenciones todavía se están moviendo y el día que Claude Code
 * lea `.agents/skills/` esto se borra sin tocar nada más.
 */
export const SKILL_ADAPTERS: Record<string, string> = {
  claude: ".claude/skills",
  opencode: ".opencode/skills",
};

export type AdapterKind = "symlink" | "copy" | "native" | "kept";

export interface SkillWrite {
  name: string;
  /** Ruta relativa al vault del SKILL.md canónico. */
  canonical: string;
  adapters: { agent: string; path: string; kind: AdapterKind }[];
}

/** ¿`p` ya es un symlink que apunta a donde queremos? */
function linksTo(p: string, target: string): boolean {
  try {
    return path.resolve(path.dirname(p), fs.readlinkSync(p)) === path.resolve(target);
  } catch {
    return false;
  }
}

const rel = (vault: string, abs: string) => path.relative(vault, abs).split(path.sep).join("/");

/**
 * Escribe una skill generada y la deja visible para todos los agentes.
 *
 * El canon SIEMPRE se reescribe: es un archivo generado desde la arquitectura,
 * y una skill que describe una estructura que ya cambió es peor que ninguna.
 * Por eso `local.md` existe —ver `localNote()`—: es el hueco donde poner
 * criterio propio sin que la regeneración se lo lleve.
 *
 * Los adaptadores no se pisan si son directorios de verdad. Que alguien tenga
 * su propio `.claude/skills/audit/` escrito a mano es una respuesta válida, y
 * gana sobre lo que genera la app; se reporta como `kept` para que la interfaz
 * pueda decirlo en vez de dejar al usuario creyendo que su versión desapareció.
 */
export function writeSkill(vault: string, name: string, content: string): SkillWrite {
  const canonDir = path.join(vault, SKILLS_HOME, name);
  fs.mkdirSync(canonDir, { recursive: true });
  const canonFile = path.join(canonDir, "SKILL.md");
  fs.writeFileSync(canonFile, content, "utf8");

  const adapters: SkillWrite["adapters"] = [
    { agent: "antigravity", path: rel(vault, canonFile), kind: "native" },
    { agent: "codex", path: rel(vault, canonFile), kind: "native" },
  ];

  for (const [agent, dir] of Object.entries(SKILL_ADAPTERS)) {
    const link = path.join(vault, dir, name);
    fs.mkdirSync(path.dirname(link), { recursive: true });

    if (linksTo(link, canonDir)) {
      adapters.push({ agent, path: rel(vault, link), kind: "symlink" });
      continue;
    }

    const stat = fs.lstatSync(link, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      // Un directorio real, no un enlace nuestro: trabajo de alguien.
      adapters.push({ agent, path: rel(vault, link), kind: "kept" });
      continue;
    }
    if (stat) fs.rmSync(link, { force: true });   // enlace roto o apuntando mal

    try {
      // Relativo, no absoluto: el vault se mueve, se sincroniza y se copia a
      // otra máquina. Un enlace absoluto sobrevive a nada de eso.
      fs.symlinkSync(path.relative(path.dirname(link), canonDir), link, "dir");
      adapters.push({ agent, path: rel(vault, link), kind: "symlink" });
    } catch {
      fs.mkdirSync(link, { recursive: true });
      fs.writeFileSync(path.join(link, "SKILL.md"), content, "utf8");
      adapters.push({ agent, path: rel(vault, `${link}/SKILL.md`), kind: "copy" });
    }
  }

  return { name, canonical: rel(vault, canonFile), adapters };
}

/**
 * El párrafo que toda skill generada lleva al final.
 *
 * Resuelve la contradicción que traía la skill de ingesta: se anunciaba como
 * editable y se sobrescribía en cada corrida. Ahora lo generado y lo propio son
 * dos archivos, y solo uno se regenera.
 */
export function localNote(name: string, locale: Locale = "en"): string {
  if (locale === "es") {
    return `
## Criterio propio

Este archivo lo **regenera la app** cada vez que cambia la arquitectura del
vault: lo que edites aquí se pierde. Para reglas propias que duren, escribe
\`${SKILLS_HOME}/${name}/local.md\` — la app nunca lo toca.

Si ese archivo existe, **léelo antes de empezar y gana sobre lo de arriba**.
Lo de aquí es el criterio por defecto; lo de ahí es el de quien mantiene este
vault.
`;
  }
  return `
## Your own criteria

The app **regenerates this file** every time the vault's architecture changes:
anything you edit here is lost. For your own rules that last, write
\`${SKILLS_HOME}/${name}/local.md\` — the app never touches it.

If that file exists, **read it before starting and let it win over the above**.
What's here is the default criteria; what's there belongs to whoever maintains
this vault.
`;
}
