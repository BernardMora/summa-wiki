"use client";
import { useEffect, useState } from "react";
import Editor from "./Editor.tsx";

/**
 * Read/edit surface for one note.
 *
 * Saving carries the mtime the buffer was loaded with. If the file changed on
 * disk meanwhile — the agent edited it while this tab sat open — the server
 * returns 409 and we surface the choice rather than silently overwriting.
 * There is no snapshot layer by design, so this is the only net between commits.
 */
export default function NoteClient({
  id, initialContent, mtimeMs, html,
}: { id: string; initialContent: string; mtimeMs: number; html: string }) {
  const [editing, setEditing] = useState(false);
  const [hideProv, setHideProv] = useState(false);
  const [text, setText] = useState(initialContent);
  const [savedText, setSavedText] = useState(initialContent);
  const [mtime, setMtime] = useState(mtimeMs);
  const [status, setStatus] = useState<string>("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const dirty = text !== savedText;

  useEffect(() => {
    document.body.classList.toggle("hide-prov", hideProv);
  }, [hideProv]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(force = false) {
    setStatus("guardando…");
    const r = await fetch("/api/note", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: text, mtimeMs: force ? undefined : mtime }),
    });
    if (r.status === 409) {
      const d = await r.json();
      setConflict(d.currentContent);
      setStatus("");
      return;
    }
    if (!r.ok) { setStatus("error al guardar"); return; }
    const d = await r.json();
    setMtime(d.mtimeMs);
    setSavedText(text);
    setStatus("guardado");
    setTimeout(() => setStatus(""), 1800);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (editing && dirty) save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dirty, text, mtime]);

  return (
    <>
      {!editing && <div dangerouslySetInnerHTML={{ __html: html }} />}
      {editing && <Editor key={key} value={text} onChange={setText} />}

      {conflict !== null && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #c0392b", borderRadius: 8 }}>
          <p className="warn" style={{ margin: "0 0 8px" }}>
            El archivo cambió en disco desde que lo abriste.
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>
            Probablemente lo editó el agente. Guardar ahora borraría ese cambio.
          </p>
          <button onClick={() => { setText(conflict); setSavedText(conflict); setConflict(null); setKey((k) => k + 1); location.reload(); }}>
            Recargar del disco (descarta lo mío)
          </button>{" "}
          <button className="primary" onClick={() => { setConflict(null); save(true); }}>
            Sobrescribir con lo mío
          </button>
        </div>
      )}

      <div className="bar">
        <button onClick={() => setEditing((v) => !v)}>{editing ? "Leer" : "Editar"}</button>
        {editing && (
          <button className="primary" disabled={!dirty} onClick={() => save()}>
            Guardar {dirty ? "•" : ""}
          </button>
        )}
        <button onClick={() => setHideProv((v) => !v)}>
          {hideProv ? "Mostrar autoría" : "Ocultar autoría"}
        </button>
        <span style={{ color: "var(--muted)" }}>{status}</span>
        {dirty && !status && <span className="warn">sin guardar</span>}
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>⌘S guarda</span>
      </div>
    </>
  );
}
