"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import Editor from "./Editor.tsx";
import PdfViewer from "./PdfViewer.tsx";
import { isPdfId } from "./Tabs.tsx";

const AUTOSAVE_MS = 900;

/**
 * The second pane in a split. Holds either a PDF or a fully editable note.
 *
 * The point of the split is note-taking against a source: a PDF on one side,
 * the note on the other, with quotes flowing from the PDF into the note.
 */
export default function SidePane({
  id, onClose, onQuoteToMain,
}: {
  id: string;
  onClose: () => void;
  /** Send a pdf-plus style quote into the OTHER pane's editor. */
  onQuoteToMain?: (md: string) => void;
}) {
  const pdf = isPdfId(id);
  const [content, setContent] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ title: string; vaultPath: string } | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef("");
  const mtimeRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pdf) return;
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/note?id=${encodeURIComponent(id)}`);
      if (!r.ok) { setErr("no se pudo abrir la nota"); return; }
      const d = await r.json();
      if (cancelled) return;
      setContent(d.content);
      savedRef.current = d.content;
      mtimeRef.current = d.mtimeMs;
      setMeta({ title: d.meta?.title ?? id, vaultPath: d.meta?.path ?? id });
    })();
    return () => { cancelled = true; };
  }, [id, pdf]);

  const save = useCallback(async () => {
    const body = viewRef.current?.state.doc.toString();
    if (body === undefined || body === savedRef.current) return;
    setStatus("guardando…");
    const r = await fetch("/api/note", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, content: body, mtimeMs: mtimeRef.current }),
    });
    if (!r.ok) { setStatus("conflicto — recarga"); return; }
    const d = await r.json();
    mtimeRef.current = d.mtimeMs;
    savedRef.current = body;
    setStatus("guardado");
    setTimeout(() => setStatus((s) => (s === "guardado" ? "" : s)), 1400);
  }, [id]);

  const onChange = useCallback(() => {
    setStatus("sin guardar");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), AUTOSAVE_MS);
  }, [save]);

  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); save(); } }, [save]);

  const label = pdf ? id.slice(4).split("/").pop() : meta?.title ?? "…";
  const path = pdf ? id.slice(4) : meta?.vaultPath ?? "";

  return (
    <section className="pane">
      <header className="panehead">
        <span className="panetitle" title={path}>
          {pdf && <span className="otab-kind">PDF</span>}{label}
        </span>
        <span className="dim">{status}</span>
        <button onClick={onClose} title="Cerrar este panel">×</button>
      </header>

      <div className="panebody">
        {pdf ? (
          <PdfViewer
            src={`/api/asset?p=${encodeURIComponent(id.slice(4))}`}
            name={label ?? "pdf"}
            onQuote={onQuoteToMain}
          />
        ) : err ? (
          <p className="warn">{err}</p>
        ) : content === null ? (
          <p className="dim">Cargando…</p>
        ) : (
          <Editor
            value={content}
            onChange={onChange}
            resolve={() => null}
            onNavigate={() => {}}
            onReady={(v) => { viewRef.current = v; }}
          />
        )}
      </div>
    </section>
  );
}
