
/**
 * La ARQUITECTURA DE INFORMACIÓN del vault, como dato.
 *
 * Hasta la Fase 11 la forma del vault estaba escrita en TypeScript: los seis
 * hubs eran predicados en `lib/identity.ts`, las 23 categorías un array en
 * `lib/categories.ts`, los bundles y las exclusiones constantes en
 * `src/config.ts`, y la tabla de carpetas de la portada estaba a mano en el
 * JSX. Funcionaba perfecto para UN vault. Con la arquitectura en el código,
 * "elegir arquitectura" no puede existir como función: sería un fork.
 *
 * Aquí se declara el contrato; el paquete de abajo es la arquitectura de este
 * vault, extraída de ese código sin cambiarle nada. La prueba de que la
 * extracción salió bien es que el wiki se vea idéntico.
 *
 * ## Cómo se emparejan las rutas
 *
 * Un solo criterio en todo el sistema, el que ya usaban las categorías: una
 * ruta empareja si es **igual** al patrón o si **empieza** con él. Terminar el
 * patrón en `/` lo vuelve una carpeta (`02-Saber/`); sin barra, un archivo
 * exacto (`03-Journal/decisions.md`). No hay globs y no hacen falta: los cinco
 * predicados originales eran todos disyunciones de esas dos formas.
 */

export const ARCHITECTURE_VERSION = 1;

export interface ArchBundle {
  id: string;
  /** Ruta relativa al vault. Vacía = la raíz del vault. */
  root: string;
  /** Espacio compartido con otras personas. Cambia el trato, no el índice. */
  shared: boolean;
}

export interface ArchHub {
  id: string;
  label: string;
  /** Ruta del artículo hub, relativa al vault. */
  hub: string;
  blurb: string;
  /** Dónde vive su contenido, en prosa, para quien lee. */
  lives: string;
  /** Qué notas cuelgan de esta pregunta. Ver «cómo se emparejan las rutas». */
  paths: string[];
}

export interface ArchFolder {
  /** Con barra final: es una carpeta. */
  path: string;
  purpose: string;
}

export interface ArchCategory {
  id: string;
  label: string;
  blurb?: string;
  pillar?: string;
  bundle?: string;
  tags?: string[];
  paths?: string[];
  types?: string[];
  notes: string[];
  exclude?: string[];
  hidden?: boolean;
}

export interface Architecture {
  version: number;
  id: string;
  name: string;
  /** Una línea. Es lo que se lee al elegir arquitectura (Fase 13). */
  description: string;
  /**
   * El párrafo que explica en la portada por qué el vault está así.
   *
   * Admite `**negritas**` y nada más. Es prosa editorial y cambia con la
   * arquitectura —"organizado por preguntas" no significa nada en PARA— así
   * que no puede quedarse en el JSX.
   */
  rationale: string;
  /** El bundle donde viven los hubs. Sus ids son `<primaryBundle>:<ruta>`. */
  primaryBundle: string;
  bundles: ArchBundle[];
  /** El artículo central. Vacío = esta arquitectura no tiene centro. */
  centre: string;
  hubs: ArchHub[];
  /** Las carpetas de primer nivel y qué contesta cada una. */
  folders: ArchFolder[];
  /**
   * Carpetas cuyo contenido NO se indexa, pero cuya nota índice sí. Nacieron
   * de `05-Projects/`: 1,524 de sus 1,526 markdown son READMEs de
   * node_modules, y solo su `_index.md` pertenece al grafo.
   */
  indexShallow: string[];
  /**
   * Dos exclusiones distintas, y confundirlas cambia los números.
   *
   * `notArticles` es lo que no es contenido: plantillas y codebases. No se
   * cuenta en ningún lado. `neverCategorised` sí es contenido real —se navega,
   * se enlaza, cuenta para su pregunta— pero ninguna categoría lo archiva: un
   * log cronológico ordenado por tema entierra los artículos bajo un muro de
   * fechas.
   */
  articles: {
    notArticles: {
      /** Por prefijo o ruta exacta. */
      paths: string[];
      /** Por subcadena, para carpetas que aparecen a cualquier profundidad. */
      contains: string[];
    };
    neverCategorised: string[];
  };
  /** Carpetas que el árbol abre la primera vez. */
  defaultOpen: string[];

  /**
   * La bandeja: dónde cae lo que entra sin poder clasificarse todavía.
   *
   * Va aparte de `folders` porque no es una carpeta que la portada tenga que
   * anunciar — en un vault que nunca ha ingerido nada no existe siquiera. Se
   * crea la primera vez que hace falta.
   */
  inbox: string;

  /**
   * Cómo se reparte el material que entra. Lo consume el agente de ingesta.
   *
   * `when` es **prosa a propósito**, no un patrón. La decisión de si un
   * documento es un proyecto o una referencia no la toma una tabla de
   * extensiones: la toma alguien leyendo el contenido, y aquí ese alguien es
   * un modelo. Darle una regla ejecutable sería fingir que el problema es
   * determinista; darle prosa es decirle el criterio y dejar que lo aplique.
   *
   * `to` sí es una ruta, porque el destino no es interpretable.
   */
  routing: { when: string; to: string }[];
  categories: ArchCategory[];
}

/**
 * Las reglas de emparejado viven en `src/match.ts` — sin `node:fs`, para que
 * los componentes de cliente puedan aplicar las mismas que el servidor. Se
 * reexportan aquí porque este es el módulo del que se importa "arquitectura".
 */
export { underAny, containsAny, isArticlePath, splitBold } from "./match.ts";
export type { ArticleRules } from "./match.ts";
