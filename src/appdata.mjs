import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Configuración de NIVEL MÁQUINA: qué vault está abierto y cuáles se abrieron
 * antes. Vive FUERA de cualquier vault, y ese es todo el punto — se necesita
 * antes de que exista un vault que consultar.
 *
 * Es `.mjs` y no `.ts` por una razón concreta: lo importan los dos procesos, y
 * uno de ellos no puede leer TypeScript. `electron/main.js` corre dentro de
 * Electron, sin `--experimental-strip-types`; `src/config.ts` corre en el Node
 * del servidor, que sí. JavaScript plano es el único formato que ambos cargan
 * sin build. Antes de esto, `electron/main.js:62` repetía a mano la resolución
 * del vault y ya había empezado a divergir: la app y el servidor podían estar
 * mirando carpetas distintas sin decirlo.
 */

/**
 * La MARCA, igual que `productName` en package.json y que `app.setName()`.
 * Nombra la carpeta de datos, así que cambiarla deja huérfana la
 * configuración anterior.
 */
export const APP_NAME = "Summa Wiki";

/**
 * Réplica de `app.getPath("userData")` de Electron, calculable sin Electron.
 *
 * No se llama a la API de Electron ni siquiera desde el proceso principal: si
 * este módulo la usara ahí y una fórmula propia acá, volveríamos justo al
 * problema que vino a resolver. Una sola fórmula, los dos procesos.
 */
export function userDataDir() {
  const appData =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(appData, APP_NAME);
}

export function settingsPath() {
  return path.join(userDataDir(), "settings.json");
}

/**
 * @typedef {object} Settings
 * @property {string|null} vault    Ruta absoluta del vault abierto.
 * @property {string[]} recents     Vaults abiertos antes, del más reciente al más viejo.
 */

/** @type {Settings} */
const DEFAULTS = { vault: null, recents: [] };

/** @returns {Settings} */
export function readSettings() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    // Sin archivo (primer arranque) o con el JSON corrupto. Ninguna de las dos
    // puede tumbar la app: sin configuración legible se arranca como si fuera
    // la primera vez, que es un estado que la app ya sabe manejar.
    return { ...DEFAULTS };
  }
  return {
    vault: typeof raw.vault === "string" && raw.vault.trim() ? raw.vault : null,
    recents: Array.isArray(raw.recents)
      ? raw.recents.filter((r) => typeof r === "string" && r.trim()).slice(0, 10)
      : [],
  };
}

/**
 * Guarda solo las claves que llegan.
 *
 * Escritura atómica: se escribe un temporal y se renombra. `rename` dentro del
 * mismo directorio es atómico en POSIX y en NTFS, así que un corte de luz a
 * medias deja el archivo viejo intacto en vez de uno truncado. El lector ya
 * tolera JSON roto, pero tolerar no es lo mismo que no producirlo — un
 * settings.json truncado le perdería el vault al usuario sin explicación.
 *
 * @param {Partial<Settings>} patch
 * @returns {Settings}
 */
export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  const dir = userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `settings.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, settingsPath());
  return next;
}

/**
 * Marca un vault como el abierto y lo sube al tope de los recientes.
 *
 * @param {string} abs Ruta absoluta.
 * @returns {Settings}
 */
export function rememberVault(abs) {
  const vault = path.resolve(abs);
  const recents = [vault, ...readSettings().recents.filter((r) => r !== vault)].slice(0, 10);
  return writeSettings({ vault, recents });
}

/**
 * ¿Esta carpeta es un vault que la app ya conoce?
 *
 * `.summa/` es la respuesta canónica. Se acepta también una carpeta con
 * markdown adentro, porque abrir una carpeta de notas que nunca pasó por la
 * app es un caso legítimo — sale de Obsidian, de iCloud, de un repo — y
 * exigirle `.summa/` la rechazaría por no haber sido creada aquí.
 *
 * @param {string} abs
 * @returns {"summa"|"markdown"|"empty"|"missing"}
 */
export function inspectVault(abs) {
  let entries;
  try {
    if (!fs.statSync(abs).isDirectory()) return "missing";
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return "missing";
  }
  if (entries.some((e) => e.isDirectory() && e.name === ".summa")) return "summa";
  const hasMd = entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"));
  if (hasMd) return "markdown";
  // Una carpeta con subcarpetas puede tener el markdown un nivel abajo, que es
  // la forma normal de un vault. Un solo nivel de profundidad: recorrer el
  // árbol entero para decidir si se puede abrir sería pagar el índice dos veces.
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    try {
      const inner = fs.readdirSync(path.join(abs, e.name));
      if (inner.some((n) => n.toLowerCase().endsWith(".md"))) return "markdown";
    } catch { /* sin permiso de lectura: no cuenta, y no es motivo de error */ }
  }
  return "empty";
}

/**
 * El vault de esta corrida, y de dónde salió.
 *
 * Orden de resolución, de más específico a más general:
 *
 * 1. `WIKI_VAULT` — un solo comando apunta el CLI o el servidor a otro vault
 *    sin tocar la configuración guardada. Es lo que usan los scripts.
 * 2. `settings.json` — lo que el usuario eligió en la app. La fuente normal.
 * 3. `~/Documents/aios` **solo si existe** — compatibilidad con las diez fases
 *    anteriores, cuando esa ruta era el default codificado. La condición de
 *    que exista es lo que evita que un usuario nuevo herede una ruta que no
 *    es suya y no está ahí: para él la respuesta correcta es "todavía no hay
 *    vault", no una carpeta fantasma.
 *
 * @returns {{path: string|null, source: "env"|"settings"|"legacy"|"none"}}
 */
export function resolveVault() {
  if (process.env.WIKI_VAULT?.trim()) {
    return { path: path.resolve(process.env.WIKI_VAULT.trim()), source: "env" };
  }
  const { vault } = readSettings();
  if (vault) return { path: path.resolve(vault), source: "settings" };

  const legacy = path.resolve(os.homedir(), "Documents/aios");
  if (fs.existsSync(legacy)) return { path: legacy, source: "legacy" };

  return { path: null, source: "none" };
}
