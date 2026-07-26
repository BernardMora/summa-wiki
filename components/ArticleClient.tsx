"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import Editor, { markSelection, unmarkSelection } from "./Editor.tsx";
import { useTabs } from "./Tabs.tsx";
import Toc, { parseHeads, type Head } from "./Toc.tsx";

interface Ref { id: string; title: string; path: string; }
interface Meta {
  title: string; type: string; bundle: string; pathRel: string;
  created: string; updated: string; author: string; pillar: string;
  status: string; resource: string; tags: string[]; words: number;
  humanWords: number; agentWords: number;
}
type Tab = "article" | "data" | "links";

const AUTOSAVE_MS = 900;

/**
 * One view, always editable — no read/edit toggle. The live-preview editor IS
 * the article, and saves happen automatically after a pause in typing.
 *
 * Provenance is explicit rather than inferred. With autosave firing constantly
 * there is no meaningful "before" to diff against, so guessing would produce
 * marker soup. Instead you select text and mark it, or set `author:` for the
 * file as a whole.
 */
export default function ArticleClient({
  id, meta, initialContent, mtimeMs, backlinks, outbound, resolve,
}: {
  id: string; meta: Meta; initialContent: string; mtimeMs: number;
  backlinks: Ref[]; outbound: Ref[]; resolve: Record<string, string>;
}) {
  const [tab, setTab] = useState<Tab>("article");
  const [hideProv, setHideProv] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [heads, setHeads] = useState<Head[]>(() => parseHeads(initialContent));
  const [viewReady, setViewReady] = useState<import("@codemirror/view").EditorView | null>(null);

  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef(initialContent);
  const mtimeRef = useRef(mtimeMs);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const tabs = useTabs();

  // A note reached directly (search, backlink, URL) starts with a placeholder
  // title in the strip; replace it with the real one.
  useEffect(() => { tabs?.register(id, meta.title); }, [id, meta.title]);

  useEffect(() => { document.body.classList.toggle("hide-prov", hideProv); }, [hideProv]);

  const save = useCallback(async (force = false) => {
    const body = viewRef.current?.state.doc.toString();
    if (body === undefined) return;
    if (body === savedRef.current && !force) return;
    setStatus("guardando…");
    const r = await fetch("/api/note", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: body, mtimeMs: force ? undefined : mtimeRef.current }),
    });
    if (r.status === 409) { setConflict((await r.json()).currentContent); setStatus(""); return; }
    if (!r.ok) { setStatus("error al guardar"); return; }
    const d = await r.json();
    mtimeRef.current = d.mtimeMs;
    savedRef.current = body;
    setStatus("guardado");
    setTimeout(() => setStatus((s) => (s === "guardado" ? "" : s)), 1400);
  }, [id]);

  const onChange = useCallback(() => {
    const doc = viewRef.current?.state.doc.toString();
    if (doc !== undefined) setHeads(parseHeads(doc));
    setStatus("sin guardar");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), AUTOSAVE_MS);
  }, [save]);

  // Flush pending work when the window loses focus or the tab is hidden.
  useEffect(() => {
    const flush = () => { if (timer.current) clearTimeout(timer.current); save(); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    const warn = (e: BeforeUnloadEvent) => {
      if ((viewRef.current?.state.doc.toString() ?? "") !== savedRef.current) {
        e.preventDefault(); e.returnValue = "";
      }
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const resolveHref = useCallback((href: string) => resolve[href] ?? null, [resolve]);
  const total = meta.humanWords + meta.agentWords;

  function doMark(kind: "human" | "ai") {
    const v = viewRef.current;
    if (v && markSelection(v, kind)) { onChange(); setHasSel(false); }
  }
  function doUnmark() {
    const v = viewRef.current;
    if (v && unmarkSelection(v)) onChange();
  }

  return (
    <>
      <div className="tabs" style={{ margin: "-20px -30px 18px", paddingTop: 6 }}>
        <button className={tab === "article" ? "on" : ""} onClick={() => setTab("article")}>Artículo</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>Datos</button>
        <button className={tab === "links" ? "on" : ""} onClick={() => setTab("links")}>
          Enlaces ({backlinks.length + outbound.length})
        </button>
      </div>

      <div className="artrow">
      <article>
        <h1>{meta.title}</h1>
        <p className="infoline">
          <span>{meta.type}</span>
          <span>{meta.bundle}</span>
          {meta.pillar && <span>{meta.pillar}</span>}
          <span>creada {meta.created || "—"}</span>
          <span>actualizada {meta.updated}</span>
          <span>{meta.words} palabras</span>
          {meta.agentWords > 0 && total > 0 && (
            <span>{Math.round((100 * meta.agentWords) / total)}% agente</span>
          )}
        </p>

        {/* Kept mounted across tabs so the editor never loses its buffer. */}
        <div
          style={{ display: tab === "article" ? "block" : "none" }}
          onMouseUp={() => {
            const v = viewRef.current;
            setHasSel(Boolean(v && v.state.selection.main.from !== v.state.selection.main.to));
          }}
        >
          <Editor
            value={initialContent}
            onChange={onChange}
            resolve={resolveHref}
            onNavigate={(url) => router.push(url)}
            onReady={(v) => { viewRef.current = v; setViewReady(v); }}
            onPasteImage={async (file) => {
              const fd = new FormData();
              fd.append("id", id);
              fd.append("file", file);
              const r = await fetch("/api/upload", { method: "POST", body: fd });
              if (!r.ok) { setStatus("no se pudo subir la imagen"); return null; }
              const d = await r.json();
              return d.href as string;
            }}
          />
        </div>

        {tab === "data" && (
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

        {tab === "links" && (
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
      {tab === "article" && <Toc heads={heads} view={viewReady} />}
      </div>

      {tab === "article" && backlinks.length > 0 && (
        <section style={{ marginTop: 28, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
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
        <button onClick={() => doMark("human")} disabled={!hasSel} title="Marca la selección como escrita por ti">
          Marcar como mío
        </button>
        <button onClick={() => doMark("ai")} disabled={!hasSel} title="Marca la selección como escrita por el agente">
          Marcar como IA
        </button>
        <button onClick={doUnmark} title="Quita los marcadores del bloque donde está el cursor">
          Quitar marca
        </button>
        <button onClick={() => setHideProv((v) => !v)}>
          {hideProv ? "Mostrar autoría" : "Ocultar autoría"}
        </button>
        <span className="dim">{status}</span>
        <span style={{ marginLeft: "auto" }} className="dim">
          guardado automático · ⌘S fuerza · ⌘clic sigue enlaces
        </span>
      </div>
    </>
  );
}
