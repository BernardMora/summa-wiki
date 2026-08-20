"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { openInWorkspace, newTermId } from "../Tabs.tsx";
import { runInNewTerminal } from "../TerminalPane.tsx";
import { AGENTS, promptCommand } from "../agent-session.ts";

const LESSONS = [
  { id: "navigate", target: '[data-tour="file-tree"]', title: { es: "Navega el contexto", en: "Navigate the context" }, body: { es: "Abre “Estudio creativo” y después “Fondo de emergencia” desde el árbol. El recorrido avanzará cuando hayas abierto ambas notas.", en: "Open “Creative studio” and then “Emergency fund” from the tree. The tour will continue after you open both notes." } },
  { id: "create", target: '[data-tour="tree-create-actions"]', title: { es: "Crea tu contexto", en: "Create your context" }, body: { es: "Los botones fijos del explorador crean una carpeta, una nota con frontmatter YAML o un canvas dentro de la carpeta seleccionada. Si no seleccionas ninguna, se crean en la raíz.", en: "The explorer's fixed buttons create a folder, a note with YAML frontmatter, or a canvas inside the selected folder. With no folder selected, they are created at the root." } },
  { id: "file-context", target: '[data-tour="file-tree"]', title: { es: "Acciones de un archivo", en: "File actions" }, body: { es: "Haz clic derecho sobre una nota del árbol. Desde su menú puedes añadirla a una conversación, abrirla al lado, fijarla a una categoría, copiar sus rutas, renombrarla o borrarla.", en: "Right-click a note in the tree. Its menu lets you add it to a conversation, open it beside another file, pin it to a category, copy its paths, rename it, or delete it." } },
  { id: "open-beside", target: '[data-tour="file-open-beside"]', title: { es: "Abre contexto en paralelo", en: "Open context side by side" }, body: { es: "Selecciona “Abrir al lado”. Summa creará otro panel para comparar el archivo con la nota que ya está abierta.", en: "Choose “Open beside.” Summa will create another pane so you can compare the file with the note already open." } },
  { id: "tab-context", target: '[data-tour="workspace-tabs"]', title: { es: "Acciones de una pestaña", en: "Tab actions" }, body: { es: "Haz clic derecho sobre una pestaña. Su menú permite enviarla a un panel derecho o inferior, añadir su archivo a una conversación y cerrarla.", en: "Right-click a tab. Its menu lets you send it to a right or lower pane, add its file to a conversation, or close it." } },
  { id: "split-down", target: '[data-tour="tab-split-down"]', title: { es: "Envía la pestaña abajo", en: "Send the tab below" }, body: { es: "Selecciona “Enviar pestaña a un panel debajo” para crear una segunda sección vertical dentro de esta columna.", en: "Choose “Send tab to a pane below” to create a second vertical section in this column." } },
  { id: "edit", target: '[data-tour="editor-area"]', title: { es: "Edita una nota", en: "Edit a note" }, body: { es: "Cambia una frase en la nota abierta. El vault de ejemplo se puede restaurar, así que puedes experimentar con libertad.", en: "Change a sentence in the open note. The example vault can be reset, so you can experiment freely." } },
  { id: "authorship", target: '[data-tour="editor-toolbar"]', title: { es: "Distingue autoría", en: "Distinguish authorship" }, body: { es: "La barra permite añadir títulos, negritas, cursivas, subrayado, listas, enlaces, citas, colores y otros formatos. Selecciona un fragmento y usa también los controles de autoría para marcarlo como humano o IA.", en: "The toolbar lets you add headings, bold, italic, underline, lists, links, quotes, colors, and other formatting. Select a passage and also use the authorship controls to mark it as human or AI." } },
  { id: "media", target: '[data-tour="media-tools"]', title: { es: "Trabaja con recursos", en: "Work with media" }, body: { es: "Usa el control resaltado para insertar una imagen o un video en la nota.", en: "Use the highlighted controls to insert an image or video into the note." } },
  { id: "orchestration", target: '[data-tour="file-tree"]', title: { es: "Contexto para agentes", en: "Context for agents" }, body: { es: "Abre AGENTS.md desde la raíz o explora la carpeta visible skills/. Estos archivos explican al agente qué contexto debe respetar y cómo ejecutar procesos específicos.", en: "Open AGENTS.md from the root or explore the visible skills/ folder. These files tell the agent which context to respect and how to run specific processes." } },
  { id: "terminal", target: '[data-tour="new-terminal"]', title: { es: "Pregunta al vault con IA", en: "Query the vault with AI" }, body: { es: "Inicia el agente que elegiste con una pregunta en lenguaje natural. Observa en la terminal cómo recorre distintos archivos, reúne evidencia y construye una respuesta con el contexto del vault.", en: "Start your selected agent with a natural-language question. Watch the terminal as it explores files, gathers evidence, and builds an answer using the vault context." } },
  { id: "add-to-chat", target: '[data-tour="workspace-tabs"]', title: { es: "Añade un archivo a la conversación", en: "Add a file to the conversation" }, body: { es: "Ahora que hay una conversación abierta, haz clic derecho sobre una pestaña de nota y elige “Agregar al chat”. Summa escribirá la ruta del archivo en la terminal activa para que el agente pueda usar ese contexto.", en: "Now that a conversation is open, right-click a note tab and choose “Add to chat.” Summa will type the file path into the active terminal so the agent can use that context." } },
  { id: "ai", target: '[data-tour="agent-menu"]', title: { es: "Trabaja con un agente", en: "Work with an agent" }, body: { es: "Abre el menú de IA. Desde ahí puedes pedir un brief que separe hechos, inferencias, contradicciones y preguntas.", en: "Open the AI menu. From there you can request a brief separating facts, inferences, contradictions, and questions." }, requiresAi: true },
] as const;

type Rect = { left: number; top: number; width: number; height: number };
type Point = { left: number; top: number };

export default function DemoGuide({ locale, initialLesson, completed, skipped, aiConfigured, agent, model, vaultPath }: { locale: "es" | "en"; initialLesson: string | null; completed: string[]; skipped: string[]; aiConfigured: boolean; agent: string | null; model: string; vaultPath: string }) {
  const start = Math.max(0, LESSONS.findIndex((l) => l.id === initialLesson));
  const [index, setIndex] = useState(start);
  const [hidden, setHidden] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [navigationProgress, setNavigationProgress] = useState(0);
  const [terminalStarted, setTerminalStarted] = useState(false);
  const [chatMenuOpened, setChatMenuOpened] = useState(false);
  const [manualPosition, setManualPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [newTabModifier, setNewTabModifier] = useState("Ctrl");
  const cardRef = useRef<HTMLElement>(null);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const pendingPointer = useRef<{ x: number; y: number } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const done = useRef(new Set(completed));
  const omitted = useRef(new Set(skipped));
  const advancing = useRef(false);
  const lesson = LESSONS[index];
  const lessonTarget = lesson.id === "terminal" && terminalStarted
    ? '[data-tour="terminal-pane"]'
    : lesson.id === "add-to-chat" && chatMenuOpened
      ? '[data-tour="tab-add-chat"]'
      : lesson.target;

  useEffect(() => {
    setNewTabModifier(/Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl");
  }, []);

  const clampPosition = useCallback((left: number, top: number): Point => {
    const card = cardRef.current;
    const width = card?.offsetWidth ?? 390;
    const height = card?.offsetHeight ?? 260;
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
    };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragOrigin.current) return;
      pendingPointer.current = { x: event.clientX, y: event.clientY };
      if (dragFrame.current !== null) return;
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        const origin = dragOrigin.current;
        const pointer = pendingPointer.current;
        const card = cardRef.current;
        if (!origin || !pointer || !card) return;
        const next = clampPosition(origin.left + pointer.x - origin.pointerX, origin.top + pointer.y - origin.pointerY);
        card.style.transform = `translate3d(${next.left - origin.left}px, ${next.top - origin.top}px, 0)`;
      });
    };
    const stop = () => {
      const card = cardRef.current;
      const origin = dragOrigin.current;
      const pointer = pendingPointer.current;
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
      if (card && origin && pointer) {
        const next = clampPosition(origin.left + pointer.x - origin.pointerX, origin.top + pointer.y - origin.pointerY);
        card.style.transform = "";
        setManualPosition(next);
      }
      dragOrigin.current = null;
      pendingPointer.current = null;
      setDragging(false);
    };
    const resize = () => setManualPosition((current) => current ? clampPosition(current.left, current.top) : null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("resize", resize);
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    };
  }, [clampPosition]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button")) return;
    const card = cardRef.current;
    if (!card) return;
    const current = card.getBoundingClientRect();
    dragOrigin.current = { pointerX: event.clientX, pointerY: event.clientY, left: current.left, top: current.top };
    pendingPointer.current = { x: event.clientX, y: event.clientY };
    setManualPosition({ left: current.left, top: current.top });
    setDragging(true);
    event.preventDefault();
  }

  const persist = useCallback(async (next: number, kind?: "complete" | "skip") => {
    if (advancing.current) return;
    advancing.current = true;
    if (kind === "complete") done.current.add(LESSONS[index].id);
    if (kind === "skip") omitted.current.add(LESSONS[index].id);
    const finished = next >= LESSONS.length;
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "state", stage: finished ? "vault" : "demo", lesson: finished ? null : LESSONS[next].id, completed: [...done.current], skipped: [...omitted.current] }) });
    if (finished) { location.href = "/onboarding"; return; }
    setNavigationProgress(0);
    setChatMenuOpened(false);
    setIndex(next);
    advancing.current = false;
  }, [index]);

  useEffect(() => {
    if (hidden) { setRect(null); return; }
    const update = () => {
      const element = document.querySelector(lessonTarget);
      if (!element) { setRect(null); return; }
      const next = element.getBoundingClientRect();
      setRect({ left: Math.max(4, next.left - 6), top: Math.max(4, next.top - 6), width: next.width + 12, height: next.height + 12 });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [hidden, lessonTarget, index]);

  useEffect(() => {
    const complete = () => { void persist(index + 1, "complete"); };
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      const path = element.closest<HTMLElement>("[data-tour-path]")?.dataset.tourPath?.toLowerCase() || "";
      if (lesson.id === "navigate" && path) {
        const creative = path.includes("estudio-creativo");
        const emergency = path.includes("fondo-de-emergencia");
        if (creative) { sessionStorage.setItem("summa-tour-creative", "1"); setNavigationProgress(1); }
        if (emergency && sessionStorage.getItem("summa-tour-creative") === "1") complete();
      }
      if (lesson.id === "authorship" && element.closest('[data-tour="authorship-human"], [data-tour="authorship-ai"]')) complete();
      if (lesson.id === "media" && element.closest('[data-tour="insert-image"], [data-tour="insert-video"]')) complete();
      if (lesson.id === "orchestration" && (path.endsWith("agents.md") || path.endsWith("skill.md"))) complete();
      if (lesson.id === "open-beside" && element.closest('[data-tour="file-open-beside"]')) complete();
      if (lesson.id === "split-down" && element.closest('[data-tour="tab-split-down"]')) complete();
      if (lesson.id === "add-to-chat" && element.closest('[data-tour="tab-add-chat"]')) complete();
      if (lesson.id === "ai" && element.closest('[data-tour="agent-menu"]')) complete();
    };
    const onContextMenu = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (lesson.id === "file-context" && element?.closest("[data-tour-path]")) complete();
      if (lesson.id === "tab-context" && element?.closest('[data-tour="workspace-tab"]')) complete();
      if (lesson.id === "add-to-chat" && element?.closest('[data-tour="workspace-tab"]')) {
        // Abrir el menú es solo el primer gesto; el foco pasa a su acción y la
        // lección termina únicamente cuando esa acción se ejecuta.
        setChatMenuOpened(true);
      }
    };
    const onEdit = (event: Event) => {
      if (lesson.id === "edit" && event.target instanceof Element && event.target.closest('[data-tour="editor-area"]')) complete();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("input", onEdit, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("contextmenu", onContextMenu, true); document.removeEventListener("input", onEdit, true); };
  }, [index, lesson.id, persist]);

  function terminalPreset() {
    if (!aiConfigured || !agent) return;
    const prompt = locale === "es"
      ? "Analiza este vault y responde: ¿qué tensión existe entre el plan de abrir el estudio creativo, el fondo de emergencia y el registro de energía de Alex? Cita las rutas de los archivos que sustentan cada hallazgo, separa hechos de inferencias y no modifiques ningún archivo."
      : "Analyze this vault and answer: what tension exists between Alex's plan to open the creative studio, emergency fund, and energy log? Cite the file paths supporting each finding, separate facts from inferences, and do not modify any files.";
    const id = newTermId();
    runInNewTerminal(id, promptCommand(agent, model, prompt), vaultPath);
    openInWorkspace(id, locale === "es" ? "Consulta del vault" : "Vault query", true);
    setTerminalStarted(true);
  }

  if (hidden) return <button className="tour-restore" onClick={() => setHidden(false)}>Demo · {index + 1}/{LESSONS.length}</button>;
  const cardSide = lesson.id === "terminal" && terminalStarted ? "tour-card-left" : rect && rect.left > 500 ? "tour-card-left" : "tour-card-right";
  return <>
    {rect && <div className="tour-spotlight" style={rect} aria-hidden="true" />}
    <aside ref={cardRef} className={`tour-card ${manualPosition ? "tour-card-manual" : cardSide}${dragging ? " dragging" : ""}`} style={manualPosition ? { left: manualPosition.left, top: manualPosition.top, right: "auto", bottom: "auto" } : undefined} aria-live="polite">
      <div className="tour-head" onPointerDown={startDrag} onDoubleClick={() => setManualPosition(null)} title={locale === "es" ? "Arrastra para mover · doble clic para restablecer" : "Drag to move · double-click to reset"}><span>{locale === "es" ? "Vault de ejemplo" : "Example vault"} · {index + 1}/{LESSONS.length}</span><button onClick={() => setHidden(true)} aria-label={locale === "es" ? "Minimizar guía" : "Minimize guide"}>—</button></div>
      <div className="tour-dots">{LESSONS.map((l, i) => <span key={l.id} className={i <= index ? "on" : ""} />)}</div>
      <h2>{lesson.title[locale]}</h2><p>{lesson.body[locale]}</p>
      {lesson.id === "navigate" && <p className="tour-tip">{newTabModifier} + click · {locale === "es" ? "Abrir en otra pestaña" : "Open in another tab"}</p>}
      {lesson.id === "navigate" && navigationProgress === 1 && <div className="tour-status">✓ {locale === "es" ? "Estudio creativo abierto. Ahora abre Fondo de emergencia." : "Creative studio opened. Now open Emergency fund."}</div>}
      {!rect && lesson.id !== "terminal" && <div className="tour-status">{locale === "es" ? "Abre una nota para mostrar el control correspondiente." : "Open a note to reveal the relevant control."}</div>}
      {lesson.id === "terminal" && aiConfigured && agent && <><div className="tour-status">{terminalStarted ? (locale === "es" ? "El agente está trabajando. Sigue su proceso en la terminal resaltada y avanza cuando termine de responder." : "The agent is working. Follow its process in the highlighted terminal and continue when it finishes responding.") : `${locale === "es" ? "Agente" : "Agent"}: ${AGENTS.find((item) => item.id === agent)?.name ?? agent}${model ? ` · ${model}` : ""}`}</div><button className="tour-do" onClick={terminalPreset}>{terminalStarted ? (locale === "es" ? "Ejecutar de nuevo" : "Run again") : (locale === "es" ? "Preguntar a la IA" : "Ask the AI")}</button></>}
      {lesson.id === "terminal" && (!aiConfigured || !agent) && <div className="tour-warning">{locale === "es" ? "No configuraste un agente de IA. Para ver este proceso necesitas volver a la configuración, instalar o elegir uno; también puedes omitir esta lección." : "You did not configure an AI agent. To see this process, return to setup and install or select one; you can also skip this lesson."}</div>}
      {lesson.id === "ai" && !aiConfigured && <div className="tour-warning">{locale === "es" ? "No hay un agente configurado. Puedes instalar uno desde este menú o continuar sin probar la lección." : "No agent is configured. You can install one from this menu or continue without trying the lesson."}</div>}
      <div className="tour-actions"><button disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>{locale === "es" ? "Atrás" : "Back"}</button><button onClick={() => persist(index + 1, "skip")}>{locale === "es" ? "Omitir" : "Skip"}</button><button className="tour-next" onClick={() => persist(index + 1, "complete")}>{index === LESSONS.length - 1 ? (locale === "es" ? "Crear mi vault" : "Create my vault") : (locale === "es" ? "Siguiente" : "Next")} →</button></div>
    </aside>
  </>;
}
