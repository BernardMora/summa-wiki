"use client";
import { useEffect, useState } from "react";
import { postJSON, TimeoutError } from "./net";
import AgentSession from "./AgentSession";
import { useT } from "./I18n";
import { bold } from "./markup";

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
  const t = useT();
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
    const p = await window.summa?.chooseFolder(t("ingest.pickTitle"));
    if (p) setFolders((f) => (f.includes(p) ? f : [...f, p]));
    setPreview(null);
  }

  async function analyse() {
    if (!chosen.length) return;
    setBusy("analizando"); setErr(""); setPreview(null);
    try {
      const { ok, data } = await postJSON<Preview & { error?: string }>(
        "/api/ingest?dry=1", { folders: chosen });
      if (!ok) { setErr(data.error ?? t("setup.analyseFailed")); return; }
      setPreview(data);
    } catch (e) {
      setErr(e instanceof TimeoutError
        ? t("setup.analyseTimeout", { n: e.seconds })
        : t("setup.analyseFailed"));
    } finally { setBusy(""); }
  }

  async function apply() {
    setBusy("copiando"); setErr("");
    try {
      const { ok, data } = await postJSON<Done & { error?: string }>(
        "/api/ingest", { folders: chosen }, { timeoutMs: 300_000 });
      if (!ok) { setErr(data.error ?? t("setup.copyFailed")); return; }
      setDone(data);
    } catch (e) {
      setErr(e instanceof TimeoutError ? t("setup.copyTimeout", { n: e.seconds }) : t("setup.copyFailed"));
    } finally { setBusy(""); }
  }

  if (done) {
    return (
      <div className="welcome setupcreate">
        <h1>{t("ingest.copied")}</h1>
        <p>
          {t("ingest.filesEntered", { n: done.copied, inbox: preview?.inbox ?? "" })}
          {done.companions > 0 && t("ingest.withCompanions", {
            n: done.companions,
            noun: t(done.companions === 1 ? "ingest.companionNote" : "ingest.companionNotes"),
          })}.
          {done.skipped > 0 && t("ingest.skippedN", { n: done.skipped })}
        </p>
        <p className="cfghint">{t("ingest.originalsStay", { ledger: done.ledger })}</p>

        {done.errors.length > 0 && (
          <div className="err">
            {t("ingest.copyErrors", {
              n: done.errors.length,
              detail: done.errors.slice(0, 3).map((e) => e.error).join(" · "),
            })}
          </div>
        )}

        <h2 style={{ marginTop: 26 }}>{t("ingest.nowSorting")}</h2>
        <p>{t("ingest.sortedBySkill", { skill: "/vault-ingest" })}</p>

        {done.claude ? (
          <AgentSession cwd={done.vault} />
        ) : (
          <div className="warnbox">
            {bold(t("ingest.noClaude", { cmd: "claude", skill: "claude '/vault-ingest'" }))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="welcome setupcreate">
      <h1>{t("ingest.title")}</h1>
      <p>{bold(t("ingest.intro"))}</p>

      <div className="setupfield">
        <label>{t("setup.fieldSources")}</label>
        {desktop ? (
          <>
            <div className="cfgrow">
              <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                      onClick={addFolder}>{t("setup.addFolder")}</button>
            </div>
            {folders.map((f) => (
              <div key={f} className="cfgrow">
                <code className="cfgpath" style={{ flex: 1 }}>{f}</code>
                <button className="linkish" onClick={() => { setFolders((x) => x.filter((y) => y !== f)); setPreview(null); }}>
                  {t("setup.remove")}
                </button>
              </div>
            ))}
          </>
        ) : (
          <textarea rows={4} value={text}
                    onChange={(e) => { setText(e.target.value); setPreview(null); }}
                    placeholder={t("setup.sourcesPlaceholder")}
                    spellCheck={false} />
        )}
        <p className="cfghint">
          {t("ingest.skipsHint", { nodeModules: "node_modules", git: ".git" })}
        </p>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="cfgrow" style={{ marginTop: 14 }}>
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "6px 16px" }}
                disabled={!chosen.length || !!busy} onClick={analyse}>
          {busy === "analizando" ? t("setup.analysing", { n: elapsed }) : t("setup.analyse")}
        </button>
        {claude === null && (
          <span className="dim" style={{ fontSize: 11.5 }}>
            {t("ingest.noClaudeWarn", { cmd: "claude" })}
          </span>
        )}
      </div>

      {preview && (
        <div className="archpreview" style={{ marginTop: 18 }}>
          <p>
            {bold(t("setup.wouldEnter", {
              n: preview.willCopy, inbox: preview.inbox, size: mb(preview.bytes),
            }))}
          </p>
          <table className="structtable">
            <tbody>
              <tr><td><code>{preview.counts.note}</code></td><td>{t("setup.rowNotes")}</td></tr>
              <tr><td><code>{preview.counts.source}</code></td><td>{t("ingest.rowSourcesLong")}</td></tr>
              <tr><td><code>{preview.counts.image}</code></td><td>{t("setup.rowImages")}</td></tr>
              <tr><td><code>{preview.willSkip}</code></td><td>{t("setup.rowSkipped")}{preview.duplicates > 0 && t("ingest.skippedExactDup", { n: preview.duplicates })}</td></tr>
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
          {preview.unreadable.length > 0 && (
            <p className="cfghint">{t("ingest.unreadable", { n: preview.unreadable.length })}</p>
          )}

          {preview.sample.length > 0 && (
            <>
              <p className="cfghint">{t("ingest.firstFew")}</p>
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
