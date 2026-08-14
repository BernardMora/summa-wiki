/**
 * Emparejado de rutas y formato mínimo. Sin dependencias de Node.
 *
 * Separado de `src/architecture.ts` porque estas tres funciones las necesitan
 * también componentes de cliente —el conmutador rápido y el selector de
 * enlaces filtran por las mismas reglas que el servidor— y `architecture.ts`
 * importa `node:fs`. Importarlo desde el navegador rompe la build.
 *
 * ## La regla de emparejamiento
 *
 * Una ruta empareja si es **igual** al patrón o si **empieza** con él. Terminar
 * el patrón en `/` lo vuelve una carpeta (`02-Saber/`); sin barra, un archivo
 * exacto (`03-Journal/decisions.md`). No hay globs y no hacen falta: los cinco
 * predicados que había en `lib/identity.ts` eran todos disyunciones de esas
 * dos formas.
 */

export function underAny(p: string, patterns: string[] | undefined): boolean {
  return !!patterns?.some((pat) => p === pat || p.startsWith(pat));
}

/** Por subcadena, para carpetas que aparecen a cualquier profundidad. */
export function containsAny(p: string, fragments: string[] | undefined): boolean {
  return !!fragments?.some((f) => p.includes(f));
}

/** Qué no es un artículo: plantillas, codebases, lo que declare la arquitectura. */
export interface ArticleRules {
  paths: string[];
  contains: string[];
}

export const isArticlePath = (p: string, rules: ArticleRules | undefined): boolean =>
  !containsAny(p, rules?.contains) && !underAny(p, rules?.paths);

/**
 * Parte un texto en tramos normales y en negrita, para pintar `**así**`.
 *
 * Es todo el markdown que admiten los textos de la arquitectura, y a propósito:
 * los escribe quien define un paquete, y aceptar HTML ahí sería abrir una
 * inyección a cambio de cursivas.
 */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((chunk, i) => ({ text: chunk, bold: i % 2 === 1 }))
    .filter((c) => c.text !== "");
}
