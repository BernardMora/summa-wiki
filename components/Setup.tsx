"use client";
import { useEffect, useState } from "react";
import { postJSON, TimeoutError } from "./net";
import VaultPicker from "./VaultPicker";
import AgentSession from "./AgentSession";
import { AGENTS, type AgentPickId, PERMS, useAgentModels, useInstalledAgents } from "./agent-session";
import AgentMissing from "./AgentMissing";
import { useT } from "./I18n";
import { bold } from "./markup";

/**
 * El asistente de arranque, de principio a fin.
 *
 * Cinco pasos, y los dos últimos existen porque faltaban: la primera versión
 * creaba las carpetas y se detenía ahí, dejando al usuario con una estructura
 * vacía sin decirle que el siguiente paso —traer sus archivos y dejar que un
 * agente los reparta— existía siquiera. Crear el vault es el andamio; poblarlo
 * es para lo que se creó.
 *
 * Todo ocurre **sin reiniciar el servidor**. El vault nuevo se crea, se ingiere
 * y se reparte siendo todavía un destino explícito y no el vault activo:
 * reiniciar a mitad tiraría la pantalla en la que está el usuario, y con ella
 * el hilo de lo que estaba haciendo. El cambio de vault se hace al final,
 * cuando ya no hay nada que perder.
 */

interface Pack {
  id: string;
  name: string;
  description: string;
  folders: { path: string; purpose: string }[];
  hubs: string[];
  categories: number;
}

interface Problem { field: "name" | "path"; level: "error" | "warning"; message: string }

interface Preview {
  counts: { note: number; source: number; image: number; skip: number };
  bytes: number; duplicates: number; unreadable: string[]; truncated: boolean;
  truncatedBy?: "files" | "time";
  willCopy: number; willSkip: number;
  sample: { from: string; to: string; kind: string }[];
  inbox: string;
}

const BEST_FOR = {
  identidad: "setup.bestIdentidad",
  para: "setup.bestPara",
  plano: "setup.bestPlano",
} as const;

export type Step = "start" | "open" | "create" | "sources" | "run";

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function Setup({
  startAt = "start",
  suggestDir = "",
  suggestName = "",
}: {
  startAt?: Step;
  /** Ruta y nombre del vault abierto, para no pedirlos otra vez. */
  suggestDir?: string;
  suggestName?: string;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(startAt);
  const [desktop, setDesktop] = useState(false);

  // Paso «crear»
  const [packs, setPacks] = useState<Pack[]>([]);
  const [chosen, setChosen] = useState("");
  const [agent, setAgent] = useState<AgentPickId>("claude");
  const [model, setModel] = useState("");
  const [perm, setPerm] = useState("acceptEdits");
  const { models: agentModels, loading: modelsLoading } = useAgentModels(agent);
  const { agents: installedAgents, installed } = useInstalledAgents();
  const [name, setName] = useState(suggestName);
  const [dir, setDir] = useState(suggestDir);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [checking, setChecking] = useState(false);

  // Paso «fuentes»
  const [vault, setVault] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [srcText, setSrcText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copied, setCopied] = useState<{ copied: number; skipped: number; claude: string | null } | null>(null);

  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [agentFinished, setAgentFinished] = useState(false);
  /**
   * Segundos transcurridos mientras se analiza.
   *
   * Un botón que solo dice «Analizando…» no distingue entre «va a tardar tres
   * segundos» y «esto ya no vuelve». El contador es la diferencia entre
   * esperar y no saber si esperar.
   */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);



  useEffect(() => setDesktop(typeof window !== "undefined" && !!window.summa), []);

  useEffect(() => {
    if (step !== "create" || packs.length) return;
    fetch("/api/vault/create").then((r) => r.json())
      .then((d) => { setPacks(d.packs ?? []); setChosen((c) => c || d.packs?.[0]?.id || ""); })
      .catch(() => setErr(t("setup.catalogFailed")));
  }, [step, packs.length]);

  /**
   * Validación en vivo, con freno.
   *
   * Contra el servidor y no en el cliente porque las comprobaciones que
   * importan —¿existe la carpeta padre? ¿hay permiso de escritura? ¿ya hay
   * notas ahí?— son del sistema de archivos, y el navegador no lo ve. 400 ms de
   * espera para no lanzar una petición por tecla.
   */
  useEffect(() => {
    if (step !== "create") return;
    if (!name.trim() && !dir.trim()) { setProblems([]); return; }
    setChecking(true);
    const t = setTimeout(() => {
      fetch("/api/vault/create?check=1", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir, name, architecture: chosen }),
      })
        .then((r) => r.json())
        .then((d) => setProblems(d.problems ?? []))
        .catch(() => {})
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [step, name, dir, chosen]);

  const errorsOf = (f: "name" | "path") => problems.filter((p) => p.field === f && p.level === "error");
  const warningsOf = (f: "name" | "path") => problems.filter((p) => p.field === f && p.level === "warning");
  const canCreate = !!name.trim() && !!dir.trim() && !!chosen && !problems.some((p) => p.level === "error");

  const chosenSources = desktop ? sources : srcText.split("\n").map((s) => s.trim()).filter(Boolean);

  async function browseDest() {
    const p = await window.summa?.chooseFolder(t("setup.pickDestTitle"));
    if (p) { setDir(p); setName((n) => n || (p.split("/").pop() ?? "")); }
  }

  async function create() {
    if (!canCreate || busy) return;
    setBusy("creando"); setErr("");
    try {
      const r = await fetch("/api/vault/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir, name, architecture: chosen, agent }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? t("setup.createFailed")); return; }
      setVault(d.vault);
      setStep("sources");
    } catch { setErr(t("setup.createFailed")); } finally { setBusy(""); }
  }

  async function addSource() {
    const p = await window.summa?.chooseFolder(t("setup.pickSourcesTitle"));
    if (p) setSources((f) => (f.includes(p) ? f : [...f, p]));
    setPreview(null);
  }

  async function analyse() {
    if (!chosenSources.length) return;
    setBusy("analizando"); setErr(""); setPreview(null);
    try {
      const { ok, data } = await postJSON<Preview & { error?: string }>(
        "/api/ingest?dry=1", { folders: chosenSources, vault });
      if (!ok) { setErr(data.error ?? t("setup.analyseFailed")); return; }
      setPreview(data);
    } catch (e) {
      setErr(e instanceof TimeoutError
        ? t("setup.analyseTimeout", { n: e.seconds })
        : t("setup.analyseFailed"));
    } finally { setBusy(""); }
  }

  async function ingest() {
    setBusy("copiando"); setErr("");
    try {
      const { ok, data } = await postJSON<{ copied: number; skipped: number; claude: string | null; error?: string }>(
        "/api/ingest", { folders: chosenSources, vault }, { timeoutMs: 300_000 });
      if (!ok) { setErr(data.error ?? t("setup.copyFailed")); return; }
      setCopied({ copied: data.copied, skipped: data.skipped, claude: data.claude });
      setStep("run");
    } catch (e) {
      setErr(e instanceof TimeoutError ? t("setup.copyTimeout", { n: e.seconds }) : t("setup.copyFailed"));
    } finally { setBusy(""); }
  }

  /**
   * El cambio de vault va al final: reinicia el servidor y descarta esta página.
   *
   * Se registra aquí y no al crear porque son dos actos distintos — montar la
   * estructura y mudarse a ella — y entre uno y otro quedan dos pasos del
   * asistente.
   */
  async function openVault() {
    await fetch("/api/vault", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: vault }),
    }).catch(() => {});
    if (window.summa) await window.summa.switchVault(vault);
    else location.reload();
  }

  // ---------------------------------------------------------------- pasos

  if (step === "start") {
    return (
      <div className="welcome">
        <h1>{t("setup.welcome")}</h1>
        <p>{t("setup.intro")}</p>
        <div className="setupchoices">
          <button className="setupcard" onClick={() => setStep("open")}>
            <strong>{t("setup.haveNotes")}</strong>
            <span>{t("setup.haveNotesHint")}</span>
          </button>
          <button className="setupcard" onClick={() => setStep("create")}>
            <strong>{t("setup.fromScratch")}</strong>
            <span>{t("setup.fromScratchHint")}</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === "open") {
    return (
      <div className="welcome">
        <h1>{t("setup.openTitle")}</h1>
        <p>{t("setup.openHint")}</p>
        <VaultPicker current={null} />
        <p className="counts"><button className="linkish" onClick={() => setStep("start")}>{t("setup.backLink")}</button></p>
      </div>
    );
  }

  if (step === "create") {
    const pack = packs.find((p) => p.id === chosen);
    return (
      <div className="welcome setupcreate">
        <h1>{t("setup.createTitle")}</h1>
        <p className="steps">{t("setup.stepConfig")}</p>

        <div className="setupfield">
          <label>{t("setup.fieldName")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder={t("setup.namePlaceholder")} maxLength={80} />
          {errorsOf("name").map((p) => <p key={p.message} className="fielderr">{p.message}</p>)}
        </div>

        <div className="setupfield">
          <label>{t("setup.fieldWhere")}</label>
          {desktop ? (
            <div className="cfgrow">
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                      onClick={browseDest}>{dir ? t("setup.change") : t("setup.chooseFolder")}</button>
              {dir && <code className="cfgpath">{dir}</code>}
            </div>
          ) : (
            <input value={dir} onChange={(e) => setDir(e.target.value)}
                   placeholder={t("setup.dirPlaceholder")} spellCheck={false} />
          )}
          {errorsOf("path").map((p) => <p key={p.message} className="fielderr">{p.message}</p>)}
          {warningsOf("path").map((p) => <p key={p.message} className="fieldwarn">{p.message}</p>)}
          {!errorsOf("path").length && !warningsOf("path").length && (
            <p className="cfghint">
              {dir && dir === suggestDir
                ? t("setup.dirIsCurrent")
                : t("setup.dirMayNotExist")}
            </p>
          )}
        </div>

        <div className="setupfield structurefield">
          <div className="setupfield-label">
            <label>{t("setup.fieldStructure")}</label>
            <button type="button" className="structurehelp"
                    aria-label={t("setup.structureHelpLabel")}
                    data-tooltip={t("setup.structureHelpBody")}>?</button>
          </div>
          <div className="archgrid architecture-options">
            {packs.map((p) => (
              <button key={p.id} className={`archcard${p.id === chosen ? " on" : ""}`}
                      onClick={() => setChosen(p.id)}>
                <strong>{p.name}</strong>
                <span>{p.description}</span>
                <span className="archmini" aria-label={t("setup.folderPreview")}>
                  {p.folders.map((folder, index) => (
                    <span className="archmini-row" key={folder.path}>
                      <span aria-hidden="true">{index === p.folders.length - 1 ? "└" : "├"}─</span>
                      <span className="archmini-folder">{folder.path.replace(/\/$/, "")}</span>
                    </span>
                  ))}
                </span>
                <span className="archbest">
                  <strong>{t("setup.bestIf")}</strong>{" "}
                  {t(BEST_FOR[p.id as keyof typeof BEST_FOR] ?? "setup.bestGeneric")}
                </span>
              </button>
            ))}
          </div>

          {pack && (
            <div className="archpreview">
              <p className="cfghint">{t("setup.foldersCreated")}</p>
              <table className="structtable">
                <tbody>
                  {pack.folders.map((f) => (
                    <tr key={f.path}>
                      <td><code>{f.path}</code></td>
                      <td>{f.purpose.replace(/\*\*/g, "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="cfghint">
                {pack.hubs.length
                  ? t("setup.packWithHubs", { hubs: pack.hubs.length, cats: pack.categories })
                  : t("setup.packNoHubs", { cats: pack.categories })}
                {" "}{t("setup.packEditable", { file: ".summa/architecture.json" })}
              </p>
            </div>
          )}
        </div>

        <div className="setupfield">
          <label>{t("setup.fieldAgent")}</label>
          <div className="archgrid">
            {AGENTS.map((a) => {
              const has = installed(a.id);
              return (
                <button key={a.id} className={`archcard${agent === a.id ? " on" : ""}`}
                        onClick={() => { setAgent(a.id); setModel(""); setPerm("acceptEdits"); }}>
                  <strong>
                    {a.name}
                    {has !== null && (
                      <span className={has ? "agentok" : "agentmissing"}>
                        {t(has ? "agent.installed" : "agent.notInstalled")}
                      </span>
                    )}
                  </strong>
                  <span>{t(a.blurb)}</span>
                </button>
              );
            })}
          </div>
          <AgentMissing agent={agent} installed={installed(agent)} all={installedAgents} />
        </div>

        <div className="setupfield">
          <label>{t("setup.fieldModel")}</label>
          <div className="archgrid">
            {agentModels.map((m) => (
              <button key={m.id} className={`archcard${m.id === model ? " on" : ""}`}
                      onClick={() => setModel(m.id)}>
                <strong>{m.labelKey ? t(m.labelKey) : m.label}</strong>
                <span>{t(m.hint)}</span>
              </button>
            ))}
          </div>
          <p className="cfghint">
            {modelsLoading
              ? t("setup.modelsLoading")
              : t("setup.modelsHint")}
          </p>
        </div>

        <div className="setupfield">
          <label>{t("setup.fieldPerms")}</label>
          <div className="archgrid">
            {(PERMS[agent] || PERMS.claude).map((p) => (
              <button key={p.id} className={`archcard${p.id === perm ? " on" : ""}`}
                      onClick={() => setPerm(p.id)}>
                <strong>{t(p.label)}</strong>
                <span>{t(p.hint)}</span>
              </button>
            ))}
          </div>
          {perm === "bypass" && (
            <div className="warnbox">
              <strong>{t("setup.bypassTitle")}</strong> {t("setup.bypassBody")}
              <br /><br />
              {t("setup.bypassBody2")}
            </div>
          )}
        </div>

        {err && <div className="err">{err}</div>}

        <div className="cfgrow" style={{ marginTop: 14 }}>
          <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                  disabled={!canCreate || !!busy} onClick={create}>
            {busy === "creando" ? t("setup.creating") : t("setup.createContinue")}
          </button>
          {checking && <span className="dim" style={{ fontSize: 11.5 }}>{t("setup.checking")}</span>}
          <button className="linkish" onClick={() => setStep("start")}>{t("setup.backLink")}</button>
        </div>
      </div>
    );
  }

  if (step === "sources") {
    return (
      <div className="welcome setupcreate">
        <h1>{t("setup.sourcesTitle")}</h1>
        <p className="steps">{t("setup.stepContent")}</p>
        <p>{bold(t("setup.sourcesIntro"))}</p>

        <div className="setupfield">
          <label>{t("setup.fieldSources")}</label>
          {desktop ? (
            <>
              <div className="cfgrow">
                <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                        onClick={addSource}>{t("setup.addFolder")}</button>
              </div>
              {sources.map((f) => (
                <div key={f} className="cfgrow">
                  <code className="cfgpath" style={{ flex: 1 }}>{f}</code>
                  <button className="linkish"
                          onClick={() => { setSources((x) => x.filter((y) => y !== f)); setPreview(null); }}>
                    {t("setup.remove")}
                  </button>
                </div>
              ))}
            </>
          ) : (
            <textarea rows={4} value={srcText}
                      onChange={(e) => { setSrcText(e.target.value); setPreview(null); }}
                      placeholder={t("setup.sourcesPlaceholder")} spellCheck={false} />
          )}
          <p className="cfghint">
            {t("setup.skipsHint", { nodeModules: "node_modules", git: ".git" })}
          </p>
        </div>

        {err && <div className="err">{err}</div>}

        <div className="cfgrow" style={{ marginTop: 14 }}>
          <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                  disabled={!chosenSources.length || !!busy} onClick={analyse}>
            {busy === "analizando" ? t("setup.analysing", { n: elapsed }) : t("setup.analyse")}
          </button>
          <button className="linkish" onClick={openVault}>{t("setup.skipEmpty")}</button>
        </div>

        {preview && (
          <div className="archpreview" style={{ marginTop: 18 }}>
            <p>{bold(t("setup.wouldEnter", {
              n: preview.willCopy, inbox: preview.inbox, size: mb(preview.bytes),
            }))}</p>
            <table className="structtable">
              <tbody>
                <tr><td><code>{preview.counts.note}</code></td><td>{t("setup.rowNotes")}</td></tr>
                <tr><td><code>{preview.counts.source}</code></td><td>{t("setup.rowSources")}</td></tr>
                <tr><td><code>{preview.counts.image}</code></td><td>{t("setup.rowImages")}</td></tr>
                <tr><td><code>{preview.willSkip}</code></td><td>{t("setup.rowSkipped")}{preview.duplicates > 0 && t("setup.rowSkippedDup", { n: preview.duplicates })}</td></tr>
              </tbody>
            </table>
            {preview.truncated && (
              <p className="err">
                {preview.truncatedBy === "time"
                  ? t("setup.truncatedTime")
                  : t("setup.truncatedFiles")}
                {" "}{t("setup.truncatedTail")}
              </p>
            )}
            <div className="cfgrow" style={{ marginTop: 12 }}>
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                      disabled={!!busy || preview.willCopy === 0} onClick={ingest}>
                {busy === "copiando" ? t("setup.copying") : t("setup.copyN", { n: preview.willCopy })}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // step === "run"
  return (
    <div className="welcome setupcreate">
      <h1>{t("setup.runTitle")}</h1>
      <p className="steps">{t("setup.stepSort")}</p>
      <p>{t("setup.runIntro", { n: copied?.copied ?? 0 })}</p>

      <AgentMissing agent={agent} installed={installed(agent)} all={installedAgents} />
      <p className="cfghint">{t("agent.optionalNote")}</p>
      <AgentSession cwd={vault} agent={agent} model={model} perm={perm}
                    installed={installed(agent)}
                    onStarted={() => setAgentFinished(false)}
                    onEnded={() => setAgentFinished(true)} />

      {/*
        * El botón sale también cuando el agente NO está instalado: si no,
        * esperar a que «termine» algo que nunca puede arrancar deja al usuario
        * encerrado en el último paso del asistente, con su vault ya creado y
        * sin manera de abrirlo. Justo al novato, que es quien no lo tiene.
        */}
      {agentFinished || installed(agent) === false ? (
        <div className="cfgrow" style={{ marginTop: 22 }}>
          <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                  onClick={openVault}>
            {t("setup.openMyWiki")}
          </button>
        </div>
      ) : (
        <p className="cfghint" style={{ marginTop: 18 }}>{t("setup.waitForAgent")}</p>
      )}
    </div>
  );
}
