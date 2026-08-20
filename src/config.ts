import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { BundleConfig } from "./types.ts";
import { resolveVault, userDataDir, inspectVault, resolveLocale } from "./appdata.mjs";
import type { Architecture } from "./architecture.ts";
import { loadArchitecture } from "./architectures/index.ts";

/**
 * Vault location is configuration, never a constant — this is what lets the
 * whole system be pointed at someone else's vault (see spec section 8).
 *
 * La resolución (env → settings de máquina → la ruta histórica si existe) vive
 * en `appdata.mjs` porque el proceso principal de Electron necesita la MISMA
 * respuesta y no puede importar TypeScript. Ver el comentario de cabecera de
 * ese archivo.
 */
const resolved = resolveVault();

/**
 * Sigue siendo `const` a propósito, y de ella cuelgan `bundles`, las rutas de
 * `.summa/` y el estado de los PDFs, todo resuelto al cargar el módulo.
 *
 * Convertirla en función significaría tocar los ~40 sitios que hoy la importan
 * como valor, y no compraría nada que el usuario note: cambiar de vault
 * reinicia el servidor (`electron/main.js` lo hace sin que se vea), y un
 * proceso nuevo resuelve la ruta nueva. Un vault que cambia bajo los pies de
 * un índice ya construido es un problema peor que el que resolvería.
 */
export const VAULT = resolved.path ?? path.join(userDataDir(), "sin-vault");

/** De dónde salió la ruta de arriba. La interfaz lo muestra; el CLI lo imprime. */
export const VAULT_SOURCE = resolved.source;

/**
 * ¿Hay un vault configurado?
 *
 * Distinto de `vaultExists()`: aquí se pregunta si el usuario ya eligió uno,
 * allá si la carpeta está en disco. Un vault elegido y luego borrado —o en un
 * disco externo desconectado— es configurado pero inexistente, y merece un
 * mensaje distinto que el primer arranque.
 */
export const HAS_VAULT = resolved.path !== null;

/**
 * La forma del vault, como dato. Ver `src/architecture.ts`.
 *
 * Se carga aquí y se reexporta para que el resto de la app tenga un solo sitio
 * del que importar configuración, y para que el ciclo config → arquitectura →
 * config no exista: `loadArchitecture` recibe la ruta, no la importa.
 */
export const LOCALE = resolveLocale();

/**
 * ...y el idioma solo decide el respaldo, nunca lo que el vault ya declaró.
 * Ver la cabecera de `loadArchitecture`.
 */
export const ARCH: Architecture = loadArchitecture(VAULT, LOCALE);

/**
 * Deja la arquitectura escrita en el vault la primera vez.
 *
 * Sin esto sería un valor por defecto invisible: la forma del vault seguiría
 * decidida en el código, solo que en un archivo distinto. Escrita, se puede
 * abrir, leer y editar — agregar una categoría o mover un hub deja de requerir
 * recompilar.
 *
 * **Solo si el vault ya tiene notas.** Una carpeta vacía no recibe nada, y esa
 * condición corrige un bug que se reportó en uso: abrir una carpeta vacía
 * escribía `.summa/architecture.json`, y en el paso siguiente la validación de
 * «crear vault» veía ese archivo, concluía «ahí ya hay un vault» y se negaba a
 * montar la estructura. La app creaba la condición que después la bloqueaba.
 *
 * Además es lo correcto de por sí: en un vault sin contenido la arquitectura
 * está por **elegirse**, no por heredarse. Sembrar un default ahí es tomarle al
 * usuario la única decisión que el asistente existe para ofrecerle.
 *
 * Con notas y sin `.summa/` —el vault ajeno que se abre por primera vez— sí se
 * siembra: ahí hace falta una arquitectura para poder pintar algo, y el paquete
 * de identidad es el default declarado.
 */
function seedArchitecture(): void {
  if (!HAS_VAULT || !fs.existsSync(VAULT)) return;
  if (inspectVault(VAULT) !== "markdown") return;
  const file = summaFile("architecture.json");
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(SUMMA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(ARCH, null, 2) + "\n", "utf8");
  } catch { /* vault de solo lectura: se sigue con el paquete en memoria */ }
}

/**
 * Los bundles declarados por la arquitectura, con sus raíces ya absolutas.
 *
 * Antes eran constantes propias de un vault. Cualquier otro usuario arrastraba
 * bundles fantasma apuntando a rutas inexistentes.
 */
export const bundles: BundleConfig[] = ARCH.bundles
  .map((b) => ({
    id: b.id,
    root: b.root ? path.join(VAULT, b.root) : VAULT,
    shared: b.shared,
  }))
  // Un bundle cuya carpeta no está en disco no se declara.
  //
  // No es cosmético: un selector no debe ofrecer bundles cuya carpeta no
  // existe y devolver siempre cero sin explicar por qué. También cubre raíces
  // compartidas o montadas que estén temporalmente desconectadas.
  //
  // El primario nunca se cae aunque falte: es el vault, y si no existe el
  // problema es otro y la pantalla de "no se encuentra el vault" ya lo dice.
  .filter((b) => b.id === ARCH.primaryBundle || fs.existsSync(b.root));

/** El bundle que contiene los hubs y cuyas rutas son relativas al vault. */
export const PRIMARY_BUNDLE = ARCH.primaryBundle;

/**
 * Directories never indexed.
 *
 * 05-Projects holds full codebases: 1,524 of its 1,526 markdown files are
 * node_modules READMEs. Only its _index.md belongs in the graph.
 *
 * Dot-directories are excluded explicitly — Obsidian ignores them by
 * convention, but this indexer inherits no such convention.
 */
export const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".next", ".open-next", ".hermes", ".obsidian",
  ".claude", ".agents", ".codex", ".vscode", "assets", "__pycache__", "venv",
]);

/**
 * Universales: no dependen de la arquitectura y por eso siguen en código.
 *
 * Los dot-directories se excluyen explícitamente — Obsidian los ignora por
 * convención, pero este indexador no hereda ninguna convención. Los
 * `.excalidraw.md` son JSON disfrazado de markdown.
 */
export const EXCLUDE_PATH_RE = [
  /(^|\/)\.[^/]+\//,             // any dot-directory segment
  /\.excalidraw\.md$/,          // Excalidraw payloads are JSON, not notes
];

/**
 * Instrucciones para agentes y para el repo — no son artículos del wiki.
 *
 * El README de la app decía desde la Fase 3 que estos archivos estaban
 * excluidos, y nunca lo estuvieron: se colaban 7 al índice, sin frontmatter,
 * sin enlaces entrantes, engordando *Sin categoría* y los avisos de
 * `wiki health`. La Fase 13 lo volvía peor, porque el andamiaje de un vault
 * nuevo escribe uno de estos por carpeta.
 *
 * Se comprobó antes de excluirlos que ninguna nota los enlaza, así que ningún
 * enlace se rompe al sacarlos.
 */
export const EXCLUDE_FILES = new Set(["CLAUDE.md", "AGENTS.md", "README.md"]);

/**
 * Las carpetas de `indexShallow` conservan su nota índice pero no lo que hay
 * dentro. Es un patrón por carpeta, no una regex fija: la regla es de la
 * arquitectura, y `05-Projects/` solo significa algo en este vault.
 */
const SHALLOW_RE = ARCH.indexShallow.map(
  (p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/$/, "")}\\/.+\\/`),
);

export function isExcluded(relPath: string): boolean {
  return EXCLUDE_PATH_RE.some((re) => re.test(relPath))
    || SHALLOW_RE.some((re) => re.test(relPath))
    || EXCLUDE_FILES.has(relPath.split(/[\\/]/).pop() ?? "");
}

/**
 * A qué bundle pertenece una ruta absoluta.
 *
 * Se elige la raíz MÁS LARGA que la contenga, no un bundle por nombre. Los
 * bundles pueden anidarse dentro del vault, así que la raíz más específica es
 * la respuesta correcta, y con N bundles declarados por
 * la arquitectura ya no hay dos nombres fijos a los que preguntar.
 */
export function bundleOf(abs: string): BundleConfig {
  let best = bundles.find((b) => b.root === VAULT) ?? bundles[0];
  for (const b of bundles) {
    if (abs !== b.root && !abs.startsWith(b.root + path.sep)) continue;
    if (b.root.length > best.root.length) best = b;
  }
  return best;
}

export const INDEX_PATH = process.env.WIKI_INDEX
  ? path.resolve(process.env.WIKI_INDEX)
  // `fileURLToPath`, no `URL.pathname`: en Windows `pathname` sale como
  // "/C:/…" con barra inicial y deja de ser una ruta válida. Es el mismo
  // idioma que ya usa `electron/main.js`.
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.json");

export function vaultExists(): boolean {
  return fs.existsSync(VAULT);
}

/**
 * Identidad de la wiki: nombre, bajada e icono.
 *
 * Vive en el VAULT, no en la app, por el mismo motivo que la ruta del vault es
 * configuración y no una constante (spec sección 8): apuntar la app a otro
 * vault tiene que remarcarla sola. Con la identidad del lado de la app habría
 * que reconfigurarla a mano cada vez que se cambia de vault — y el caso de uso
 * entero es que alguien más se lleve esto a su propia base de conocimiento.
 *
 * No se cachea a propósito. Es un JSON de unos cientos de bytes leído una vez
 * por render, y a cambio editarlo se ve en la siguiente navegación sin
 * reiniciar nada.
 */
export interface WikiConfig {
  name: string;
  tagline: string;
  /** Ruta relativa al vault. `null` usa el icono que trae la app. */
  icon: string | null;
}

const CONFIG_DEFAULTS: WikiConfig = {
  name: "Summa Wiki",
  tagline: "La enciclopedia personal",
  icon: null,
};

/**
 * El estado que la app guarda DENTRO del vault: identidad, categorías y la
 * posición de lectura de los PDFs.
 *
 * Vive en `.summa/`, carpeta de nombre fijo en la raíz, y no en `04-Sistema/`
 * como hasta la Fase 10. El motivo es el que destapó el plan de la Fase 11:
 * `04-Sistema/` es una carpeta de UNA arquitectura de información — la de este
 * vault. Un vault con arquitectura PARA no tiene dónde poner esto. La
 * configuración de la app no puede depender de una decisión que la app misma
 * dejó elegir.
 *
 * Punto al inicio para que el indexador la salte sin reglas nuevas
 * (`EXCLUDE_PATH_RE` ya excluye todo segmento que empiece con punto), y en la
 * raíz para que sea el mismo sitio en cualquier arquitectura. Queda versionada
 * en git: el `.gitignore` del vault excluye `.obsidian/workspace` y `.hermes/`,
 * no los dot-dirs en general.
 */
export const SUMMA_DIR = path.join(VAULT, ".summa");

export function summaFile(name: string): string {
  return path.join(SUMMA_DIR, name);
}

/**
 * Dónde vivía cada archivo hasta la Fase 10.
 *
 * Se migra renombrando, no copiando: dejar el archivo viejo en su sitio
 * produciría dos fuentes de verdad para la misma configuración, y la primera
 * vez que alguien editara la vieja —a mano, o un agente siguiendo una nota
 * desactualizada— el cambio se perdería en silencio. Una sola casa.
 */
const LEGACY: Array<[string, string]> = [
  ["04-Sistema/wiki-config.json", "config.json"],
  ["04-Sistema/wiki-categories.json", "categories.json"],
  ["04-Sistema/wiki-pdf-state.json", "pdf-state.json"],
];

/**
 * Mueve la configuración heredada a `.summa/`. Idempotente: lo ya migrado no
 * se vuelve a tocar, y un archivo que ya existe en el destino gana — nunca se
 * pisa lo nuevo con lo viejo.
 *
 * Corre al cargar el módulo, así que la cubren por igual el servidor, el CLI y
 * cualquier script que importe la configuración. Un vault de solo lectura, o
 * uno en un disco desconectado, hace fallar el rename: se ignora en vez de
 * impedir el arranque, y el lector de cada archivo cae a su default.
 */
function migrateLegacyConfig(): string[] {
  if (!HAS_VAULT || !fs.existsSync(VAULT)) return [];
  const moved: string[] = [];
  for (const [from, to] of LEGACY) {
    const src = path.join(VAULT, from);
    const dst = summaFile(to);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.mkdirSync(SUMMA_DIR, { recursive: true });
      fs.renameSync(src, dst);
      moved.push(`${from} → .summa/${to}`);
    } catch { /* sin permiso de escritura: se sigue con los defaults */ }
  }
  return moved;
}

export const MIGRATED = migrateLegacyConfig();

// Después de migrar, no antes: si `.summa/` aún no existe, la migración es
// quien lo crea, y sembrar primero dejaría la carpeta a medias.
seedArchitecture();

export const CONFIG_PATH = summaFile("config.json");

export function readConfig(): WikiConfig {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    // Sin archivo, o con el JSON a medio escribir: los valores por defecto.
    // Un error de sintaxis aquí no puede tumbar la app entera.
    return { ...CONFIG_DEFAULTS };
  }
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  return {
    name: str(raw.name, CONFIG_DEFAULTS.name),
    tagline: str(raw.tagline, CONFIG_DEFAULTS.tagline),
    icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim() : null,
  };
}

/**
 * Guarda la identidad. Solo se escriben las claves que llegan, para que
 * cambiar el nombre desde la interfaz no borre un icono configurado a mano.
 */
export function writeConfig(patch: Partial<WikiConfig>): WikiConfig {
  const next: WikiConfig = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/**
 * Ruta absoluta del icono configurado, o `null` si no hay o no existe.
 *
 * El `icon` del JSON es entrada no confiable igual que cualquier ruta que
 * venga del cliente: si alguien escribe `../../.ssh/id_rsa`, la app no debe
 * servirlo.
 */
export function configIconPath(): string | null {
  const { icon } = readConfig();
  if (!icon) return null;
  const abs = path.resolve(VAULT, icon);
  const root = path.resolve(VAULT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
}
