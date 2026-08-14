import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";

/**
 * Plano — cuatro carpetas y todo lo demás por etiquetas.
 *
 * Para quien no quiere decidir en qué carpeta va cada cosa. La jerarquía se
 * queda en el mínimo que el sistema necesita de verdad —una nota, una fuente,
 * un día, una bandeja— y el resto de la organización la hacen las etiquetas y
 * los enlaces, que no obligan a elegir una sola casa.
 *
 * Es la apuesta contraria a PARA: allá una nota se muda de carpeta cuando
 * cambia de estado; aquí no se muda nunca porque la carpeta casi no dice nada.
 *
 * **Sin hubs.** `hubs` va vacío a propósito: no hay artículos-marco, porque no
 * hay preguntas fijas que contestar. Conserva un `centre` —una nota de entrada—
 * por una razón práctica que salió al probarlo: sin él, el vault recién creado
 * nacía con CERO notas y la app decía "este vault está vacío" justo después de
 * que el usuario lo creara. Es cierto y es pésimo.
 */
export const PLANO: Architecture = {
  version: ARCHITECTURE_VERSION,
  id: "plano",
  name: "Plano",
  description: "cuatro carpetas y nada más; organiza con etiquetas y enlaces.",
  rationale:
    "Aquí las carpetas casi no dicen nada, y es **deliberado**. La pregunta " +
    "«¿en qué carpeta va esto?» no tiene respuesta buena cuando una nota " +
    "pertenece a tres sitios; las etiquetas y los enlaces sí admiten esa " +
    "respuesta múltiple. La estructura emerge del grafo, no del árbol.",
  primaryBundle: "personal",

  bundles: [{ id: "personal", root: "", shared: false }],

  centre: "notas/inicio.md",
  hubs: [],

  folders: [
    { path: "inbox/", purpose: "lo capturado sin procesar todavía" },
    { path: "notas/", purpose: "todo lo escrito — se organiza por **etiquetas**, no por subcarpetas" },
    { path: "fuentes/", purpose: "PDFs y documentos, cada uno con su nota compañera" },
    { path: "diario/", purpose: "una nota por día, en formato ISO" },
  ],

  indexShallow: [],

  articles: {
    notArticles: { paths: [], contains: ["/_templates/"] },
    // El diario se navega por fecha; archivarlo por tema entierra los
    // artículos reales bajo un muro de días.
    neverCategorised: ["diario/"],
  },

  defaultOpen: ["notas"],

  inbox: "inbox/",

  routing: [
    { when: "cualquier cosa escrita: la carpeta no distingue, las etiquetas sí. Etiquétala bien y no te preocupes por dónde va", to: "notas/" },
    { when: "un PDF, docx o presentación: se copia tal cual y se le escribe una nota compañera al lado con type: source y resource:", to: "fuentes/" },
    { when: "escritura fechada de un día concreto", to: "diario/" },
    { when: "no se puede etiquetar sin leerlo con calma", to: "inbox/" },
  ],

  categories: [
    {
      id: "inbox", label: "Inbox",
      blurb: "Sin procesar. Debería estar vacío al final del día.",
      paths: ["inbox/"], notes: [],
    },
    {
      id: "fuentes", label: "Fuentes",
      blurb: "Lo leído: PDFs, artículos, documentos.",
      paths: ["fuentes/"], types: ["source"], notes: [],
    },
    {
      id: "personas", label: "Personas",
      blurb: "Quién aparece, y en qué papel.",
      types: ["person"], tags: ["persona"], notes: [],
    },
    {
      id: "ideas", label: "Ideas",
      blurb: "Conceptos propios y síntesis.",
      tags: ["idea", "concepto", "sintesis"], notes: [],
    },
    {
      id: "proyectos", label: "Proyectos",
      blurb: "Lo que está en marcha.",
      types: ["project"], tags: ["proyecto"], notes: [],
    },
  ],
};
