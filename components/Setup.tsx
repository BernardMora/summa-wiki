"use client";
import { useEffect, useState } from "react";
import { postJSON, TimeoutError } from "./net";
import VaultPicker from "./VaultPicker";
import AgentSession from "./AgentSession";
import { PERMS, useAgyModels } from "./agent-session";

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
  const [step, setStep] = useState<Step>(startAt);
  const [desktop, setDesktop] = useState(false);

  // Paso «crear»
  const [packs, setPacks] = useState<Pack[]>([]);
  const [chosen, setChosen] = useState("");
  const [agent, setAgent] = useState<"claude" | "antigravity" | "opencode">("claude");
  const [model, setModel] = useState("");
  const [perm, setPerm] = useState("acceptEdits");
  const { models: agentModels, loading: modelsLoading } = useAgyModels(agent);
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
      .catch(() => setErr("no se pudo leer el catálogo de arquitecturas"));
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
    const p = await window.summa?.chooseFolder("Dónde crear el vault");
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
      if (!r.ok) { setErr(d.error ?? "no se pudo crear"); return; }
      setVault(d.vault);
      setStep("sources");
    } catch { setErr("no se pudo crear"); } finally { setBusy(""); }
  }

  async function addSource() {
    const p = await window.summa?.chooseFolder("Carpeta con material para tu wiki");
    if (p) setSources((f) => (f.includes(p) ? f : [...f, p]));
    setPreview(null);
  }

  async function analyse() {
    if (!chosenSources.length) return;
    setBusy("analizando"); setErr(""); setPreview(null);
    try {
      const { ok, data } = await postJSON<Preview & { error?: string }>(
        "/api/ingest?dry=1", { folders: chosenSources, vault });
      if (!ok) { setErr(data.error ?? "no se pudo analizar"); return; }
      setPreview(data);
    } catch (e) {
      setErr(e instanceof TimeoutError
        ? `El análisis no respondió en ${e.seconds} s. Suele pasar con carpetas en la nube (Drive, iCloud): prueba con una carpeta más concreta.`
        : "no se pudo analizar");
    } finally { setBusy(""); }
  }

  async function ingest() {
    setBusy("copiando"); setErr("");
    try {
      const { ok, data } = await postJSON<{ copied: number; skipped: number; claude: string | null; error?: string }>(
        "/api/ingest", { folders: chosenSources, vault }, { timeoutMs: 300_000 });
      if (!ok) { setErr(data.error ?? "no se pudo copiar"); return; }
      setCopied({ copied: data.copied, skipped: data.skipped, claude: data.claude });
      setStep("run");
    } catch (e) {
      setErr(e instanceof TimeoutError ? `La copia no terminó en ${e.seconds} s.` : "no se pudo copiar");
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
        <h1>Bienvenido</h1>
        <p>
          Un vault es la carpeta donde viven tus notas en markdown. Esta app la
          lee y la escribe desde tu disco — nada sale de tu computadora.
        </p>
        <div className="setupchoices">
          <button className="setupcard" onClick={() => setStep("open")}>
            <strong>Ya tengo notas</strong>
            <span>Abre una carpeta que ya uses — de Obsidian, de iCloud, un repo.</span>
          </button>
          <button className="setupcard" onClick={() => setStep("create")}>
            <strong>Empezar de cero</strong>
            <span>
              Elige una estructura, trae tus carpetas de archivos, y deja que un
              agente los lea y los acomode.
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (step === "open") {
    return (
      <div className="welcome">
        <h1>Abre tu vault</h1>
        <p>Elige la carpeta donde ya viven tus notas.</p>
        <VaultPicker current={null} />
        <p className="counts"><button className="linkish" onClick={() => setStep("start")}>← volver</button></p>
      </div>
    );
  }

  if (step === "create") {
    const pack = packs.find((p) => p.id === chosen);
    return (
      <div className="welcome setupcreate">
        <h1>Crea tu vault</h1>
        <p className="steps">Configuración</p>

        <div className="setupfield">
          <label>Cómo se llama</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="Mi wiki" maxLength={80} />
          {errorsOf("name").map((p) => <p key={p.message} className="fielderr">{p.message}</p>)}
        </div>

        <div className="setupfield">
          <label>Dónde va</label>
          {desktop ? (
            <div className="cfgrow">
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                      onClick={browseDest}>{dir ? "Cambiar…" : "Elegir carpeta…"}</button>
              {dir && <code className="cfgpath">{dir}</code>}
            </div>
          ) : (
            <input value={dir} onChange={(e) => setDir(e.target.value)}
                   placeholder="~/Documents/mi-wiki" spellCheck={false} />
          )}
          {errorsOf("path").map((p) => <p key={p.message} className="fielderr">{p.message}</p>)}
          {warningsOf("path").map((p) => <p key={p.message} className="fieldwarn">{p.message}</p>)}
          {!errorsOf("path").length && !warningsOf("path").length && (
            <p className="cfghint">
              {dir && dir === suggestDir
                ? "Es el vault que tienes abierto. Se le montará la estructura adentro."
                : "Puede no existir todavía; se crea."}
            </p>
          )}
        </div>

        <div className="setupfield">
          <label>Cómo se organiza</label>
          <div className="archgrid">
            {packs.map((p) => (
              <button key={p.id} className={`archcard${p.id === chosen ? " on" : ""}`}
                      onClick={() => setChosen(p.id)}>
                <strong>{p.name}</strong>
                <span>{p.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="setupfield">
          <label>Agente preferido</label>
          <div className="archgrid">
            <button className={`archcard${agent === "claude" ? " on" : ""}`}
                    onClick={() => { setAgent("claude"); setModel(""); setPerm("acceptEdits"); }}>
              <strong>Claude Code</strong>
              <span>Agente CLI de Anthropic.</span>
            </button>
            <button className={`archcard${agent === "antigravity" ? " on" : ""}`}
                    onClick={() => { setAgent("antigravity"); setModel(""); setPerm("acceptEdits"); }}>
              <strong>Antigravity CLI</strong>
              <span>Asistente CLI de Google.</span>
            </button>
            <button className={`archcard${agent === "opencode" ? " on" : ""}`}
                    onClick={() => { setAgent("opencode"); setModel(""); setPerm("acceptEdits"); }}>
              <strong>OpenCode</strong>
              <span>Agente open-source.</span>
            </button>
          </div>
        </div>

        <div className="setupfield">
          <label>Modelo</label>
          <div className="archgrid">
            {agentModels.map((m) => (
              <button key={m.id} className={`archcard${m.id === model ? " on" : ""}`}
                      onClick={() => setModel(m.id)}>
                <strong>{m.label}</strong>
                <span>{m.hint}</span>
              </button>
            ))}
          </div>
          <p className="cfghint">
            {modelsLoading
              ? "Pidiéndole a agy su catálogo de modelos…"
              : "Solo para el reparto. La preferencia permanente se configura en tu CLI, y es de donde sale el default."}
          </p>
        </div>

        <div className="setupfield">
          <label>Permisos</label>
          <div className="archgrid">
            {(PERMS[agent] || PERMS.claude).map((p) => (
              <button key={p.id} className={`archcard${p.id === perm ? " on" : ""}`}
                      onClick={() => setPerm(p.id)}>
                <strong>{p.label}</strong>
                <span>{p.hint}</span>
              </button>
            ))}
          </div>
          {perm === "bypass" && (
            <div className="warnbox">
              <strong>Sin red de seguridad.</strong> El agente podrá ejecutar
              cualquier comando y escribir cualquier archivo de tu computadora
              —también fuera del vault— sin pedirte permiso ni una vez. Una
              instrucción mal entendida, o un texto malicioso dentro de un
              archivo que estás ingiriendo, se ejecuta sin que nadie lo pare.
              <br /><br />
              Los originales no se tocan aunque esto salga mal —se copiaron, no
              se movieron— pero el resto de tu disco sí está al alcance.
            </div>
          )}
        </div>

        {pack && (
          <div className="archpreview">
            <p className="cfghint">Se crean estas carpetas:</p>
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
                ? `Con ${pack.hubs.length} artículos guía y ${pack.categories} categorías.`
                : `Sin artículos guía — organiza por etiquetas. ${pack.categories} categorías.`}
              {" "}Todo queda editable en <code>.summa/architecture.json</code>.
            </p>
          </div>
        )}

        {err && <div className="err">{err}</div>}

        <div className="cfgrow" style={{ marginTop: 14 }}>
          <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                  disabled={!canCreate || !!busy} onClick={create}>
            {busy === "creando" ? "Creando…" : "Crear y continuar"}
          </button>
          {checking && <span className="dim" style={{ fontSize: 11.5 }}>comprobando…</span>}
          <button className="linkish" onClick={() => setStep("start")}>← volver</button>
        </div>
      </div>
    );
  }

  if (step === "sources") {
    return (
      <div className="welcome setupcreate">
        <h1>Trae tus archivos</h1>
        <p className="steps">Contenido inicial</p>
        <p>
          Elige carpetas de tu computadora con material que quieras en tu wiki.
          Se <strong>copian</strong>: los originales no se tocan ni se mueven.
        </p>

        <div className="setupfield">
          <label>Qué carpetas</label>
          {desktop ? (
            <>
              <div className="cfgrow">
                <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                        onClick={addSource}>Agregar carpeta…</button>
              </div>
              {sources.map((f) => (
                <div key={f} className="cfgrow">
                  <code className="cfgpath" style={{ flex: 1 }}>{f}</code>
                  <button className="linkish"
                          onClick={() => { setSources((x) => x.filter((y) => y !== f)); setPreview(null); }}>
                    quitar
                  </button>
                </div>
              ))}
            </>
          ) : (
            <textarea rows={4} value={srcText}
                      onChange={(e) => { setSrcText(e.target.value); setPreview(null); }}
                      placeholder={"~/Documents/notas-viejas\n~/Desktop/pendientes"} spellCheck={false} />
          )}
          <p className="cfghint">
            Se saltan <code>node_modules</code>, <code>.git</code>, ocultos,
            ejecutables y lo que pese más de 100 MB. Los duplicados exactos
            entran una vez.
          </p>
        </div>

        {err && <div className="err">{err}</div>}

        <div className="cfgrow" style={{ marginTop: 14 }}>
          <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                  disabled={!chosenSources.length || !!busy} onClick={analyse}>
            {busy === "analizando" ? `Analizando… ${elapsed}s` : "Analizar"}
          </button>
          <button className="linkish" onClick={openVault}>saltar y abrir el wiki vacío →</button>
        </div>

        {preview && (
          <div className="archpreview" style={{ marginTop: 18 }}>
            <p>
              <strong>{preview.willCopy}</strong> archivos entrarían a{" "}
              <code>{preview.inbox}</code> — {mb(preview.bytes)}.
            </p>
            <table className="structtable">
              <tbody>
                <tr><td><code>{preview.counts.note}</code></td><td>notas y texto</td></tr>
                <tr><td><code>{preview.counts.source}</code></td><td>documentos, cada uno con su nota compañera</td></tr>
                <tr><td><code>{preview.counts.image}</code></td><td>imágenes</td></tr>
                <tr><td><code>{preview.willSkip}</code></td><td>se saltan{preview.duplicates > 0 && `, ${preview.duplicates} por duplicados`}</td></tr>
              </tbody>
            </table>
            {preview.truncated && (
              <p className="err">
                {preview.truncatedBy === "time"
                  ? "El escaneo tardó demasiado y se cortó — típico de carpetas sincronizadas en la nube."
                  : "Se alcanzó el tope de 20,000 archivos."}
                {" "}Esta vista no está completa: elige carpetas más concretas.
              </p>
            )}
            <div className="cfgrow" style={{ marginTop: 12 }}>
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                      disabled={!!busy || preview.willCopy === 0} onClick={ingest}>
                {busy === "copiando" ? "Copiando…" : `Copiar ${preview.willCopy} archivos`}
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
      <h1>Que el agente lo acomode</h1>
      <p className="steps">Reparto</p>
      <p>
        {copied?.copied} archivos están en la bandeja, con la estructura de
        carpetas que traían. Para decidir en qué parte del vault va cada nota hay
        que leerla, y de eso se encarga el agente — con el modelo y los permisos
        que ya elegiste.
      </p>

      <AgentSession cwd={vault} agent={agent} model={model} perm={perm} />

      <div className="cfgrow" style={{ marginTop: 22 }}>
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                onClick={openVault}>
          Abrir mi wiki
        </button>
        <span className="dim" style={{ fontSize: 11.5 }}>
          puedes abrirlo aunque el agente siga trabajando
        </span>
      </div>
    </div>
  );
}
