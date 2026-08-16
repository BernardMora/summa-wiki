"use client";
import { useState } from "react";
import TerminalPane, { runInNewTerminal } from "./TerminalPane";
import { newTermId } from "./Tabs";
import { PERMS, agentCommand, useAgyModels } from "./agent-session";
import { useT } from "./I18n";

/**
 * Ver al agente trabajar **dentro de la app**, con modelo y permisos ya
 * decididos.
 *
 * La terminal va incrustada aquí y no en una pestaña del workspace porque
 * durante la creación de un vault todavía no hay workspace al que mandar nada:
 * el vault nuevo ni siquiera es el activo. Y porque el usuario pidió
 * exactamente esto — ver el proceso, no que ocurra en otro sitio.
 *
 * `cwd` es el vault destino, que puede no ser el abierto: ahí están la skill,
 * el ledger y la bandeja que el agente necesita.
 *
 * `model`/`perm` son controlados por quien lo use cuando ya se decidieron
 * antes (el asistente de creación los pide en el paso de configuración, junto
 * con el resto del vault, para no preguntar dos veces). Sin ellos, el
 * componente trae su propio selector — es el caso de la ingesta suelta, que
 * no pasa por ese paso.
 */
export default function AgentSession({
  cwd,
  agent = "claude",
  model: modelProp,
  perm: permProp,
  onStarted,
}: {
  cwd: string;
  agent?: string;
  model?: string;
  perm?: string;
  onStarted?: () => void;
}) {
  const t = useT();
  const [modelState, setModelState] = useState("");
  const [permState, setPermState] = useState("acceptEdits");
  const [termId, setTermId] = useState<string | null>(null);

  const picked = modelProp !== undefined && permProp !== undefined;
  const model = modelProp ?? modelState;
  const perm = permProp ?? permState;

  const command = agentCommand(agent, model, perm);
  const { models, loading: modelsLoading } = useAgyModels(agent);
  const perms = PERMS[agent] || PERMS.claude;

  function start() {
    const id = newTermId();
    runInNewTerminal(id, command, cwd);
    setTermId(id);
    onStarted?.();
  }

  if (termId) {
    return (
      <div className="agentrun">
        <p className="cfghint">
          Corriendo <code>{command}</code> en <code>{cwd}</code>.{" "}
          {agent === "antigravity"
            ? t("agent.oneShot")
            : t("agent.interactive")}
        </p>
        <div className="agentterm">
          <TerminalPane id={termId} />
        </div>
      </div>
    );
  }

  return (
    <>
      {!picked && (
        <>
          <div className="setupfield">
            <label>{t("setup.fieldModel")}</label>
            <div className="archgrid">
              {models.map((m) => (
                <button key={m.id} className={`archcard${m.id === model ? " on" : ""}`}
                        onClick={() => setModelState(m.id)}>
                  <strong>{m.labelKey ? t(m.labelKey) : m.label}</strong>
                  <span>{t(m.hint)}</span>
                </button>
              ))}
            </div>
            <p className="cfghint">
              {modelsLoading
                ? t("setup.modelsLoading")
                : t("agent.sessionOnly")}
            </p>
          </div>

          <div className="setupfield">
            <label>{t("setup.fieldPerms")}</label>
            <div className="archgrid">
              {perms.map((p) => (
                <button key={p.id} className={`archcard${p.id === perm ? " on" : ""}`}
                        onClick={() => setPermState(p.id)}>
                  <strong>{t(p.label)}</strong>
                  <span>{t(p.hint)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {perm === "bypass" && (
        <div className="warnbox">
          <strong>{t("setup.bypassTitle")}</strong> {t("setup.bypassBody")}
          <br /><br />
          {t("setup.bypassBody2")}
        </div>
      )}

      <div className="cfgrow" style={{ marginTop: 14 }}>
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                onClick={start}>
          Empezar el reparto
        </button>
      </div>
      <p className="cfghint">{t("agent.willRun")} <code>{command}</code></p>
    </>
  );
}
