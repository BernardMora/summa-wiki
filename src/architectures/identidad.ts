import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";

/**
 * La arquitectura de ESTE vault: identidad, organizada por preguntas.
 *
 * Va como constante de TypeScript y no como JSON leído del disco a propósito.
 * Es el valor por defecto, y un valor por defecto que depende de leer un
 * archivo puede faltar: `import.meta.url` no sobrevive intacto al empaquetado
 * de Next si el archivo no quedó rastreado, y el fallo aparecería al empaquetar
 * el `.app` —justo donde no hay dónde depurarlo— y no al desarrollar.
 *
 * Los paquetes que el usuario podrá ELEGIR (PARA, plano) son otra cosa y son
 * trabajo de la Fase 13: ahí sí son archivos, porque hay que enumerarlos.
 */
export const IDENTIDAD: Architecture = {
  version: ARCHITECTURE_VERSION,
  id: "identidad",
  name: "Identidad",
  // Corta a propósito: se usa como subtítulo de la portada Y como texto de la
  // tarjeta en el selector de arquitecturas. Dos renglones no caben en ninguno.
  description: "organizado por preguntas sobre quien lo escribe, no por temas.",
  rationale:
    "El vault se organiza por **preguntas**, no por categorías temáticas. " +
    "Las categorías se pudren; las preguntas no: ¿qué sabe Bernardo? seguirá " +
    "siendo la pregunta correcta en diez años. Las categorías de arriba son " +
    "una segunda entrada — un índice por tema encima de la misma estructura, " +
    "no un reemplazo.",
  primaryBundle: "personal",

  bundles: [
    { id: "personal", root: "", shared: false },
    { id: "veridia", root: "01-Hacer/01-veridia", shared: true },
  ],

  centre: "00-Bernardo/quien-es-bernardo.md",

  hubs: [
    {
      id: "vivido",
      label: "¿Qué ha vivido?",
      hub: "00-Bernardo/que-ha-vivido.md",
      blurb: "Infancia, formación, trabajo, y las personas que lo acompañaron.",
      lives: "00-Bernardo/biografia/",
      paths: ["00-Bernardo/biografia/"],
    },
    {
      id: "sabe",
      label: "¿Qué sabe?",
      hub: "00-Bernardo/que-sabe.md",
      blurb: "El árbol de conocimiento: lo estudiado, lo leído, lo que quedó.",
      lives: "02-Saber/",
      paths: ["02-Saber/"],
    },
    {
      id: "hace",
      label: "¿Qué hace?",
      hub: "00-Bernardo/que-hace.md",
      blurb: "En qué se le va el día y qué hábitos lo sostienen.",
      lives: "01-Hacer/",
      paths: ["01-Hacer/"],
    },
    {
      id: "piensa",
      label: "¿Cómo piensa?",
      hub: "00-Bernardo/marco-de-pensamiento.md",
      blurb: "Filosofía dominante, fundamentos éticos, contexto e ideas clave.",
      lives: "artículos de posición, repartidos",
      paths: [
        "00-Bernardo/marco-de-pensamiento.md",
        "00-Bernardo/metodo-de-reflexion-y-limpieza-mental.md",
        "00-Bernardo/articulos-de-sintesis.md",
        "02-Saber/filosofia/",
        "02-Saber/tecnologia/",
      ],
    },
    {
      id: "porque",
      label: "¿Por qué hace lo que hace?",
      hub: "00-Bernardo/por-que-hace-lo-que-hace.md",
      blurb: "Motivaciones declaradas y gustos revelados — y la distancia entre unas y otros.",
      lives: "00-Bernardo/ + el log de decisiones",
      paths: [
        "00-Bernardo/obsesion.md",
        "00-Bernardo/por-que-hace-lo-que-hace.md",
        "03-Journal/decisions.md",
      ],
    },
  ],

  folders: [
    { path: "00-Bernardo/", purpose: "quién es — los hubs, la biografía y las personas" },
    { path: "01-Hacer/", purpose: "qué hace — Veridia, contenido, finanzas, salud" },
    { path: "02-Saber/", purpose: "qué sabe — el árbol de conocimiento" },
    { path: "03-Journal/", purpose: "el histórico — **nunca se reescribe**" },
    { path: "04-Sistema/", purpose: "la maquinaria del AIOS" },
  ],

  indexShallow: ["05-Projects/"],

  articles: {
    notArticles: {
      paths: ["05-Projects/"],
      contains: ["/Templates/"],
    },
    neverCategorised: ["03-Journal/Daily/"],
  },

  defaultOpen: ["00-Bernardo"],

  inbox: "00-Inbox/",

  routing: [
    { when: "material de estudio: apuntes de clase, resúmenes de libros, artículos sobre un tema del mundo", to: "02-Saber/" },
    { when: "trabajo operativo: clientes, proyectos, finanzas, contenido, salud — lo que se hace, no lo que se sabe", to: "01-Hacer/" },
    { when: "escritura personal fechada: diario, reflexiones, notas de un día concreto. NUNCA se reescribe, solo se normaliza el frontmatter", to: "03-Journal/Notes/" },
    { when: "un artículo sobre la propia persona: su biografía, sus motivos, cómo piensa", to: "00-Bernardo/" },
    { when: "un PDF, docx o presentación: se copia tal cual y se le escribe una nota compañera al lado con type: source y resource:", to: "02-Saber/" },
    { when: "cualquier cosa cuya categoría no esté clara tras leerla", to: "00-Inbox/" },
  ],

  categories: [
    {
      id: "arte", label: "Arte",
      blurb: "Obras que dejaron algo: anime, cine, literatura, imagen.",
      paths: ["02-Saber/arte/"], tags: ["arte", "estetica"], notes: [],
    },
    {
      id: "ciencia", label: "Ciencia",
      blurb: "Cómo funciona el mundo, y cómo se cuenta sin romperlo.",
      tags: ["ciencia", "divulgacion"], notes: [],
    },
    {
      id: "contenido", label: "Contenido",
      blurb: "El canal: videos, guiones, storytelling y proceso de producción.",
      pillar: "content", notes: [],
    },
    {
      id: "decisiones", label: "Decisiones",
      blurb: "Bifurcaciones tomadas, con el razonamiento intacto.",
      paths: ["03-Journal/decisions.md"], tags: ["decisiones", "carrera"], notes: [],
    },
    {
      id: "economia", label: "Economía",
      blurb: "Marxismo, banca, estadística y el aparato que mueve el mundo.",
      paths: ["02-Saber/economia/"], tags: ["economia", "marxismo"], notes: [],
    },
    {
      id: "escritos", label: "Escritos",
      blurb: "Escritura libre: pensamientos, borradores y notas sueltas.",
      paths: ["03-Journal/Notes/", "03-Journal/Quotes/"], tags: ["escrito", "ensayo"], notes: [],
    },
    {
      id: "estudio", label: "Estudio",
      blurb: "Lo que estudia porque quiere, no porque se lo pidieron.",
      pillar: "study", notes: [],
    },
    {
      id: "filosofia", label: "Filosofía",
      blurb: "Ética, libertad, conocimiento — y qué hacer con todo eso.",
      paths: ["02-Saber/filosofia/"], tags: ["filosofia", "etica", "estoicismo"], notes: [],
    },
    {
      id: "finanzas", label: "Finanzas",
      blurb: "Dinero que entra, sale, y el que se queda trabajando.",
      pillar: "finance", notes: [],
    },
    {
      id: "fisica", label: "Física",
      blurb: "Antimateria, cosmología, y el gusto por lo que no se ve.",
      paths: ["02-Saber/fisica/"], tags: ["fisica", "cosmologia"], notes: [],
    },
    {
      id: "historia", label: "Historia",
      blurb: "Prehistoria, civilización, y el individuo dentro del proceso.",
      paths: ["02-Saber/Historia/"], tags: ["historia", "prehistoria", "antropologia"], notes: [],
    },
    {
      id: "ia", label: "IA",
      blurb: "Sistemas de IA: qué pueden hacer, qué no, y quién pone la intención.",
      tags: ["ia", "ai", "aios", "ml", "agentes"], notes: [],
    },
    {
      id: "ideas", label: "Ideas",
      blurb: "Conceptos propios: lo leído convertido en argumento defendible.",
      tags: ["concepto", "sintesis", "idea", "ideas"], notes: [],
    },
    {
      id: "libros", label: "Libros",
      blurb: "Lo leído — y lo que quedó después de leerlo.",
      // Por etiqueta y no por carpeta: las obras viven juntas en `02-Saber/arte/`,
      // y un libro que además es historia entra en las dos sin duplicarse.
      // Solo `libro`: `lectura` arrastraba notas *sobre* leer, que no son libros.
      tags: ["libro"], notes: [],
    },
    {
      id: "metodo", label: "Método",
      blurb: "Cómo lee, cómo reflexiona, cómo se organiza el día.",
      tags: ["metodo", "habitos", "reflexion", "productividad", "rutina"], notes: [],
    },
    {
      id: "peliculas", label: "Películas",
      blurb: "Cine y documental, sobre todo como referencia de forma.",
      tags: ["pelicula", "cine", "documental"], notes: [],
    },
    {
      id: "personas", label: "Personas",
      blurb: "Quién aparece en esta historia, y en qué papel.",
      paths: ["00-Bernardo/personas/"], types: ["person"], tags: ["persona"], notes: [],
    },
    {
      id: "politica", label: "Política",
      blurb: "Poder, estados y sistemas — leído sin bandera.",
      paths: ["02-Saber/politica/"], tags: ["politica", "geopolitica"], notes: [],
    },
    {
      id: "salud", label: "Salud",
      blurb: "Cuerpo, sueño y ejercicio como infraestructura, no como hobby.",
      pillar: "health", notes: [],
    },
    {
      id: "series", label: "Series",
      blurb: "Series y anime, y las frases que sobrevivieron al capítulo.",
      tags: ["serie", "anime"], notes: [],
    },
    {
      id: "sistema", label: "Sistema",
      blurb: "La maquinaria del AIOS: el wiki, las conexiones, la spec.",
      paths: ["04-Sistema/"], tags: ["system", "aios"], notes: [],
    },
    {
      id: "tecnologia", label: "Tecnología",
      blurb: "Software, stack, y qué cambia cuando la máquina escribe.",
      paths: ["02-Saber/tecnologia/"], tags: ["tecnologia", "software", "stack"], notes: [],
    },
    {
      id: "veridia", label: "Veridia",
      blurb: "La consultoría: clientes, metodología, pipeline y entrega.",
      // El bundle entero, no solo `pillar: consulting`: los documentos de
      // entrega que viven en Drive rara vez llevan pillar en el frontmatter.
      pillar: "consulting", bundle: "veridia", notes: [],
    },
  ],
};
