import { LOCALES, FALLBACK_LOCALE, normalizeLocale } from "@/src/locales.mjs";
import { en } from "./messages/en.ts";
import { es } from "./messages/es.ts";

/**
 * El diccionario y la función que lo consulta. Isomorfo a propósito: lo importan
 * componentes de servidor, componentes de cliente y las rutas de API.
 *
 * ## Por qué el inglés es el que define el tipo
 *
 * `Messages` sale de `typeof en`, así que `es.ts` no puede compilar si le falta
 * una clave o si le sobra una que ya no existe. Es la única salvaguarda barata
 * contra la deriva entre tablas — sin ella, una clave añadida en una y olvidada
 * en la otra no se nota hasta que alguien cambia de idioma y ve el nombre de la
 * clave en pantalla.
 *
 * Que el inglés sea la referencia y no el español es consecuencia de que sea el
 * idioma por defecto: la tabla que se ve cuando nadie configuró nada es la que
 * más caro sale tener incompleta.
 *
 * ## Qué NO pasa por aquí
 *
 * Todo lo que se lee del vault —etiquetas de los hubs, nombres de categoría,
 * títulos de nota, el nombre de la wiki— se pinta tal como está guardado. Son
 * datos del usuario, no interfaz. Un vault creado en español conserva sus
 * `¿Qué sabe?` aunque la app esté en inglés, porque esas etiquetas describen
 * carpetas que en el disco se llaman así. Traducirlas al vuelo sería mentir
 * sobre el contenido del disco.
 */
export type Locale = (typeof LOCALES)[number];

/**
 * La forma del diccionario, dictada por la tabla inglesa.
 *
 * Se mapea a `string` en vez de usar `typeof en` a secas: `en` va con `as const`
 * —hace falta para que las CLAVES sean literales— y eso también congela los
 * VALORES, con lo que el tipo exigiría que la traducción al español dijera
 * literalmente «Save». El mapeo conserva la exigencia que importa (mismas
 * claves, ni una de más ni una de menos) y suelta la que no tiene sentido.
 */
export type Messages = { [K in keyof typeof en]: string };
export type MessageKey = keyof Messages;

const TABLES: Record<Locale, Messages> = { en, es };

export { LOCALES, FALLBACK_LOCALE, normalizeLocale };

/** Valores que se pueden interpolar en un mensaje. */
export type Vars = Record<string, string | number>;

/**
 * Sustituye `{nombre}` por su valor.
 *
 * Un `replace` y no una librería de plurales/formatos: los mensajes de esta app
 * interpolan nombres de archivo y conteos, y nada más. El día que haga falta
 * pluralizar de verdad, se declara una clave por rama (`n.one` / `n.other`) en
 * vez de meter ICU aquí.
 *
 * Un placeholder sin valor se deja intacto en vez de volverse `undefined`: se
 * ve raro, pero se ve, que es lo que hace que alguien lo reporte.
 */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole);
}

/**
 * Traductor para un idioma. Se construye una vez y se pasa hacia abajo.
 *
 * Cae a la tabla inglesa cuando la clave falta —imposible hoy, porque el tipo
 * lo impide, pero no cuando el diccionario se cargue desde disco— y a la clave
 * misma como último recurso. Nunca devuelve vacío: un botón sin texto es un bug
 * mudo, y el nombre de la clave al menos se puede buscar en el código.
 */
export function makeT(locale: Locale) {
  const table = TABLES[locale] ?? TABLES[FALLBACK_LOCALE];
  return function t(key: MessageKey, vars?: Vars): string {
    const raw = table[key] ?? TABLES[FALLBACK_LOCALE][key] ?? key;
    return interpolate(raw as string, vars);
  };
}

export type T = ReturnType<typeof makeT>;

/**
 * El idioma con el que ordenar texto.
 *
 * Existe porque había cinco `localeCompare(x, "es")` sueltos por el código, y
 * un orden alfabético fijo en español es incorrecto en cuanto la interfaz deja
 * de estarlo.
 */
export function collator(locale: Locale): Intl.Collator {
  return new Intl.Collator(locale, { sensitivity: "base", numeric: true });
}
