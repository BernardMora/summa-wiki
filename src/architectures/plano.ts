import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";
import type { Locale } from "../locales.mjs";

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

const DIRS = {
  es: { inbox: "inbox", notes: "notas", sources: "fuentes", journal: "diario", home: "inicio.md" },
  en: { inbox: "inbox", notes: "notes", sources: "sources", journal: "journal", home: "home.md" },
} as const;

const TEXT = {
  es: {
    name: "Plano",
    description: "cuatro carpetas y nada más; organiza con etiquetas y enlaces.",
    rationale:
      "Aquí las carpetas casi no dicen nada, y es **deliberado**. La pregunta " +
      "«¿en qué carpeta va esto?» no tiene respuesta buena cuando una nota " +
      "pertenece a tres sitios; las etiquetas y los enlaces sí admiten esa " +
      "respuesta múltiple. La estructura emerge del grafo, no del árbol.",
    folders: {
      inbox: "lo capturado sin procesar todavía",
      notes: "todo lo escrito — se organiza por **etiquetas**, no por subcarpetas",
      sources: "PDFs y documentos, cada uno con su nota compañera",
      journal: "una nota por día, en formato ISO",
    },
    routing: {
      notes: "cualquier cosa escrita: la carpeta no distingue, las etiquetas sí. Etiquétala bien y no te preocupes por dónde va",
      sources: "un PDF, docx o presentación: se copia tal cual y se le escribe una nota compañera al lado con type: source y resource:",
      journal: "escritura fechada de un día concreto",
      inbox: "no se puede etiquetar sin leerlo con calma",
    },
    cats: {
      inbox: ["Inbox", "Sin procesar. Debería estar vacío al final del día."],
      sources: ["Fuentes", "Lo leído: PDFs, artículos, documentos."],
      people: ["Personas", "Quién aparece, y en qué papel."],
      ideas: ["Ideas", "Conceptos propios y síntesis."],
      projects: ["Proyectos", "Lo que está en marcha."],
    },
  },
  en: {
    name: "Flat",
    description: "four folders and nothing else; organise with tags and links.",
    rationale:
      "Here the folders say almost nothing, and that is **deliberate**. The " +
      "question \"which folder does this go in?\" has no good answer when a note " +
      "belongs in three places; tags and links do admit that multiple answer. " +
      "The structure emerges from the graph, not from the tree.",
    folders: {
      inbox: "captured and not processed yet",
      notes: "everything written — organised by **tags**, not by subfolders",
      sources: "PDFs and documents, each with its companion note",
      journal: "one note per day, in ISO format",
    },
    routing: {
      notes: "anything written: the folder doesn't discriminate, the tags do. Tag it well and don't worry about where it goes",
      sources: "a PDF, docx or deck: copied as-is, with a companion note written beside it carrying type: source and resource:",
      journal: "dated writing from a specific day",
      inbox: "it can't be tagged without reading it properly",
    },
    cats: {
      inbox: ["Inbox", "Unprocessed. It should be empty by the end of the day."],
      sources: ["Sources", "What was read: PDFs, articles, documents."],
      people: ["People", "Who shows up, and in what role."],
      ideas: ["Ideas", "Original concepts and synthesis."],
      projects: ["Projects", "What's underway."],
    },
  },
} as const;

export function plano(locale: Locale): Architecture {
  const d = DIRS[locale] ?? DIRS.en;
  const x = TEXT[locale] ?? TEXT.en;

  const inbox = `${d.inbox}/`;
  const notes = `${d.notes}/`;
  const sources = `${d.sources}/`;
  const journal = `${d.journal}/`;

  return {
    version: ARCHITECTURE_VERSION,
    id: "plano",
    name: x.name,
    description: x.description,
    rationale: x.rationale,
    primaryBundle: "personal",

    bundles: [{ id: "personal", root: "", shared: false }],

    centre: `${notes}${d.home}`,
    hubs: [],

    folders: [
      { path: inbox, purpose: x.folders.inbox },
      { path: notes, purpose: x.folders.notes },
      { path: sources, purpose: x.folders.sources },
      { path: journal, purpose: x.folders.journal },
    ],

    indexShallow: [],

    articles: {
      notArticles: { paths: [], contains: ["/_templates/"] },
      // El diario se navega por fecha; archivarlo por tema entierra los
      // artículos reales bajo un muro de días.
      neverCategorised: [journal],
    },

    defaultOpen: [d.notes],

    inbox,

    routing: [
      { when: x.routing.notes, to: notes },
      { when: x.routing.sources, to: sources },
      { when: x.routing.journal, to: journal },
      { when: x.routing.inbox, to: inbox },
    ],

    categories: [
      { id: "inbox", label: x.cats.inbox[0], blurb: x.cats.inbox[1],
        paths: [inbox], notes: [] },
      { id: "fuentes", label: x.cats.sources[0], blurb: x.cats.sources[1],
        paths: [sources], types: ["source"], notes: [] },
      { id: "personas", label: x.cats.people[0], blurb: x.cats.people[1],
        types: ["person"], tags: ["persona", "person"], notes: [] },
      { id: "ideas", label: x.cats.ideas[0], blurb: x.cats.ideas[1],
        tags: ["idea", "concepto", "concept", "sintesis", "synthesis"], notes: [] },
      { id: "proyectos", label: x.cats.projects[0], blurb: x.cats.projects[1],
        types: ["project"], tags: ["proyecto", "project"], notes: [] },
    ],
  };
}
