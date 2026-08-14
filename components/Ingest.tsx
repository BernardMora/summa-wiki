"use client";
import { useEffect, useState } from "react";
import { postJSON, TimeoutError } from "./net";
import AgentSession from "./AgentSession";

/**
 * Traer carpetas del disco al vault.
 *
 * Dos pasos separados a propósito —medir y después escribir— porque sin vista
 * previa el usuario estaría autorizando a ciegas una operación que copia miles
 * de archivos. Es el mismo patrón del script de enlaces de la Fase 9.
 *
 * Lo que esta pantalla NO hace es clasificar. Copia a la bandeja conservando la
 * estructura de origen, y el reparto lo hace el agente después: decidir si un
 * documento es un proyecto o una referencia exige leerlo, y eso no lo resuelve
 * una extensión de archivo.
 */

interface Preview {
  counts: { note: number; source: number; image: number; skip: number };
  bytes: number;
  duplicates: number;
  unreadable: string[];
  truncated: boolean;
  truncatedBy?: "files" | "time";
  willCopy: number;
  willSkip: number;
  sample: { from: string; to: string; kind: string }[];
  inbox: string;
}

interface Done {
  copied: number;
  companions: number;
  skipped: number;
  errors: { from: string; error: string }[];
  ledger: string;
  skill: string;
  claude: string | null;
  vault: string;
}

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function Ingest() {
  const [folders, setFolders] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [desktop, setDesktop] = useState(false);
  const [claude, setClaude] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  /** Segundos transcurridos: distingue «va a tardar» de «esto ya no vuelve». */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    setDesktop(typeof window !== "undefined" && !!window.summa);
    fetch("/api/ingest").then((r) => r.json()).then((d) => setClaude(d.claude)).catch(() => {});
  }, []);

  const chosen = desktop ? folders : text.split("\n").map((s) => s.trim()).filter(Boolean);

  async function addFolder() {
    const p = await window.summa?.chooseFolder("Carpeta que quieres traer al vault");
    if (p) setFolders((f) => (f.includes(p) ? f : [...f, p]));
    setPreview(null);
  }

  async function analyse() {
    if (!chosen.length) return;
    setBusy("analizando"); setErr(""); setPreview(null);
    try {
      const { ok, data } = await postJSON<Preview & { error?: string }>(
        "/api/ingest?dry=1", { folders: chosen });
      if (!ok) { setErr(data.error ?? "no se pudo analizar"); return; }
      setPreview(data);
    } catch (e) {
      setErr(e instanceof TimeoutError
        ? `El análisis no respondió en ${e.seconds} s. Suele pasar con carpetas en la nube (Drive, iCloud): prueba con una carpeta más concreta.`
        : "no se pudo analizar");
    } finally { setBusy(""); }
  }

  async function apply() {
    setBusy("copiando"); setErr("");
    try {
      const { ok, data } = await postJSON<Done & { error?: string }>(
        "/api/ingest", { folders: chosen }, { timeoutMs: 300_000 });
      if (!ok) { setErr(data.error ?? "no se pudo copiar"); return; }
      setDone(data);
    } catch (e) {
      setErr(e instanceof TimeoutError ? `La copia no terminó en ${e.seconds} s.` : "no se pudo copiar");
    } finally { setBusy(""); }
  }

  if (done) {
    return (
      <div className="welcome setupcreate">
        <h1>Copiado</h1>
        <p>
          {done.copied} archivos entraron a <code>{preview?.inbox}</code>
          {done.companions > 0 && <>, con {done.companions} {done.companions === 1 ? "nota compañera" : "notas compañeras"}</>}.
          {done.skipped > 0 && <> Se saltaron {done.skipped}.</>}
        </p>
        <p className="cfghint">
          Los originales siguen donde estaban — esto copió, no movió. El registro
          de qué salió de dónde está en <code>{done.ledger}</code>.
        </p>

        {done.errors.length > 0 && (
          <div className="err">
            {done.errors.length} archivos no se pudieron copiar: {done.errors.slice(0, 3).map((e) => e.error).join(" · ")}
          </div>
        )}

        <h2 style={{ marginTop: 26 }}>Ahora el reparto</h2>
        <p>
          Todo está en la bandeja, con la estructura de carpetas que traía. Para
          decidir en qué parte del vault va cada nota hay que leerla, y de eso se
          encarga el agente con la skill <code>/vault-ingest</code> que se acaba
          de escribir en tu vault.
        </p>

        {done.claude ? (
          <AgentSession cwd={done.vault} />
        ) : (
          <div className="warnbox">
            <strong>No se encontró <code>claude</code>.</strong> El reparto
            automático necesita Claude Code instalado. <strong>Tus archivos ya
            están dentro del vault</strong> y se pueden mover a mano; o instálalo
            y corre <code>claude &apos;/vault-ingest&apos;</code> desde el vault.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="welcome setupcreate">
      <h1>Traer carpetas al vault</h1>
      <p>
        Copia archivos de tu computadora al vault. Los originales no se tocan:
        esto <strong>copia</strong>, nunca mueve ni borra.
      </p>

      <div className="setupfield">
        <label>Qué carpetas</label>
        {desktop ? (
          <>
            <div className="cfgrow">
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                      onClick={addFolder}>Agregar carpeta…</button>
            </div>
            {folders.map((f) => (
              <div key={f} className="cfgrow">
                <code className="cfgpath" style={{ flex: 1 }}>{f}</code>
                <button className="linkish" onClick={() => { setFolders((x) => x.filter((y) => y !== f)); setPreview(null); }}>
                  quitar
                </button>
              </div>
            ))}
          </>
        ) : (
          <textarea rows={4} value={text}
                    onChange={(e) => { setText(e.target.value); setPreview(null); }}
                    placeholder={"~/Documents/notas-viejas\n~/Desktop/pendientes"}
                    spellCheck={false} />
        )}
        <p className="cfghint">
          Se saltan <code>node_modules</code>, <code>.git</code>, archivos
          ocultos, ejecutables y todo lo que pese más de 100 MB. Los duplicados
          exactos entran una sola vez.
        </p>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="cfgrow" style={{ marginTop: 14 }}>
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                disabled={!chosen.length || !!busy} onClick={analyse}>
          {busy === "analizando" ? `Analizando… ${elapsed}s` : "Analizar"}
        </button>
        {claude === null && (
          <span className="dim" style={{ fontSize: 11.5 }}>
            sin <code>claude</code> en el PATH — se podrá copiar, pero no repartir
          </span>
        )}
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
              <tr><td><code>{preview.counts.source}</code></td><td>documentos (PDF, docx…) — cada uno con su nota compañera</td></tr>
              <tr><td><code>{preview.counts.image}</code></td><td>imágenes</td></tr>
              <tr><td><code>{preview.willSkip}</code></td><td>se saltan{preview.duplicates > 0 && `, de los cuales ${preview.duplicates} son duplicados exactos`}</td></tr>
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
          {preview.unreadable.length > 0 && (
            <p className="cfghint">No se pudieron leer {preview.unreadable.length} carpetas (permisos).</p>
          )}

          {preview.sample.length > 0 && (
            <>
              <p className="cfghint">Los primeros, para que veas la forma:</p>
              <ul className="catlist">
                {preview.sample.slice(0, 8).map((a) => (
                  <li key={a.to}><code>{a.to}</code></li>
                ))}
              </ul>
            </>
          )}

          <div className="cfgrow" style={{ marginTop: 12 }}>
            <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                    disabled={!!busy || preview.willCopy === 0} onClick={apply}>
              {busy === "copiando" ? "Copiando…" : `Copiar ${preview.willCopy} archivos al vault`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
