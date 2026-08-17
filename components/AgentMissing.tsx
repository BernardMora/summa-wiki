"use client";
import { INSTALL } from "./agent-session";
import { useT } from "./I18n";
import { bold } from "./markup";

/**
 * Lo que se pinta cuando el agente elegido no está en la máquina.
 *
 * Existe porque el fallo que sustituye era mudo: el asistente aceptaba
 * «Claude Code» sin comprobar nada, y el usuario se enteraba de que le faltaba
 * cuando la terminal incrustada escupía `command not found: claude` — sin
 * decirle qué es eso, de dónde se saca, ni que la wiki funciona igual sin ello.
 * Para alguien que nunca ha instalado un CLI, ese mensaje es el final del
 * camino.
 *
 * Compartido entre el asistente de creación y la sesión suelta a propósito: son
 * los dos sitios donde se puede elegir un agente, y el que se entere solo uno de
 * los dos es cómo vuelve el bug.
 *
 * No devuelve nada mientras `installed` es `null` — o sea, mientras el sondeo no
 * ha contestado. Acusar de que falta algo antes de haber mirado es peor que
 * callarse: el sondeo tarda un segundo largo porque levanta una shell de login,
 * y en ese rato la pantalla acusaría en falso a los cuatro.
 */
export default function AgentMissing({
  agent,
  installed,
  all,
}: {
  agent: string;
  installed: boolean | null;
  /** Todos los agentes sondeados, para saber si NINGUNO está. */
  all: Record<string, string | null> | null;
}) {
  const t = useT();
  if (installed !== false) return null;

  const info = INSTALL[agent];
  const none = all !== null && Object.values(all).every((p) => !p);

  return (
    <div className="warnbox">
      <strong>{t("agent.missingTitle", { binary: info?.binary ?? agent })}</strong>{" "}
      {bold(t(none ? "agent.noneInstalled" : "agent.missingBody"))}
      {info?.command && (
        <p style={{ margin: "10px 0 0" }}>
          {t("agent.missingInstall")} <code>{info.command}</code>
        </p>
      )}
      {info?.url && (
        <p style={{ margin: "6px 0 0" }}>
          <a href={info.url} target="_blank" rel="noreferrer">{t("agent.missingDocs")}</a>
        </p>
      )}
    </div>
  );
}
