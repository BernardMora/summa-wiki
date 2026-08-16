import { resolveLocale } from "@/src/appdata.mjs";
import { makeT, collator, type Locale, type T } from "./i18n.ts";

/**
 * El traductor del servidor: componentes de servidor, páginas y rutas de API.
 *
 * **Solo servidor.** Llega hasta `node:fs` por la cadena `appdata.mjs`, así que
 * importarlo desde un componente de cliente rompe la compilación. El paquete
 * `server-only` convertiría ese fallo en un mensaje que dice por qué, pero no
 * está entre las dependencias y no vale traer una por un marcador: desde el
 * cliente se usa `useT()` de `components/I18n.tsx`, y el `.server` del nombre
 * está para que la regla se lea sin abrir el archivo.
 *
 * Lee los settings en cada llamada en vez de cachear el traductor en un módulo:
 * el idioma se puede cambiar sin reiniciar el servidor, y un traductor
 * congelado al cargar el módulo dejaría media interfaz en el idioma viejo hasta
 * el siguiente arranque. Es una lectura de un JSON diminuto que el sistema
 * operativo ya tiene en caché.
 */
export function getLocale(): Locale {
  return resolveLocale();
}

export function getT(): T {
  return makeT(resolveLocale());
}

/** Para ordenar listas en el servidor — árbol de archivos, navegación, categorías. */
export function getCollator(): Intl.Collator {
  return collator(resolveLocale());
}
