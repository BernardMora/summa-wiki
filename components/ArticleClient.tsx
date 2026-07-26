"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Editor from "./Editor.tsx";

interface Ref { id: string; title: string; path: string; }
interface Meta {
  title: string; type: string; bundle: string; pathRel: string;
  created: string; updated: string; author: string; pillar: string;
  status: string; resource: string; tags: string[]; words: number;
  humanWords: number; agentWords: number;
}

type Tab = "article" | "data" | "links";

/**
 * Wikipedia-style article surface: tabs across the top, content below.
 * "Datos" and "Enlaces" replace Wikipedia's Talk/History — they show what
 * this wiki actually has, which is frontmatter and the link graph.
 */
export default function ArticleClient({
  id, meta, html, initialContent, mtimeMs, backlinks, outbound,
}: {
  id: string; meta: Meta; html: string; initialContent: string; mtimeMs: number;
  backlinks: Ref[]; outbound: Ref[];
}) {
  const [tab, setTab] = useState<Tab>("article");
  // ?edit=1 deep-links straight into the editor.
  const [editing, setEditing] = useState(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1",
  );
  const [hideProv, setHideProv] = useState(false);
  const [text, setText] = useState(initialContent);
  const [savedText, setSavedText] = useState(initialContent);
  const [mtime, setMtime] = useState(mtimeMs);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [provNote, setProvNote] = useState("");

  const dirty = text !== savedText;
  const totalWords = meta.humanWords + meta.agentWords;

  useEffect(() => { document.body.classList.toggle("hide-prov", hideProv); }, [hideProv]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(force = false) {
    setStatus("guardando…");
    const r = await fetch("/api/note", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: text, mtimeMs: force ? undefined : mtime }),
    });
    if (r.status === 409) { setConflict((await r.json()).currentContent); setStatus(""); return; }
    if (!r.ok) { setStatus("error al guardar"); return; }
    const d = await r.json();
    setMtime(d.mtimeMs); setSavedText(text); setStatus("guardado");
    if (d.wrapped || d.authorChanged) {
      setProvNote(
        [d.wrapped ? "tu edición quedó marcada como humana dentro de un bloque del agente" : "",
         d.authorChanged ? `author: ${d.authorChanged}` : ""].filter(Boolean).join(" · "),
      );
      setTimeout(() => setProvNote(""), 6000);
    }
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
      <div className="tabs" style={{ margin: "-20px -30px 18px", paddingTop: 6 }}>
        <button className={tab === "article" && !editing ? "on" : ""}
          onClick={() => { setTab("article"); setEditing(false); }}>Artículo</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => { setTab("data"); setEditing(false); }}>Datos</button>
        <button className={tab === "links" ? "on" : ""} onClick={() => { setTab("links"); setEditing(false); }}>
          Enlaces ({backlinks.length + outbound.length})
        </button>
        <span className="right">
          <button className={editing ? "on" : ""} onClick={() => { setEditing((v) => !v); setTab("article"); }}>
            {editing ? "Ver" : "Editar"}
          </button>
        </span>
      </div>

      <article>
        <h1>{meta.title}</h1>
        <p className="infoline">
          <span>{meta.type}</span>
          <span>{meta.bundle}</span>
          {meta.pillar && <span>{meta.pillar}</span>}
          <span>creada {meta.created || "—"}</span>
          <span>actualizada {meta.updated}</span>
          <span>{meta.words} palabras</span>
          {meta.agentWords > 0 && totalWords > 0 && (
            <span>{Math.round((100 * meta.agentWords) / totalWords)}% agente</span>
          )}
        </p>

        {tab === "article" && !editing && (
          <div
            className="prose"
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("a")) return;                       // let links navigate
              if (window.getSelection()?.toString()) return;    // let text selection be
              setEditing(true);
            }}
            title="Clic para editar"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {editing && <Editor value={text} onChange={setText} />}

        {tab === "data" && !editing && (
          <table>
            <tbody>
              <tr><th>type</th><td>{meta.type}</td></tr>
              <tr><th>title</th><td>{meta.title}</td></tr>
              <tr><th>created</th><td>{meta.created || <em className="dim">vacío — no derivable</em>}</td></tr>
              <tr><th>updated</th><td>{meta.updated}</td></tr>
              <tr><th>author</th><td>{meta.author}</td></tr>
              {meta.pillar && <tr><th>pillar</th><td>{meta.pillar}</td></tr>}
              {meta.status && <tr><th>status</th><td>{meta.status}</td></tr>}
              {meta.resource && <tr><th>resource</th><td>{meta.resource}</td></tr>}
              <tr><th>tags</th><td>{meta.tags.join(", ") || "—"}</td></tr>
              <tr><th>bundle</th><td>{meta.bundle}</td></tr>
              <tr><th>ruta</th><td><code>{meta.pathRel}</code></td></tr>
              <tr><th>autoría</th><td>{meta.humanWords} humano / {meta.agentWords} agente</td></tr>
            </tbody>
          </table>
        )}

        {tab === "links" && !editing && (
          <>
            <h2>Enlaces salientes ({outbound.length})</h2>
            {outbound.length === 0 ? <p className="dim">Ninguno.</p> : (
              <ul>{outbound.map((r) => (
                <li key={r.id}><Link href={`/note/${encodeURIComponent(r.id)}`}>{r.title}</Link> <span className="dim">{r.path}</span></li>
              ))}</ul>
            )}
            <h2>Enlaces entrantes ({backlinks.length})</h2>
            {backlinks.length === 0 ? <p className="dim">Ninguno — esta nota es huérfana.</p> : (
              <ul>{backlinks.map((r) => (
                <li key={r.id}><Link href={`/note/${encodeURIComponent(r.id)}`}>{r.title}</Link> <span className="dim">{r.path}</span></li>
              ))}</ul>
            )}
          </>
        )}
      </article>

      {tab === "article" && !editing && backlinks.length > 0 && (
        <section style={{ marginTop: 34, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 6px", fontFamily: "var(--sans)" }}>
            Enlaces entrantes ({backlinks.length})
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {backlinks.slice(0, 12).map((r) => (
              <li key={r.id}><Link href={`/note/${encodeURIComponent(r.id)}`}>{r.title}</Link></li>
            ))}
          </ul>
        </section>
      )}

      {conflict !== null && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--link-red)" }}>
          <p className="warn" style={{ margin: "0 0 6px" }}>El archivo cambió en disco desde que lo abriste.</p>
          <p className="dim" style={{ margin: "0 0 10px" }}>
            Probablemente lo editó el agente. Guardar ahora borraría ese cambio.
          </p>
          <button onClick={() => location.reload()}>Recargar del disco</button>{" "}
          <button className="primary" onClick={() => { setConflict(null); save(true); }}>
            Sobrescribir con lo mío
          </button>
        </div>
      )}

      <div className="bar">
        <button onClick={() => { setEditing((v) => !v); setTab("article"); }}>{editing ? "Ver" : "Editar"}</button>
        {editing && <button className="primary" disabled={!dirty} onClick={() => save()}>Guardar {dirty ? "•" : ""}</button>}
        <button onClick={() => setHideProv((v) => !v)}>{hideProv ? "Mostrar autoría" : "Ocultar autoría"}</button>
        <span className="dim">{status}</span>
        {provNote && <span className="provnote">{provNote}</span>}
        {dirty && !status && <span className="warn">sin guardar</span>}
        <span style={{ marginLeft: "auto" }} className="dim">⌘S guarda</span>
      </div>
    </>
  );
}
