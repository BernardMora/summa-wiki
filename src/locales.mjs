/**
 * Los primitivos del idioma, sin una sola dependencia.
 *
 * Viven solos y no dentro de `appdata.mjs` porque los necesitan tres mundos con
 * reglas distintas: el proceso principal de Electron (JS plano, sin TypeScript),
 * el servidor de Next (donde `appdata.mjs` sí puede leer disco) y **el bundle
 * del navegador**, que es el que fuerza la separación — `appdata.mjs` importa
 * `node:fs` y `node:os` en su primera línea, y arrastrarlo a un componente de
 * cliente rompe la compilación.
 *
 * Nada de este archivo toca disco ni entorno. Es a propósito: eso es lo que lo
 * hace importable desde cualquier parte.
 */

/** @typedef {"es"|"en"} Locale */

/** Los idiomas que la app habla. El orden es el del selector. */
export const LOCALES = /** @type {const} */ (["en", "es"]);

/**
 * El idioma cuando no hay nada elegido y no se puede preguntar al sistema.
 *
 * Inglés y no español aunque la app se escribió en español: el default lo ve
 * quien no ha configurado nada, y fuera de este vault esa persona es mucho más
 * probable que lea inglés. Quien esté en una máquina en español ni llega a
 * verlo — `seedLocale()` lo resuelve antes desde el locale del sistema.
 */
export const FALLBACK_LOCALE = "en";

/**
 * Normaliza cualquier etiqueta BCP-47 a un idioma que hablemos.
 *
 * `es-MX`, `es_419`, `ES` → `es`. Lo que no reconozcamos cae al respaldo en vez
 * de propagarse: un locale inventado que llegue hasta `t()` no encuentra tabla
 * y dejaría la interfaz en blanco.
 *
 * @param {unknown} tag
 * @returns {Locale}
 */
export function normalizeLocale(tag) {
  if (typeof tag !== "string") return FALLBACK_LOCALE;
  const base = tag.toLowerCase().replace("_", "-").split("-")[0];
  return LOCALES.includes(/** @type {any} */ (base))
    ? /** @type {Locale} */ (base)
    : FALLBACK_LOCALE;
}

/** ¿Es un idioma que hablamos? Distinto de normalizar: aquí `null` es respuesta. */
export function isLocale(tag) {
  return typeof tag === "string" && LOCALES.includes(/** @type {any} */ (tag));
}
