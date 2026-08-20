"use client";
import { useEffect, useRef, useState } from "react";
import { runInNewTerminal } from "./TerminalPane";
import { newTermId, openInWorkspace } from "./Tabs.tsx";
import { AGENTS, CONVERSATION_PERMS, RESUME, conversationCommand, resumeCommand, useInstalledAgents } from "./agent-session";
import { useT } from "./I18n";

/**
 * Iniciar una conversación con un agente desde la barra superior.
 *
 * La apuesta de fondo: la app no reimplementa el chat de cada CLI —eso serían
 * cuatro parsers de su salida en vivo, rotos cada vez que cualquiera de los
 * cuatro cambie un evento— sino que **construye la entrada con interfaz y deja
 * que el CLI se pinte solo**. Todo lo de este menú es del lado de la entrada:
 * elegir proveedor y permisos es armar una línea de comando. Nada lee lo que el
 * agente responde, y por eso nada de esto se rompe cuando un CLI se actualice.
 *
 * Para quien no vive en una terminal, lo que quita de en medio no es cómo se ve
 * la salida: es el prompt en blanco. No hay que saber que existe un binario
 * llamado `agy`, ni cuál de las tres banderas de aprobación de Codex significa
 * «pregúntame».
 *
 * Solo dos niveles de permiso, y son los extremos. Los intermedios de `PERMS`
 * (aceptar ediciones y seguir preguntando el resto) tienen sentido para una
 * TAREA que la app despacha; para una conversación abierta, donde el usuario no
 * ha dicho todavía qué va a pedir, un punto medio es una promesa que ni él ni
 * nosotros podemos evaluar todavía.
 */
export default function AgentMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const t = useT();

  /*
   * El sondeo se dispara al ABRIR, no al montar. Este componente vive en el
   * masthead de cada página y averiguar qué hay instalado levanta una shell de
   * login por agente (~2 s): pagarlo en cada navegación, para un menú que casi
   * nunca se abre, sería cobrarle a todo el mundo por lo que usa uno. El hook
   * recuerda que ya preguntó, así que abrir y cerrar no lo repite.
   */
  const { installed } = useInstalledAgents(open);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  /**
   * Abre la conversación en una pestaña nueva del workspace.
   *
   * Pestaña y no un panel propio: la pty vive en el servidor bajo ese id, así
   * que la conversación sobrevive a cambiar de nota, mover el panel o recargar
   * la página — y se cierra cuando el usuario cierra la pestaña, que es donde
   * ya sabe que se cierran las cosas.
   */
  function start(name: string, command: string) {
    const id = newTermId();
    runInNewTerminal(id, command);
    openInWorkspace(id, name, true);
    setOpen(false);
  }

  return (
    <div className="cfgwrap" ref={box}>
      <button
        className="themebtn"
        onClick={() => setOpen((v) => !v)}
        title={t("masthead.aiTitle")}
        aria-label={t("masthead.aiTitle")}
        aria-expanded={open}
        data-tour="agent-menu"
      >
        {/*
          Destellos, el icono que ya significa «IA» en cualquier interfaz de
          2026 — y que aquí además dice la verdad sobre lo que hay detrás: algo
          generativo, no una herramienta más del wiki.

          Relleno y no de trazo, por lo mismo que el engrane de Settings: a 13 px
          un contorno de cuatro puntas cierra sus concavidades y se lee como un
          rombo. Dos estrellas y no una porque una sola a este tamaño es un
          asterisco; el par desigual es lo que se reconoce como destello.

          Rectas y no curvas. La primera versión unía las puntas con cuadráticas
          cuyo punto de control era el centro, que sobre el papel es la forma
          canónica del destello y a 13 px es una trampa: las concavidades se
          comen casi todo el grosor y lo que queda son cuatro espinas de menos de
          un píxel: en pantalla se leía como una flecha entre dos puntos, no como
          una estrella. Con vértices intermedios a ~0.28 r el brazo conserva
          cuerpo a cualquier tamaño, y de paso la silueta no depende de cómo
          rasterice las curvas cada navegador.
        */}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M6.2 1 L7.75 5.05 L11.8 6.6 L7.75 8.15 L6.2 12.2 L4.65 8.15 L0.6 6.6 L4.65 5.05 Z" />
          <path d="M12.7 9.6 L13.5 11.7 L15.6 12.5 L13.5 13.3 L12.7 15.4 L11.9 13.3 L9.8 12.5 L11.9 11.7 Z" />
        </svg>
      </button>

      {open && (
        <div className="cfgpanel aimenu">
          <div className="cfgsec">{t("agent.startConversation")}</div>

          {AGENTS.map((a) => {
            /*
             * Tres estados, no dos: `null` es «todavía no ha contestado el
             * sondeo». Pintar «no instalado» durante ese segundo largo acusaría
             * en falso a los cuatro cada vez que se abre el menú, así que hasta
             * que no se sepa, se ofrece. Misma regla que `AgentMissing`.
             */
            const missing = installed(a.id) === false;
            const perms = CONVERSATION_PERMS[a.id] || CONVERSATION_PERMS.claude;
            const resume = RESUME[a.id] ?? RESUME.claude;
            return (
              <div key={a.id} className={`aiagent${missing ? " off" : ""}`}>
                <strong className="aiagentname">
                  <span className="aiagenticon" aria-hidden="true">
                    <img src={a.icon} alt="" />
                  </span>
                  <span>
                    {a.name}
                    {missing && <em> · {t("agent.notInstalled")}</em>}
                  </span>
                </strong>
                <div className="cfgmodes">
                  {perms.map((p) => (
                    <button
                      key={p.id}
                      /*
                       * Deshabilitado en vez de dejar que la terminal conteste
                       * `command not found`: un botón que arranca algo condenado
                       * a fallar no es una opción, es una trampa. Se sigue viendo
                       * —saber que existe Codex es parte de lo que el menú
                       * enseña—, pero no se puede pulsar.
                       */
                      disabled={missing}
                      title={t(p.hint)}
                      onClick={() => start(a.name, conversationCommand(a.id, p.id))}
                    >
                      {t(p.label)}
                    </button>
                  ))}
                  {/*
                    Reanudar va en la misma fila que los dos niveles de permiso
                    y no en una sección aparte: son las tres maneras de llegar a
                    una terminal con ESTE agente, y separarlas obligaría a
                    recorrer la lista de agentes dos veces para responder una
                    sola pregunta. Que no lleve permiso propio lo dice su ayuda,
                    no su posición.
                  */}
                  <button
                    className="airesume"
                    disabled={missing}
                    title={t(resume.hint)}
                    onClick={() => start(a.name, resumeCommand(a.id))}
                  >
                    {t(resume.label)}
                  </button>
                </div>
              </div>
            );
          })}

          {/*
            El aviso va aquí abajo, una sola vez, y no como advertencia al
            pulsar. Es información que se necesita ANTES de elegir —después de
            pulsar ya arrancó—, y repetirla por agente convertiría el menú en un
            muro de texto que nadie lee, que es como una advertencia deja de
            advertir.
          */}
          <p className="cfghint">{t("agent.permWarning")}</p>
        </div>
      )}
    </div>
  );
}
