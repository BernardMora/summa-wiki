import type { Architecture } from "../architecture.ts";
import { ARCHITECTURE_VERSION } from "../architecture.ts";
import type { Locale } from "../locales.mjs";

/**
 * Identidad — organizada por preguntas sobre quien escribe, no por temas.
 *
 * Va como código de TypeScript y no como JSON leído del disco a propósito. Es
 * el valor por defecto, y un valor por defecto que depende de leer un archivo
 * puede faltar: `import.meta.url` no sobrevive intacto al empaquetado de Next
 * si el archivo no quedó rastreado, y el fallo aparecería al empaquetar el
 * `.app` —justo donde no hay dónde depurarlo— y no al desarrollar.
 *
 * Es un paquete genérico, no el vault de una persona en particular: nace
 * `00-Identidad/`, no `00-<Nombre>/`, y su `rationale` lleva el placeholder
 * `{{name}}` — `scaffold.ts` lo sustituye por el nombre que la persona escribió
 * al crear su vault. La estructura es la misma para cualquiera; quién es, lo
 * dice el contenido, no el paquete.
 *
 * ## Por qué es una función y no una constante
 *
 * Antes era `export const IDENTIDAD`. Ahora se construye por idioma, porque un
 * vault creado con la app en inglés tiene que nacer con carpetas en inglés —
 * `02-Knowledge/`, no `02-Saber/`. Y no se trata de traducir al vuelo: lo que
 * este paquete produce son NOMBRES DE CARPETA que acaban escritos en el disco.
 *
 * De ahí la regla que gobierna todo el idioma en esta app: el paquete se
 * resuelve UNA vez, al crear el vault, y el resultado se congela en
 * `.summa/architecture.json`. Cambiar después el idioma de la interfaz no
 * renombra nada — no podría, sin reescribir todos los enlaces del vault — y
 * tampoco debe: las etiquetas describen carpetas que en el disco se llaman así.
 */

/**
 * Los nombres de carpeta, por idioma.
 *
 * Separados de la prosa porque no son prosa: cada uno de estos valores acaba
 * siendo un directorio real, y aparece además dentro de las rutas de los hubs,
 * de las categorías y del enrutado. Tenerlos en un solo mapa es lo que permite
 * componer todas esas rutas sin repetir el literal — y es lo que hace que
 * renombrar una carpeta del paquete sea un cambio de una línea.
 *
 * Los que ya están en inglés en ambos idiomas (`03-Journal/`, `Notes/`,
 * `Daily/`, `05-Projects/`, `00-Inbox/`) se quedan igual a propósito: son los
 * que el vault original ya tenía así, y cambiarlos en español rompería vaults
 * existentes sin ganar nada.
 */
const DIRS = {
  es: {
    identity: "00-Identidad",
    practice: "01-Hacer",
    knowledge: "02-Saber",
    journal: "03-Journal",
    system: "04-Sistema",
    inbox: "00-Inbox",
    projects: "05-Projects",
    // Subcarpetas
    biography: "biografia",
    people: "personas",
    art: "arte",
    economics: "economia",
    philosophy: "filosofia",
    physics: "fisica",
    history: "Historia",
    politics: "politica",
    technology: "tecnologia",
    notes: "Notes",
    daily: "Daily",
    quotes: "Quotes",
    templates: "Templates",
    // Artículos
    who: "quien-es.md",
    lived: "que-ha-vivido.md",
    knows: "que-sabe.md",
    does: "que-hace.md",
    thinks: "marco-de-pensamiento.md",
    why: "por-que-hace-lo-que-hace.md",
    obsession: "obsesion.md",
    reflection: "metodo-de-reflexion-y-limpieza-mental.md",
    synthesis: "articulos-de-sintesis.md",
    decisions: "decisions.md",
  },
  en: {
    identity: "00-Identity",
    practice: "01-Practice",
    knowledge: "02-Knowledge",
    journal: "03-Journal",
    system: "04-System",
    inbox: "00-Inbox",
    projects: "05-Projects",
    biography: "biography",
    people: "people",
    art: "art",
    economics: "economics",
    philosophy: "philosophy",
    physics: "physics",
    history: "history",
    politics: "politics",
    technology: "technology",
    notes: "Notes",
    daily: "Daily",
    quotes: "Quotes",
    templates: "Templates",
    who: "who-they-are.md",
    lived: "what-theyve-lived.md",
    knows: "what-they-know.md",
    does: "what-they-do.md",
    thinks: "how-they-think.md",
    why: "why-they-do-it.md",
    obsession: "obsession.md",
    reflection: "reflection-method.md",
    synthesis: "synthesis-articles.md",
    decisions: "decisions.md",
  },
} as const;

/** La prosa. Todo lo que se lee y nada que sea una ruta. */
const TEXT = {
  es: {
    name: "Identidad",
    description: "organizado por preguntas sobre quien lo escribe, no por temas.",
    rationale:
      "El vault se organiza por **preguntas**, no por categorías temáticas. " +
      "Las categorías se pudren; las preguntas no: ¿qué sabe {{name}}? seguirá " +
      "siendo la pregunta correcta en diez años. Las categorías de arriba son " +
      "una segunda entrada — un índice por tema encima de la misma estructura, " +
      "no un reemplazo.",
    hubs: {
      lived: { label: "¿Qué ha vivido?", blurb: "Infancia, formación, trabajo, y las personas que lo acompañaron." },
      knows: { label: "¿Qué sabe?", blurb: "El árbol de conocimiento: lo estudiado, lo leído, lo que quedó." },
      does: { label: "¿Qué hace?", blurb: "En qué se le va el día y qué hábitos lo sostienen." },
      thinks: { label: "¿Cómo piensa?", blurb: "Filosofía dominante, fundamentos éticos, contexto e ideas clave." },
      why: { label: "¿Por qué hace lo que hace?", blurb: "Motivaciones declaradas y gustos revelados — y la distancia entre unas y otros." },
    },
    lives: {
      thinks: "artículos de posición, repartidos",
      why: "los artículos de identidad + el log de decisiones",
    },
    folders: {
      identity: "quién es — los hubs, la biografía y las personas",
      practice: "qué hace — trabajo, contenido, finanzas, salud",
      knowledge: "qué sabe — el árbol de conocimiento",
      journal: "el histórico — **nunca se reescribe**",
      system: "la maquinaria del sistema",
    },
    routing: {
      study: "material de estudio: apuntes de clase, resúmenes de libros, artículos sobre un tema del mundo",
      work: "trabajo operativo: clientes, proyectos, finanzas, contenido, salud — lo que se hace, no lo que se sabe",
      diary: "escritura personal fechada: diario, reflexiones, notas de un día concreto. NUNCA se reescribe, solo se normaliza el frontmatter",
      self: "un artículo sobre la propia persona: su biografía, sus motivos, cómo piensa",
      source: "un PDF, docx o presentación: se copia tal cual y se le escribe una nota compañera al lado con type: source y resource:",
      unclear: "cualquier cosa cuya categoría no esté clara tras leerla",
    },
    cats: {
      art: ["Arte", "Obras que dejaron algo: anime, cine, literatura, imagen."],
      science: ["Ciencia", "Cómo funciona el mundo, y cómo se cuenta sin romperlo."],
      content: ["Contenido", "El canal: videos, guiones, storytelling y proceso de producción."],
      decisions: ["Decisiones", "Bifurcaciones tomadas, con el razonamiento intacto."],
      economics: ["Economía", "Mercados, banca, estadística y el aparato que mueve el mundo."],
      writing: ["Escritos", "Escritura libre: pensamientos, borradores y notas sueltas."],
      study: ["Estudio", "Lo que estudia porque quiere, no porque se lo pidieron."],
      philosophy: ["Filosofía", "Ética, libertad, conocimiento — y qué hacer con todo eso."],
      finance: ["Finanzas", "Dinero que entra, sale, y el que se queda trabajando."],
      physics: ["Física", "Antimateria, cosmología, y el gusto por lo que no se ve."],
      history: ["Historia", "Prehistoria, civilización, y el individuo dentro del proceso."],
      ai: ["IA", "Sistemas de IA: qué pueden hacer, qué no, y quién pone la intención."],
      ideas: ["Ideas", "Conceptos propios: lo leído convertido en argumento defendible."],
      books: ["Libros", "Lo leído — y lo que quedó después de leerlo."],
      method: ["Método", "Cómo lee, cómo reflexiona, cómo se organiza el día."],
      film: ["Películas", "Cine y documental, sobre todo como referencia de forma."],
      people: ["Personas", "Quién aparece en esta historia, y en qué papel."],
      politics: ["Política", "Poder, estados y sistemas — leído sin bandera."],
      health: ["Salud", "Cuerpo, sueño y ejercicio como infraestructura, no como hobby."],
      series: ["Series", "Series y anime, y las frases que sobrevivieron al capítulo."],
      system: ["Sistema", "La maquinaria del vault: el wiki, las conexiones, la spec."],
      technology: ["Tecnología", "Software, stack, y qué cambia cuando la máquina escribe."],
      consulting: ["Consultoría", "Trabajo con clientes: metodología, pipeline y entrega."],
    },
  },
  en: {
    name: "Identity",
    description: "organised by questions about the person writing it, not by topic.",
    rationale:
      "This vault is organised by **questions**, not by subject categories. " +
      "Categories rot; questions don't: what does {{name}} know? will still be " +
      "the right question in ten years. The categories above are a second way " +
      "in — a topical index laid over the same structure, not a replacement.",
    hubs: {
      lived: { label: "What have they lived?", blurb: "Childhood, schooling, work, and the people who were there for it." },
      knows: { label: "What do they know?", blurb: "The knowledge tree: what was studied, what was read, what stuck." },
      does: { label: "What do they do?", blurb: "Where the day goes, and which habits hold it up." },
      thinks: { label: "How do they think?", blurb: "Governing philosophy, ethical grounding, context and key ideas." },
      why: { label: "Why do they do it?", blurb: "Stated motives and revealed preferences — and the gap between them." },
    },
    lives: {
      thinks: "position pieces, spread around",
      why: "the identity articles + the decision log",
    },
    folders: {
      identity: "who they are — the hubs, the biography and the people",
      practice: "what they do — work, content, finances, health",
      knowledge: "what they know — the knowledge tree",
      journal: "the record — **never rewritten**",
      system: "the machinery of the system",
    },
    routing: {
      study: "study material: class notes, book summaries, articles about something out in the world",
      work: "operational work: clients, projects, finances, content, health — what gets done, not what is known",
      diary: "dated personal writing: diary, reflections, notes from a specific day. NEVER rewritten, only the frontmatter is normalised",
      self: "an article about the person themselves: their biography, their motives, how they think",
      source: "a PDF, docx or deck: copied as-is, with a companion note written beside it carrying type: source and resource:",
      unclear: "anything whose category is still unclear after reading it",
    },
    cats: {
      art: ["Art", "Works that left something behind: anime, film, literature, image."],
      science: ["Science", "How the world works, and how to tell it without breaking it."],
      content: ["Content", "The channel: videos, scripts, storytelling and production process."],
      decisions: ["Decisions", "Forks taken, with the reasoning left intact."],
      economics: ["Economics", "Markets, banking, statistics and the apparatus that moves the world."],
      writing: ["Writing", "Free writing: thoughts, drafts and loose notes."],
      study: ["Study", "What they study because they want to, not because it was assigned."],
      philosophy: ["Philosophy", "Ethics, freedom, knowledge — and what to do with all of it."],
      finance: ["Finance", "Money coming in, going out, and the money left working."],
      physics: ["Physics", "Antimatter, cosmology, and a taste for what can't be seen."],
      history: ["History", "Prehistory, civilisation, and the individual inside the process."],
      ai: ["AI", "AI systems: what they can do, what they can't, and who supplies the intent."],
      ideas: ["Ideas", "Original concepts: what was read, turned into a defensible argument."],
      books: ["Books", "What was read — and what was left after reading it."],
      method: ["Method", "How they read, how they reflect, how the day gets organised."],
      film: ["Film", "Cinema and documentary, mostly as a reference for form."],
      people: ["People", "Who shows up in this story, and in what role."],
      politics: ["Politics", "Power, states and systems — read without a flag."],
      health: ["Health", "Body, sleep and exercise as infrastructure, not as a hobby."],
      series: ["Series", "Series and anime, and the lines that outlived the episode."],
      system: ["System", "The vault's machinery: the wiki, the connections, the spec."],
      technology: ["Technology", "Software, stack, and what changes when the machine writes."],
      consulting: ["Consulting", "Client work: methodology, pipeline and delivery."],
    },
  },
} as const;

/**
 * El paquete, resuelto para un idioma.
 *
 * Todas las rutas se componen desde `DIRS` en vez de escribirse literales: es lo
 * que garantiza que un renombre de carpeta no deje atrás una categoría
 * apuntando a la ruta vieja, que es exactamente el bug que un paquete duplicado
 * por idioma habría producido tarde o temprano.
 */
export function identidad(locale: Locale): Architecture {
  const d = DIRS[locale] ?? DIRS.en;
  const x = TEXT[locale] ?? TEXT.en;

  const ident = `${d.identity}/`;
  const know = `${d.knowledge}/`;
  const journal = `${d.journal}/`;

  return {
    version: ARCHITECTURE_VERSION,
    id: "identidad",
    name: x.name,
    // Corta a propósito: se usa como subtítulo de la portada Y como texto de la
    // tarjeta en el selector de arquitecturas. Dos renglones no caben en ninguno.
    description: x.description,
    rationale: x.rationale,
    primaryBundle: "personal",

    bundles: [{ id: "personal", root: "", shared: false }],

    centre: `${ident}${d.who}`,

    hubs: [
      {
        id: "vivido",
        label: x.hubs.lived.label,
        hub: `${ident}${d.lived}`,
        blurb: x.hubs.lived.blurb,
        lives: `${ident}${d.biography}/`,
        paths: [`${ident}${d.biography}/`],
      },
      {
        id: "sabe",
        label: x.hubs.knows.label,
        hub: `${ident}${d.knows}`,
        blurb: x.hubs.knows.blurb,
        lives: know,
        paths: [know],
      },
      {
        id: "hace",
        label: x.hubs.does.label,
        hub: `${ident}${d.does}`,
        blurb: x.hubs.does.blurb,
        lives: `${d.practice}/`,
        paths: [`${d.practice}/`],
      },
      {
        id: "piensa",
        label: x.hubs.thinks.label,
        hub: `${ident}${d.thinks}`,
        blurb: x.hubs.thinks.blurb,
        lives: x.lives.thinks,
        paths: [
          `${ident}${d.thinks}`,
          `${ident}${d.reflection}`,
          `${ident}${d.synthesis}`,
          `${know}${d.philosophy}/`,
          `${know}${d.technology}/`,
        ],
      },
      {
        id: "porque",
        label: x.hubs.why.label,
        hub: `${ident}${d.why}`,
        blurb: x.hubs.why.blurb,
        lives: x.lives.why,
        paths: [
          `${ident}${d.obsession}`,
          `${ident}${d.why}`,
          `${journal}${d.decisions}`,
        ],
      },
    ],

    folders: [
      { path: ident, purpose: x.folders.identity },
      { path: `${d.practice}/`, purpose: x.folders.practice },
      { path: know, purpose: x.folders.knowledge },
      { path: journal, purpose: x.folders.journal },
      { path: `${d.system}/`, purpose: x.folders.system },
    ],

    indexShallow: [`${d.projects}/`],

    articles: {
      notArticles: {
        paths: [`${d.projects}/`],
        contains: [`/${d.templates}/`],
      },
      neverCategorised: [`${journal}${d.daily}/`],
    },

    defaultOpen: [d.identity],

    inbox: `${d.inbox}/`,

    routing: [
      { when: x.routing.study, to: know },
      { when: x.routing.work, to: `${d.practice}/` },
      { when: x.routing.diary, to: `${journal}${d.notes}/` },
      { when: x.routing.self, to: ident },
      { when: x.routing.source, to: know },
      { when: x.routing.unclear, to: `${d.inbox}/` },
    ],

    categories: [
      { id: "arte", label: x.cats.art[0], blurb: x.cats.art[1],
        paths: [`${know}${d.art}/`], tags: ["arte", "art", "estetica", "aesthetics"], notes: [] },
      { id: "ciencia", label: x.cats.science[0], blurb: x.cats.science[1],
        tags: ["ciencia", "science", "divulgacion"], notes: [] },
      { id: "contenido", label: x.cats.content[0], blurb: x.cats.content[1],
        pillar: "content", notes: [] },
      { id: "decisiones", label: x.cats.decisions[0], blurb: x.cats.decisions[1],
        paths: [`${journal}${d.decisions}`], tags: ["decisiones", "decisions", "carrera", "career"], notes: [] },
      { id: "economia", label: x.cats.economics[0], blurb: x.cats.economics[1],
        paths: [`${know}${d.economics}/`], tags: ["economia", "economics"], notes: [] },
      { id: "escritos", label: x.cats.writing[0], blurb: x.cats.writing[1],
        paths: [`${journal}${d.notes}/`, `${journal}${d.quotes}/`],
        tags: ["escrito", "writing", "ensayo", "essay"], notes: [] },
      { id: "estudio", label: x.cats.study[0], blurb: x.cats.study[1],
        pillar: "study", notes: [] },
      { id: "filosofia", label: x.cats.philosophy[0], blurb: x.cats.philosophy[1],
        paths: [`${know}${d.philosophy}/`],
        tags: ["filosofia", "philosophy", "etica", "ethics", "estoicismo", "stoicism"], notes: [] },
      { id: "finanzas", label: x.cats.finance[0], blurb: x.cats.finance[1],
        pillar: "finance", notes: [] },
      { id: "fisica", label: x.cats.physics[0], blurb: x.cats.physics[1],
        paths: [`${know}${d.physics}/`], tags: ["fisica", "physics", "cosmologia", "cosmology"], notes: [] },
      { id: "historia", label: x.cats.history[0], blurb: x.cats.history[1],
        paths: [`${know}${d.history}/`],
        tags: ["historia", "history", "prehistoria", "prehistory", "antropologia", "anthropology"], notes: [] },
      { id: "ia", label: x.cats.ai[0], blurb: x.cats.ai[1],
        tags: ["ia", "ai", "aios", "ml", "agentes", "agents"], notes: [] },
      { id: "ideas", label: x.cats.ideas[0], blurb: x.cats.ideas[1],
        tags: ["concepto", "concept", "sintesis", "synthesis", "idea", "ideas"], notes: [] },
      // Por etiqueta y no por carpeta: las obras viven juntas en la carpeta de
      // arte, y un libro que además es historia entra en las dos sin duplicarse.
      // Solo `libro`/`book`: `lectura` arrastraba notas *sobre* leer, que no son libros.
      { id: "libros", label: x.cats.books[0], blurb: x.cats.books[1],
        tags: ["libro", "book"], notes: [] },
      { id: "metodo", label: x.cats.method[0], blurb: x.cats.method[1],
        tags: ["metodo", "method", "habitos", "habits", "reflexion", "reflection", "productividad", "productivity", "rutina", "routine"], notes: [] },
      { id: "peliculas", label: x.cats.film[0], blurb: x.cats.film[1],
        tags: ["pelicula", "film", "cine", "cinema", "documental", "documentary"], notes: [] },
      { id: "personas", label: x.cats.people[0], blurb: x.cats.people[1],
        paths: [`${ident}${d.people}/`], types: ["person"], tags: ["persona", "person"], notes: [] },
      { id: "politica", label: x.cats.politics[0], blurb: x.cats.politics[1],
        paths: [`${know}${d.politics}/`], tags: ["politica", "politics", "geopolitica", "geopolitics"], notes: [] },
      { id: "salud", label: x.cats.health[0], blurb: x.cats.health[1],
        pillar: "health", notes: [] },
      { id: "series", label: x.cats.series[0], blurb: x.cats.series[1],
        tags: ["serie", "series", "anime"], notes: [] },
      { id: "sistema", label: x.cats.system[0], blurb: x.cats.system[1],
        paths: [`${d.system}/`], tags: ["system", "sistema", "aios"], notes: [] },
      { id: "tecnologia", label: x.cats.technology[0], blurb: x.cats.technology[1],
        paths: [`${know}${d.technology}/`],
        tags: ["tecnologia", "technology", "software", "stack"], notes: [] },
      { id: "consultoria", label: x.cats.consulting[0], blurb: x.cats.consulting[1],
        pillar: "consulting", notes: [] },
    ],
  };
}
