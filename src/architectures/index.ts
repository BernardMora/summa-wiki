import fs from "node:fs";
import path from "node:path";
import type { Architecture } from "../architecture.ts";
import type { Locale } from "../locales.mjs";
import { FALLBACK_LOCALE } from "../locales.mjs";
import { identidad } from "./identidad.ts";
import { para } from "./para.ts";
import { plano } from "./plano.ts";

/**
 * Los paquetes que trae la app. El usuario elige uno al crear un vault.
 *
 * Un registro en código y no una carpeta de JSON que se lee en tiempo de
 * ejecución: hay que enumerarlos para pintar el selector, y un `readdir` sobre
 * una ruta relativa al módulo es exactamente lo que se rompe al empaquetar el
 * `.app` — el archivo no queda rastreado y el fallo aparece donde no hay dónde
 * depurarlo. Importarlos hace que el empaquetador los siga solo.
 *
 * Que sean tres, y que apuesten cosas distintas, es a propósito: `identidad`
 * ordena por preguntas que no cambian, `para` por accionabilidad —una nota se
 * muda cuando cambia su estado— y `plano` renuncia a que la carpeta signifique
 * algo. Un selector con tres variantes de lo mismo no sería una elección.
 *
 * ## Constructores, no constantes
 *
 * Cada paquete es ahora una función de idioma, porque lo que produce son
 * NOMBRES DE CARPETA que acaban en el disco: un vault creado con la app en
 * inglés nace con `02-Knowledge/`, no con `02-Saber/`. El idioma se aplica una
 * sola vez, al crear, y el resultado queda congelado en
 * `.summa/architecture.json`.
 */
const BUILDERS = { identidad, para, plano } as const;

/** El orden es el del selector. `identidad` primero porque es el default. */
export const PACK_IDS = ["identidad", "para", "plano"] as const;

/** Los tres paquetes, resueltos para un idioma. Lo usa el selector de creación. */
export function getPacks(locale: Locale): Architecture[] {
  return PACK_IDS.map((id) => BUILDERS[id](locale));
}

/** El que se usa cuando el vault no declara ninguno. */
export function defaultPack(locale: Locale): Architecture {
  return identidad(locale);
}

export function getPack(id: string, locale: Locale): Architecture | undefined {
  return id in BUILDERS ? BUILDERS[id as keyof typeof BUILDERS](locale) : undefined;
}

export { identidad, para, plano };

/**
 * Carga la arquitectura del vault, con el paquete de identidad como respaldo.
 *
 * Vive en el registro y no en `src/architecture.ts` porque necesita conocer
 * los paquetes, y `architecture.ts` es el CONTRATO: los paquetes lo importan a
 * él. Tenerlo allá cerraba un ciclo con un valor —`ARCHITECTURE_VERSION`— que
 * TypeScript no marca y que revienta al arrancar con "Cannot access before
 * initialization". Los tipos se borran al compilar; las constantes no.
 *
 * Recibe la ruta del vault en vez de importarla de `src/config.ts` para no
 * cerrar el otro ciclo posible: config define VAULT y necesita la arquitectura
 * para construir los bundles.
 *
 * Tolerante a propósito: un archivo corrupto o a medio escribir cae al
 * respaldo en vez de tumbar la app. Perder las categorías propias por un JSON
 * mal cerrado es malo; no poder abrir el wiki es peor.
 *
 * ## Qué papel juega el idioma aquí
 *
 * NINGUNO cuando el vault ya trae su `architecture.json`: ese archivo gana
 * entero, y sus etiquetas se pintan tal como estén guardadas aunque no coincidan
 * con el idioma de la interfaz. Es lo correcto — describen carpetas que en el
 * disco se llaman así, y traducirlas al vuelo sería mentir sobre el contenido
 * del disco.
 *
 * El idioma solo decide el RESPALDO: la carpeta ajena que se abre por primera
 * vez y todavía no declara nada. Ahí no hay nada en disco que contradecir, así
 * que se siembra en el idioma de quien está mirando.
 */
export function loadArchitecture(vault: string, locale: Locale = FALLBACK_LOCALE): Architecture {
  const fallback = defaultPack(locale);
  const file = path.join(vault, ".summa", "architecture.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
  if (!raw || typeof raw !== "object") return fallback;

  // Fusión superficial contra el respaldo: una arquitectura escrita a mano a
  // la que le falte una clave nueva sigue funcionando, en vez de quedarse sin
  // categorías o sin bundles porque el archivo se escribió con una versión
  // anterior del formato.
  return { ...fallback, ...(raw as Partial<Architecture>) };
}
