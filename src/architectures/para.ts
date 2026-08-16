import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";
import type { Locale } from "../locales.mjs";

/**
 * PARA — Projects · Areas · Resources · Archive.
 *
 * El método de Tiago Forte. Se incluye porque es el que la gente reconoce sin
 * que se lo expliquen, y porque ordena por una dimensión que `identidad` no
 * tiene: la **accionabilidad**. Un proyecto tiene fecha de término; un área es
 * un compromiso sin final; un recurso es material de consulta; el archivo es
 * lo que dejó de estar vivo. Nada se organiza por tema, y esa es la idea.
 *
 * Diferencia de fondo con `identidad`: aquí un artículo se mueve de carpeta
 * conforme cambia su estado —de Proyectos a Archivo cuando termina—, mientras
 * que en `identidad` una nota nunca se muda porque la pregunta que responde no
 * cambia. Son dos apuestas distintas sobre qué es estable.
 *
 * Se añade `0 Inbox/` al canon de cuatro: hace falta un sitio donde caiga lo
 * que todavía no se ha decidido, y sin él la decisión se toma en el momento
 * más caro, que es al capturar.
 *
 * ## Por qué las carpetas NO se traducen
 *
 * A diferencia de `identidad` y `plano`, este paquete nace con las mismas
 * carpetas en los dos idiomas. «Projects · Areas · Resources · Archive» no es
 * una descripción traducible: es el nombre propio del método, la sigla es el
 * método, y un `1 Proyectos/` rompería la P-A-R-A que le da sentido. Quien
 * elige PARA lo elige por su nombre.
 *
 * Solo se traduce la prosa: los rótulos que pinta la interfaz, las
 * descripciones y el enrutado.
 */

const TEXT = {
  es: {
    description: "Projects · Areas · Resources · Archive: ordenado por accionabilidad, no por tema.",
    rationale:
      "El vault se ordena por **accionabilidad**, no por tema. Un proyecto tiene " +
      "final; un área es un compromiso que no lo tiene; un recurso es material de " +
      "consulta; el archivo es lo que dejó de estar vivo. Una nota cambia de " +
      "carpeta cuando cambia su estado — eso es una función, no un descuido.",
    hubs: {
      projects: ["Proyectos", "Con final y con fecha. Si no se puede terminar, no es un proyecto."],
      areas: ["Áreas", "Compromisos sostenidos: salud, finanzas, equipo. No terminan."],
      resources: ["Recursos", "Temas de interés y material de consulta, sin obligación asociada."],
      archive: ["Archivo", "Lo que estuvo vivo y ya no. Se guarda entero, no se borra."],
    },
    folders: {
      inbox: "lo capturado que todavía no se ha decidido dónde va",
      projects: "esfuerzos con final y fecha",
      areas: "compromisos sostenidos, **sin fecha de término**",
      resources: "temas de interés y material de consulta",
      archive: "lo que dejó de estar activo, guardado entero",
    },
    routing: {
      projects: "tiene un final identificable y alguien lo está persiguiendo ahora",
      areas: "es una responsabilidad sostenida sin fecha de término",
      resources: "es material de consulta sobre un tema, sin obligación asociada",
      archive: "se refiere a algo que ya terminó o se abandonó",
      inbox: "no se puede decidir su nivel de accionabilidad leyéndolo",
    },
    cats: {
      projects: ["Proyectos", "Lo que tiene final y fecha."],
      areas: ["Áreas", "Compromisos que no terminan."],
      resources: ["Recursos", "Material de consulta, sin obligación asociada."],
      archive: ["Archivo", "Lo que estuvo vivo y ya no."],
      sources: ["Fuentes", "PDFs, artículos y documentos con su nota compañera."],
      people: ["Personas", "Quién aparece, y en qué papel."],
    },
  },
  en: {
    description: "Projects · Areas · Resources · Archive: ordered by actionability, not by topic.",
    rationale:
      "This vault is ordered by **actionability**, not by topic. A project has an " +
      "end; an area is a commitment that doesn't; a resource is reference " +
      "material; the archive is what stopped being alive. A note changes folder " +
      "when its status changes — that's a feature, not an oversight.",
    hubs: {
      projects: ["Projects", "With an end and a date. If it can't be finished, it isn't a project."],
      areas: ["Areas", "Standing commitments: health, finances, team. They don't end."],
      resources: ["Resources", "Topics of interest and reference material, with no obligation attached."],
      archive: ["Archive", "What was alive and no longer is. Kept whole, not deleted."],
    },
    folders: {
      inbox: "captured material with no decision made about where it goes",
      projects: "efforts with an end and a date",
      areas: "standing commitments, **with no end date**",
      resources: "topics of interest and reference material",
      archive: "what stopped being active, kept whole",
    },
    routing: {
      projects: "has an identifiable end and someone is chasing it right now",
      areas: "is a standing responsibility with no end date",
      resources: "is reference material on a topic, with no obligation attached",
      archive: "refers to something already finished or abandoned",
      inbox: "its level of actionability can't be decided by reading it",
    },
    cats: {
      projects: ["Projects", "What has an end and a date."],
      areas: ["Areas", "Commitments that don't end."],
      resources: ["Resources", "Reference material, with no obligation attached."],
      archive: ["Archive", "What was alive and no longer is."],
      sources: ["Sources", "PDFs, articles and documents with their companion note."],
      people: ["People", "Who shows up, and in what role."],
    },
  },
} as const;

/** Las cinco carpetas del método. Iguales en todos los idiomas: ver la cabecera. */
const INBOX = "0 Inbox/";
const PROJECTS = "1 Projects/";
const AREAS = "2 Areas/";
const RESOURCES = "3 Resources/";
const ARCHIVE = "4 Archive/";

export function para(locale: Locale): Architecture {
  const x = TEXT[locale] ?? TEXT.en;

  return {
    version: ARCHITECTURE_VERSION,
    id: "para",
    name: "PARA",
    description: x.description,
    rationale: x.rationale,
    primaryBundle: "personal",

    bundles: [{ id: "personal", root: "", shared: false }],

    centre: "home.md",

    hubs: [
      {
        id: "projects",
        label: x.hubs.projects[0],
        hub: `${PROJECTS}projects.md`,
        blurb: x.hubs.projects[1],
        lives: PROJECTS,
        paths: [PROJECTS],
      },
      {
        id: "areas",
        label: x.hubs.areas[0],
        hub: `${AREAS}areas.md`,
        blurb: x.hubs.areas[1],
        lives: AREAS,
        paths: [AREAS],
      },
      {
        id: "resources",
        label: x.hubs.resources[0],
        hub: `${RESOURCES}resources.md`,
        blurb: x.hubs.resources[1],
        lives: RESOURCES,
        paths: [RESOURCES],
      },
      {
        id: "archive",
        label: x.hubs.archive[0],
        hub: `${ARCHIVE}archive.md`,
        blurb: x.hubs.archive[1],
        lives: ARCHIVE,
        paths: [ARCHIVE],
      },
    ],

    folders: [
      { path: INBOX, purpose: x.folders.inbox },
      { path: PROJECTS, purpose: x.folders.projects },
      { path: AREAS, purpose: x.folders.areas },
      { path: RESOURCES, purpose: x.folders.resources },
      { path: ARCHIVE, purpose: x.folders.archive },
    ],

    indexShallow: [],

    articles: {
      notArticles: { paths: [], contains: ["/_templates/"] },
      neverCategorised: [],
    },

    defaultOpen: ["1 Projects"],

    inbox: INBOX,

    routing: [
      { when: x.routing.projects, to: PROJECTS },
      { when: x.routing.areas, to: AREAS },
      { when: x.routing.resources, to: RESOURCES },
      { when: x.routing.archive, to: ARCHIVE },
      { when: x.routing.inbox, to: INBOX },
    ],

    categories: [
      { id: "proyectos", label: x.cats.projects[0], blurb: x.cats.projects[1],
        paths: [PROJECTS], types: ["project"], notes: [] },
      { id: "areas", label: x.cats.areas[0], blurb: x.cats.areas[1],
        paths: [AREAS], types: ["area"], notes: [] },
      { id: "recursos", label: x.cats.resources[0], blurb: x.cats.resources[1],
        paths: [RESOURCES], notes: [] },
      { id: "archivo", label: x.cats.archive[0], blurb: x.cats.archive[1],
        paths: [ARCHIVE], notes: [], hidden: true },
      { id: "fuentes", label: x.cats.sources[0], blurb: x.cats.sources[1],
        types: ["source"], notes: [] },
      { id: "personas", label: x.cats.people[0], blurb: x.cats.people[1],
        types: ["person"], tags: ["persona", "person"], notes: [] },
    ],
  };
}
