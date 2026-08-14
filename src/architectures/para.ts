import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";

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
 */
export const PARA: Architecture = {
  version: ARCHITECTURE_VERSION,
  id: "para",
  name: "PARA",
  description: "Projects · Areas · Resources · Archive: ordenado por accionabilidad, no por tema.",
  rationale:
    "El vault se ordena por **accionabilidad**, no por tema. Un proyecto tiene " +
    "final; un área es un compromiso que no lo tiene; un recurso es material de " +
    "consulta; el archivo es lo que dejó de estar vivo. Una nota cambia de " +
    "carpeta cuando cambia su estado — eso es una función, no un descuido.",
  primaryBundle: "personal",

  bundles: [{ id: "personal", root: "", shared: false }],

  centre: "home.md",

  hubs: [
    {
      id: "projects",
      label: "Proyectos",
      hub: "1 Projects/projects.md",
      blurb: "Con final y con fecha. Si no se puede terminar, no es un proyecto.",
      lives: "1 Projects/",
      paths: ["1 Projects/"],
    },
    {
      id: "areas",
      label: "Áreas",
      hub: "2 Areas/areas.md",
      blurb: "Compromisos sostenidos: salud, finanzas, equipo. No terminan.",
      lives: "2 Areas/",
      paths: ["2 Areas/"],
    },
    {
      id: "resources",
      label: "Recursos",
      hub: "3 Resources/resources.md",
      blurb: "Temas de interés y material de consulta, sin obligación asociada.",
      lives: "3 Resources/",
      paths: ["3 Resources/"],
    },
    {
      id: "archive",
      label: "Archivo",
      hub: "4 Archive/archive.md",
      blurb: "Lo que estuvo vivo y ya no. Se guarda entero, no se borra.",
      lives: "4 Archive/",
      paths: ["4 Archive/"],
    },
  ],

  folders: [
    { path: "0 Inbox/", purpose: "lo capturado que todavía no se ha decidido dónde va" },
    { path: "1 Projects/", purpose: "esfuerzos con final y fecha" },
    { path: "2 Areas/", purpose: "compromisos sostenidos, **sin fecha de término**" },
    { path: "3 Resources/", purpose: "temas de interés y material de consulta" },
    { path: "4 Archive/", purpose: "lo que dejó de estar activo, guardado entero" },
  ],

  indexShallow: [],

  articles: {
    notArticles: { paths: [], contains: ["/_templates/"] },
    neverCategorised: [],
  },

  defaultOpen: ["1 Projects"],

  inbox: "0 Inbox/",

  routing: [
    { when: "tiene un final identificable y alguien lo está persiguiendo ahora", to: "1 Projects/" },
    { when: "es una responsabilidad sostenida sin fecha de término", to: "2 Areas/" },
    { when: "es material de consulta sobre un tema, sin obligación asociada", to: "3 Resources/" },
    { when: "se refiere a algo que ya terminó o se abandonó", to: "4 Archive/" },
    { when: "no se puede decidir su nivel de accionabilidad leyéndolo", to: "0 Inbox/" },
  ],

  categories: [
    {
      id: "proyectos", label: "Proyectos",
      blurb: "Lo que tiene final y fecha.",
      paths: ["1 Projects/"], types: ["project"], notes: [],
    },
    {
      id: "areas", label: "Áreas",
      blurb: "Compromisos que no terminan.",
      paths: ["2 Areas/"], types: ["area"], notes: [],
    },
    {
      id: "recursos", label: "Recursos",
      blurb: "Material de consulta, sin obligación asociada.",
      paths: ["3 Resources/"], notes: [],
    },
    {
      id: "archivo", label: "Archivo",
      blurb: "Lo que estuvo vivo y ya no.",
      paths: ["4 Archive/"], notes: [], hidden: true,
    },
    {
      id: "fuentes", label: "Fuentes",
      blurb: "PDFs, artículos y documentos con su nota compañera.",
      types: ["source"], notes: [],
    },
    {
      id: "personas", label: "Personas",
      blurb: "Quién aparece, y en qué papel.",
      types: ["person"], tags: ["persona"], notes: [],
    },
  ],
};
