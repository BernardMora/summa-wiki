import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOCALES, FALLBACK_LOCALE, normalizeLocale, isLocale } from "./locales.mjs";

/** Reexportados: el resto del proyecto pide los primitivos de idioma aquí. */
export { LOCALES, FALLBACK_LOCALE, normalizeLocale };

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
  // Inyección explícita para pruebas y builds de humo: permite comprobar el
  // primer arranque sin tocar la configuración real de la máquina que corre CI.
  if (process.env.WIKI_USER_DATA?.trim()) return path.resolve(process.env.WIKI_USER_DATA.trim());
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
 * @typedef {object} OnboardingState
 * @property {number} version
 * @property {"not_started"|"in_progress"|"completed"} status
 * @property {"welcome"|"ai"|"demo"|"vault"|"done"} stage
 * @property {string|null} lesson
 * @property {string[]} completed
 * @property {string[]} skipped
 * @property {"summa-classic"|"notebook"|"studio"|"archive"|"terminal"} design
 * @property {"system"|"light"|"dark"} mode
 */

/**
 * @typedef {object} AiSettings
 * @property {"claude"|"antigravity"|"opencode"|"codex"|null} agent
 * @property {string} model
 * @property {boolean} configured
 */

/**
 * @typedef {object} DemoVaultSettings
 * @property {string} path
 * @property {Locale} locale
 * @property {number} templateVersion
 */

/**
 * @typedef {object} Settings
 * @property {string|null} vault    Ruta absoluta del vault abierto.
 * @property {string[]} recents     Vaults abiertos antes, del más reciente al más viejo.
 * @property {Locale|null} locale   Idioma elegido. `null` = todavía sin elegir.
 * @property {OnboardingState} onboarding Estado versionado del primer recorrido.
 * @property {AiSettings} ai       Agente y modelo preferidos para la interfaz.
 * @property {DemoVaultSettings|null} demoVault Copia local y versión del vault de ejemplo.
 */

/**
 * `locale: null` y no `"en"` a propósito.
 *
 * Distingue «nunca eligió» de «eligió inglés», y esa diferencia es la que deja
 * que el primer arranque siembre el idioma del sistema sin pisar una elección
 * real. Sembrar el default aquí borraría esa distinción para siempre.
 *
 * @type {Settings}
 */
const DEFAULT_ONBOARDING = {
  version: 1,
  status: "not_started",
  stage: "welcome",
  lesson: null,
  completed: [],
  skipped: [],
  design: "summa-classic",
  mode: "system",
};

const DEFAULTS = {
  vault: null,
  recents: [],
  locale: null,
  onboarding: DEFAULT_ONBOARDING,
  ai: { agent: null, model: "", configured: false },
  demoVault: null,
};

const stringList = (value) => Array.isArray(value)
  ? [...new Set(value.filter((v) => typeof v === "string" && v.trim()))]
  : [];

/** @returns {OnboardingState} */
function safeOnboarding(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_ONBOARDING };
  const statuses = new Set(["not_started", "in_progress", "completed"]);
  const stages = new Set(["welcome", "ai", "demo", "vault", "done"]);
  const designs = new Set(["summa-classic", "notebook", "studio", "archive", "terminal"]);
  const modes = new Set(["system", "light", "dark"]);
  return {
    version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
    status: statuses.has(value.status) ? value.status : "not_started",
    stage: stages.has(value.stage) ? value.stage : "welcome",
    lesson: typeof value.lesson === "string" && value.lesson.trim() ? value.lesson : null,
    completed: stringList(value.completed),
    skipped: stringList(value.skipped),
    design: designs.has(value.design) ? value.design : "summa-classic",
    mode: modes.has(value.mode) ? value.mode : "system",
  };
}

/** @returns {AiSettings} */
function safeAi(value) {
  if (!value || typeof value !== "object") return { ...DEFAULTS.ai };
  const agents = new Set(["claude", "antigravity", "opencode", "codex"]);
  const agent = agents.has(value.agent) ? value.agent : null;
  return {
    agent,
    model: typeof value.model === "string" ? value.model : "",
    configured: Boolean(value.configured && agent),
  };
}

/** @returns {DemoVaultSettings|null} */
function safeDemoVault(value) {
  if (!value || typeof value !== "object" || typeof value.path !== "string" || !value.path.trim()) return null;
  return {
    path: path.resolve(value.path),
    locale: isLocale(value.locale) ? value.locale : FALLBACK_LOCALE,
    templateVersion: Number.isInteger(value.templateVersion) ? value.templateVersion : 1,
  };
}

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
    // Se valida contra la lista, no se normaliza: aquí interesa si hay una
    // elección guardada, y un valor basura equivale a no haber elegido.
    locale: isLocale(raw.locale) ? raw.locale : null,
    onboarding: safeOnboarding(raw.onboarding),
    ai: safeAi(raw.ai),
    demoVault: safeDemoVault(raw.demoVault),
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
 * El idioma efectivo de la app.
 *
 * Mismo patrón que `resolveVault()`, y por la misma razón: el proceso principal
 * de Electron y el servidor de Next tienen que dar la MISMA respuesta, y el
 * primero no puede importar TypeScript. Por eso vive aquí y no en `lib/i18n`.
 *
 * Orden: variable de entorno → lo elegido en la app → respaldo. El sistema
 * operativo NO entra en esta cadena: entra una sola vez, en `seedLocale()`, y
 * queda escrito. Consultarlo en cada arranque haría que cambiar el idioma del
 * Mac cambiara el de una app donde el usuario ya eligió otro.
 *
 * `WIKI_LOCALE` existe para las pruebas y para arrancar el servidor en un
 * idioma sin tocar los settings de la máquina.
 *
 * @returns {Locale}
 */
export function resolveLocale() {
  if (process.env.WIKI_LOCALE) return normalizeLocale(process.env.WIKI_LOCALE);
  const { locale } = readSettings();
  return locale ?? FALLBACK_LOCALE;
}

/**
 * Siembra el idioma del sistema la primera vez, y solo la primera vez.
 *
 * Lo llama `electron/main.js` con `app.getLocale()`, que es el único sitio del
 * proyecto que sabe qué idioma tiene el sistema operativo — el servidor de Next
 * corre sin cabeza y `process.env.LANG` no es fiable en un `.app` empaquetado.
 *
 * Si ya hay una elección guardada no se toca nada: quien puso inglés en una
 * máquina en español lo puso a propósito.
 *
 * @param {string|undefined} systemLocale
 * @returns {Locale}
 */
export function seedLocale(systemLocale) {
  const { locale } = readSettings();
  if (locale) return locale;
  const seeded = normalizeLocale(systemLocale);
  writeSettings({ locale: seeded });
  return seeded;
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
