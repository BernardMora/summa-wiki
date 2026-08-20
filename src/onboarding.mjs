import fs from "node:fs";
import path from "node:path";
import { readSettings, userDataDir, writeSettings } from "./appdata.mjs";

export const ONBOARDING_VERSION = 1;
export const DEMO_VERSION = 2;

const TEXT = {
  es: {
    name: "Wiki de ejemplo de Alex",
    tagline: "Una vida conectada, no una colección de carpetas",
    start: "Empieza aquí",
    intro: "Este es el vault ficticio de Alex Rivera. Contiene trabajo, aprendizaje, finanzas, salud, relaciones y reflexiones conectadas para que puedas probar Summa sin tocar tus archivos.",
    next: "Abre otras notas en pestañas, edita este párrafo y explora las marcas de autoría. Todo lo que cambies aquí se puede restaurar.",
  },
  en: {
    name: "Alex's example wiki",
    tagline: "A connected life, not a collection of folders",
    start: "Start here",
    intro: "This is Alex Rivera's fictional vault. It connects work, learning, finances, health, relationships, and reflections so you can try Summa without touching your files.",
    next: "Open other notes in tabs, edit this paragraph, and explore authorship marks. Everything you change here can be restored.",
  },
};

const localDate = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const fm = (type, title, author = "human", pillar = "other", priority = "medium") => {
  // Compatibilidad interna con las llamadas que declaran ambos campos como
  // fragmento: se normalizan antes de escribir para no duplicar frontmatter.
  if (pillar.startsWith("pillar:")) {
    priority = pillar.match(/priority:\s*(\w+)/)?.[1] ?? priority;
    pillar = pillar.match(/pillar:\s*(\w+)/)?.[1] ?? "other";
  }
  return `---\ntype: ${type}\ntitle: ${title}\ncreated: ${localDate()}\nupdated: ${localDate()}\nauthor: ${author}\npillar: ${pillar}\nstatus: active\npriority: ${priority}\ntags: [demo/example]\n---\n\n`;
};

function localizedNotes(locale) {
  const es = locale === "es";
  const t = TEXT[locale];
  const notes = {
    "00-Alex/empieza-aqui.md": fm("moc", t.start, "mixed") + `# ${t.start}\n\n${t.intro}\n\n<!-- ai -->\n${t.next}\n<!-- /ai -->\n\n## ${es ? "Un hilo que cruza el vault" : "A thread across the vault"}\n\n${es ? "Alex está considerando convertir su práctica independiente en un estudio creativo. La decisión depende de su trabajo, sus finanzas, su energía, sus relaciones y sus valores." : "Alex is considering turning an independent practice into a creative studio. The decision depends on work, finances, energy, relationships, and values."}\n`,
    "00-Alex/quien-es-alex.md": fm("person", es ? "Quién es Alex" : "Who Alex is") + `# ${es ? "Quién es Alex" : "Who Alex is"}\n\n${es ? "Alex Rivera tiene 31 años y trabaja como diseñadora de producto independiente. Valora la autonomía, la estabilidad financiera, la curiosidad y el tiempo con las personas importantes." : "Alex Rivera is 31 and works as an independent product designer. Alex values autonomy, financial stability, curiosity, and time with important people."}\n\n## ${es ? "Cómo decide" : "How Alex decides"}\n\n- ${es ? "Prefiere experimentos reversibles antes que apuestas enormes." : "Prefers reversible experiments over enormous bets."}\n- ${es ? "No quiere crecer a costa de su salud o sus relaciones." : "Does not want growth at the expense of health or relationships."}\n`,
    "01-Vida/01-Trabajo/estudio-creativo/estudio-creativo.md": fm("project", es ? "Estudio creativo" : "Creative studio", "mixed", "pillar: consulting\npriority: high\n") + `# ${es ? "Estudio creativo" : "Creative studio"}\n\n${es ? "Alex estudia convertir su práctica independiente en un estudio pequeño durante los próximos seis meses." : "Alex is exploring turning an independent practice into a small studio over the next six months."}\n\n<!-- ai -->\n${es ? "Hipótesis: contratar apoyo operativo liberaría diez horas semanales. Esta cifra todavía no está respaldada por un registro de tiempo." : "Hypothesis: hiring operational support would free ten hours per week. This figure is not yet supported by a time log."}\n<!-- /ai -->\n\n## ${es ? "Próximas acciones" : "Next actions"}\n\n- [ ] ${es ? "Revisar el fondo de emergencia." : "Review the emergency fund."}\n- [ ] ${es ? "Comparar tres modelos de operación." : "Compare three operating models."}\n`,
    "01-Vida/01-Trabajo/clientes/cliente-orbita.md": fm("project", es ? "Cliente Órbita" : "Orbit client", "human", "pillar: consulting\n") + `# ${es ? "Cliente Órbita" : "Orbit client"}\n\n${es ? "Proyecto de investigación y rediseño. Las reuniones se concentran los martes y suelen dejar poco tiempo para trabajo profundo." : "Research and redesign project. Meetings cluster on Tuesdays and often leave little time for deep work."}\n`,
    "01-Vida/02-Aprendizaje/habitos-y-motivacion.md": fm("knowledge", es ? "Hábitos y motivación" : "Habits and motivation", "mixed", "pillar: study\n") + `# ${es ? "Hábitos y motivación" : "Habits and motivation"}\n\n${es ? "La conducta depende menos de fuerza de voluntad aislada y más del contexto, la fricción y las señales disponibles." : "Behavior depends less on isolated willpower and more on context, friction, and available cues."}\n\n<!-- ai -->\n${es ? "Conexión posible: aplicar este marco a la rutina de trabajo de Alex y al borrador sobre sistemas personales." : "Possible connection: apply this framework to Alex's work routine and the draft about personal systems."}\n<!-- /ai -->\n`,
    "01-Vida/03-Finanzas/fondo-de-emergencia.md": fm("area", es ? "Fondo de emergencia" : "Emergency fund", "human", "pillar: finance\n") + `# ${es ? "Fondo de emergencia" : "Emergency fund"}\n\n- ${es ? "Meta" : "Target"}: $18,000\n- ${es ? "Actual" : "Current"}: $11,400\n- ${es ? "Meses cubiertos" : "Months covered"}: 3.8\n\n${es ? "Alex había decidido no asumir nuevos costos fijos antes de cubrir seis meses, pero esa regla aún no aparece en el proyecto del estudio." : "Alex had decided not to add fixed costs before covering six months, but that rule is not yet reflected in the studio project."}\n`,
    "01-Vida/04-Salud/registro-de-energia.md": fm("journal", es ? "Registro de energía" : "Energy log", "human", "pillar: health\n") + `# ${es ? "Registro de energía" : "Energy log"}\n\n- ${es ? "Lunes: 8/10, trabajo profundo por la mañana." : "Monday: 8/10, deep work in the morning."}\n- ${es ? "Martes: 4/10, cinco reuniones." : "Tuesday: 4/10, five meetings."}\n- ${es ? "Miércoles: 6/10, sueño corto." : "Wednesday: 6/10, short sleep."}\n\n${es ? "Tres observaciones no bastan para establecer una causa." : "Three observations are not enough to establish a cause."}\n`,
    "01-Vida/05-Relaciones/compromisos.md": fm("area", es ? "Relaciones y compromisos" : "Relationships and commitments") + `# ${es ? "Relaciones y compromisos" : "Relationships and commitments"}\n\n${es ? "Alex reserva los jueves por la noche para amistades y una visita familiar al mes. El estudio no debería convertir esos espacios en tiempo residual." : "Alex reserves Thursday evenings for friends and one family visit each month. The studio should not turn those spaces into leftover time."}\n`,
    "01-Vida/07-Contenido/borradores/disenar-mejores-habitos.md": fm("knowledge", es ? "Diseñar mejores hábitos" : "Designing better habits", "human", "pillar: content\n") + `# ${es ? "Diseñar mejores hábitos" : "Designing better habits"}\n\n${es ? "Borrador: muchas rutinas fallan porque intentamos cambiar a la persona sin cambiar el entorno." : "Draft: many routines fail because we try to change the person without changing the environment."}\n\n![${es ? "Tablero visual" : "Visual board"}](../../assets/tablero-visual.svg "[wide] ${es ? "Referencias del proceso creativo" : "Creative process references"}")\n`,
    "02-Saber/sistemas-personales.md": fm("knowledge", es ? "Sistemas personales" : "Personal systems", "mixed", "pillar: study\n") + `# ${es ? "Sistemas personales" : "Personal systems"}\n\n${es ? "Un buen sistema reduce decisiones repetitivas sin borrar la capacidad de elegir." : "A good system reduces repeated decisions without removing the ability to choose."}\n\n<!-- ai -->\n${es ? "Esta idea aparece también en varias entradas del journal." : "This idea also appears in several journal entries."}\n<!-- /ai -->\n`,
    "03-Journal/Daily/2026-07-09.md": fm("journal", "2026-07-09") + `# 2026-07-09\n\n${es ? "Terminé cansada después de encadenar reuniones. Pensé otra vez que necesito un sistema que proteja las mañanas, no más disciplina." : "I finished tired after back-to-back meetings. I thought again that I need a system that protects mornings, not more discipline."}\n`,
    "03-Journal/Daily/2026-07-15.md": fm("journal", "2026-07-15") + `# 2026-07-15\n\n${es ? "La idea del estudio entusiasma, pero no quiero que cada mes dependa de vender más. Tal vez deba probar primero con una colaboradora por proyecto." : "The studio idea is exciting, but I do not want every month to depend on selling more. Maybe I should first test working with a project-based collaborator."}\n`,
    "03-Journal/decisions.md": fm("journal", es ? "Registro de decisiones" : "Decision log") + `# ${es ? "Registro de decisiones" : "Decision log"}\n\n## 2026-07-18\n\n${es ? "No asumir nuevos costos fijos hasta cubrir seis meses de gastos. Revisar de nuevo en octubre." : "Do not add fixed costs until six months of expenses are covered. Review again in October."}\n`,
    "04-Sistema/inbox.md": fm("system", "Inbox") + `# Inbox\n\n- ${es ? "Investigar colaboraciones por proyecto." : "Research project-based collaboration."}\n- ${es ? "¿Conectar hábitos con diseño de servicios?" : "Connect habits with service design?"}\n- ${es ? "Idea sin clasificar: reducir fricción antes de pedir motivación." : "Unsorted idea: reduce friction before asking for motivation."}\n`,
  };
  notes["00-Alex/empieza-aqui.md"] += `\n## ${es ? "Explora las conexiones" : "Explore the connections"}\n\n- [${es ? "Estudio creativo" : "Creative studio"}](../01-Vida/01-Trabajo/estudio-creativo/estudio-creativo.md)\n- [${es ? "Fondo de emergencia" : "Emergency fund"}](../01-Vida/03-Finanzas/fondo-de-emergencia.md)\n- [${es ? "Registro de energía" : "Energy log"}](../01-Vida/04-Salud/registro-de-energia.md)\n- [${es ? "Sistemas personales" : "Personal systems"}](../02-Saber/sistemas-personales.md)\n`;
  notes["01-Vida/01-Trabajo/estudio-creativo/estudio-creativo.md"] += `\n## ${es ? "Contexto relacionado" : "Related context"}\n\n- [${es ? "Fondo de emergencia" : "Emergency fund"}](../../03-Finanzas/fondo-de-emergencia.md)\n- [${es ? "Registro de decisiones" : "Decision log"}](../../../03-Journal/decisions.md)\n- [${es ? "Quién es Alex" : "Who Alex is"}](../../../00-Alex/quien-es-alex.md)\n`;
  notes["02-Saber/sistemas-personales.md"] += `\n## ${es ? "Ecos" : "Echoes"}\n\n- [2026-07-09](../03-Journal/Daily/2026-07-09.md)\n- [${es ? "Hábitos y motivación" : "Habits and motivation"}](../01-Vida/02-Aprendizaje/habitos-y-motivacion.md)\n`;
  return notes;
}

function agentsFile(locale) {
  const es = locale === "es";
  return `# ${es ? "Wiki de ejemplo de Alex" : "Alex's example wiki"}\n\n${es ? "Este vault pertenece a Alex Rivera, una persona ficticia." : "This vault belongs to Alex Rivera, a fictional person."}\n\n## ${es ? "Reglas" : "Rules"}\n\n- ${es ? "Distingue hechos, inferencias y preguntas abiertas." : "Distinguish facts, inferences, and open questions."}\n- ${es ? "No tomes decisiones por Alex." : "Do not make decisions for Alex."}\n- ${es ? "No envíes, publiques ni borres sin autorización explícita." : "Do not send, publish, or delete without explicit authorization."}\n- ${es ? "Marca las adiciones del agente con comentarios de apertura y cierre ai." : "Mark agent additions with opening and closing ai comments."}\n- ${es ? "El conocimiento vive en su ámbito; el inbox es temporal." : "Knowledge lives in its domain; the inbox is temporary."}\n`;
}

function skillFile(locale, kind) {
  const es = locale === "es";
  const title = kind === "decision-brief" ? (es ? "Brief de decisión" : "Decision brief") : (es ? "Revisión semanal" : "Weekly review");
  return `---\nname: ${kind}\ndescription: ${title}\n---\n\n# ${title}\n\n1. ${es ? "Reúne evidencia de los ámbitos relevantes." : "Collect evidence from relevant domains."}\n2. ${es ? "Separa hechos, inferencias, contradicciones y preguntas." : "Separate facts, inferences, contradictions, and questions."}\n3. ${es ? "Propón próximas acciones reversibles." : "Propose reversible next actions."}\n4. ${es ? "No modifiques archivos sin aprobación." : "Do not modify files without approval."}\n`;
}

function configFiles(locale) {
  const t = TEXT[locale];
  const design = readSettings().onboarding.design;
  return {
    ".summa/config.json": JSON.stringify({ name: t.name, tagline: t.tagline, icon: null }, null, 2) + "\n",
    ".summa/architecture.json": JSON.stringify({ id: "demo-alex", name: t.name, description: t.tagline, centre: "00-Alex/empieza-aqui.md", folders: [], hubs: [], categories: [] }, null, 2) + "\n",
    ".summa/categories.json": JSON.stringify({ categories: [] }, null, 2) + "\n",
    ".summa/demo.json": JSON.stringify({ templateVersion: DEMO_VERSION, locale, fictional: true }, null, 2) + "\n",
    ".summa/appearance.json": JSON.stringify({ version: 1, activePreset: design, mode: readSettings().onboarding.mode, overrides: { typography: null, palette: null, buttons: null }, customPresets: [] }, null, 2) + "\n",
  };
}

function writeFiles(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body, "utf8");
  }
}

export function exampleVaultPath(locale) {
  return path.join(userDataDir(), "demo-vaults", `example-alex-${locale}`);
}

export function createExampleVault(locale = "es", { reset = false } = {}) {
  const lang = locale === "en" ? "en" : "es";
  const root = exampleVaultPath(lang);
  let installedVersion = 0;
  try { installedVersion = JSON.parse(fs.readFileSync(path.join(root, ".summa", "demo.json"), "utf8")).templateVersion ?? 0; } catch {}
  // El demo es propiedad de Summa y vive en una ruta dedicada. Cuando cambia
  // la plantilla se reemplaza automáticamente para que sus instrucciones y
  // su estructura nunca se contradigan.
  if ((reset || installedVersion !== DEMO_VERSION) && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  writeFiles(root, {
    ...localizedNotes(lang),
    ...configFiles(lang),
    "AGENTS.md": agentsFile(lang),
    "skills/decision-brief/SKILL.md": skillFile(lang, "decision-brief"),
    "skills/weekly-review/SKILL.md": skillFile(lang, "weekly-review"),
    "01-Vida/07-Contenido/assets/tablero-visual.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f2eadf"/><circle cx="330" cy="330" r="150" fill="#9e6b4a"/><rect x="570" y="155" width="390" height="365" rx="28" fill="#20352f"/><path d="M210 520 C430 380 650 610 990 330" fill="none" stroke="#d49768" stroke-width="18"/><text x="600" y="345" text-anchor="middle" font-family="serif" font-size="54" fill="#fffaf3">ALEX</text></svg>\n`,
    "01-Vida/03-Finanzas/movimientos-2026.csv": "date,category,amount\n2026-07-01,client-income,4200\n2026-07-03,rent,-1450\n2026-07-08,software,-84\n2026-07-15,client-income,3100\n",
  });
  writeSettings({ demoVault: { path: root, locale: lang, templateVersion: DEMO_VERSION } });
  return { path: root, locale: lang, templateVersion: DEMO_VERSION };
}

export function patchOnboarding(patch) {
  const settings = writeSettings({});
  const current = settings.onboarding;
  const next = {
    ...current,
    ...patch,
    completed: Array.isArray(patch.completed) ? patch.completed : current.completed,
    skipped: Array.isArray(patch.skipped) ? patch.skipped : current.skipped,
  };
  return writeSettings({ onboarding: next }).onboarding;
}
