"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CodePane from "./CodePane.tsx";
import Editor, { useImageStrings } from "./Editor.tsx";
import { FileIcon, extOf } from "./FileIcon.tsx";
import { useT } from "./I18n";
import type { MessageKey } from "@/lib/i18n.ts";

/**
 * El panel de "cualquier otro archivo".
 *
 * Antes era solo una ficha con un botón de descarga, porque la app no sabía
 * abrir nada que no fuera nota, PDF, imagen o canvas — hacer clic en un `.ts`
 * era un callejón sin salida. Ahora el servidor decide: si el archivo es texto
 * y cabe, se edita aquí mismo con resaltado; si es binario o enorme, se
 * conserva la ficha, que sigue siendo la respuesta correcta para un `.docx`.
 */

/**
 * Qué es cada formato que la app no sabe editar. Claves, no texto: este mapa es
 * una constante de módulo y se resolvería una sola vez, en el idioma que
 * hubiera al cargar.
 */
const NOTA: Record<string, MessageKey> = {
  excalidraw: "raw.excalidraw",
  docx: "raw.docx",
  xlsx: "raw.xlsx",
  pptx: "raw.pptx",
};
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "ogv", "mov"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const AUTOSAVE_DELAY = 700;

const kb = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

interface Loaded {
  text?: string;
  binary?: boolean;
  tooBig?: boolean;
  size: number;
  mtimeMs: number;
}

export default function RawFilePane({ rel }: { rel: string }) {
  const t = useT();
  const imageStrings = useImageStrings();
  const name = rel.split("/").pop() ?? rel;
  const ext = extOf(name);
  const href = `/api/asset?p=${encodeURIComponent(rel)}`;

  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [htmlMode, setHtmlMode] = useState<"view" | "raw">("view");
  const [markdownMode, setMarkdownMode] = useState<"preview" | "raw">("preview");
  const [previewHtml, setPreviewHtml] = useState("");
  // El texto en vuelo no vive en el estado de React: cambiarlo en cada
  // pulsación volvería a renderizar el panel entero y CodeMirror ya lleva su
  // propio documento. Solo se lee al guardar.
  const draft = useRef("");
  const mtime = useRef(0);
  const revision = useRef(0);
  const savingRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    setData(null); setErr(""); setDirty(false); setHtmlMode("view"); setMarkdownMode("preview");
    revision.current = 0;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    fetch(`/api/file?p=${encodeURIComponent(rel)}`)
      .then((r) => r.json())
      .then((d: Loaded & { error?: string }) => {
        if (!alive) return;
        if (d.error) { setErr(d.error); return; }
        draft.current = d.text ?? "";
        setPreviewHtml(d.text ?? "");
        mtime.current = d.mtimeMs;
        setData(d);
      })
      .catch(() => { if (alive) setErr(t("raw.readFailed")); });
    return () => {
      alive = false;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [rel]);

  const showHtml = useCallback(() => {
    // The editor owns the live document, so take its current value when the
    // user switches back instead of previewing the last saved snapshot.
    setPreviewHtml(draft.current);
    setHtmlMode("view");
  }, []);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const savingRevision = revision.current;
    const text = draft.current;
    savingRef.current = true;
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: rel, text, mtimeMs: mtime.current }),
      });
      const d = await r.json();
      if (r.status === 409) {
        // No se pisa nada sin avisar: el archivo cambió por fuera mientras se
        // editaba (git, otro editor, un agente).
        setErr(t("raw.changedOnDisk"));
        return;
      }
      if (!r.ok) { setErr(d.error ?? t("raw.saveFailed")); return; }
      mtime.current = d.mtimeMs;
      if (revision.current === savingRevision) {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1400);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      // Si el usuario siguió escribiendo durante la petición, guarda esa
      // revisión después de que el mtime de la anterior ya esté actualizado.
      if (revision.current !== savingRevision) {
        autosaveTimer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY);
      }
    }
  }, [rel, t]);
  saveRef.current = save;

  const changeDraft = useCallback((value: string, autosave: boolean) => {
    draft.current = value;
    revision.current++;
    setDirty(true);
    if (!autosave) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY);
  }, []);

  // ⌘S también fuera del editor: el foco puede estar en la barra del panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty) { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, dirty]);

  if (err && !data) {
    return <div className="panescroll"><article><h1>{name}</h1><p className="err">{err}</p></article></div>;
  }
  if (!data) {
    return <div className="panescroll"><p className="dim" style={{ padding: 20 }}>Abriendo {name}…</p></div>;
  }

  // Videos are binary, but unlike an office archive they have a useful native
  // preview. Keeping it inside the pane lets users verify an asset without
  // leaving the vault or opening a second application.
  if ((data.binary || data.tooBig) && VIDEO_EXTENSIONS.has(ext)) {
    return (
      <div className="imgview">
        <div className="imgbar">
          <FileIcon name={name} />
          <span className="imgname">{name}</span>
          <span className="dim" style={{ fontSize: 11.5 }}>{kb(data.size)}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <a className="dim" href={href} download>{t("chrome.download")}</a>
            <a className="dim" href={href} target="_blank" rel="noreferrer">{t("raw.openInBrowser")}</a>
          </span>
        </div>
        <div className="videopreview">
          <video key={rel} src={href} controls preload="metadata" playsInline>
            {t("raw.videoUnsupported")}
          </video>
        </div>
      </div>
    );
  }

  // Binario o demasiado grande: la ficha de siempre.
  if (data.binary || data.tooBig) {
    return (
      <div className="panescroll">
        <article>
          <h1>{name}</h1>
          <p className="infoline"><span>{ext || t("raw.noExtension")}</span><span>{kb(data.size)}</span><span>{rel}</span></p>
          <p>
            {data.tooBig
              ? t("raw.tooBig", { size: kb(data.size) })
              : (NOTA[ext] ? t(NOTA[ext]) : t("raw.binary"))}
          </p>
          <p>
            <a className="centrego" href={href} download>{t("chrome.download")}</a>{" "}
            <a href={href} target="_blank" rel="noreferrer">{t("raw.openInBrowser")}</a>
          </p>
        </article>
      </div>
    );
  }

  const isHtml = HTML_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  const previewBase = `/api/html-preview/${rel.split("/").slice(0, -1).map(encodeURIComponent).join("/")}${rel.includes("/") ? "/" : ""}`;
  const htmlWithBase = previewHtml.replace(
    /<head(\s[^>]*)?>/i,
    (head) => `${head}<base href="${previewBase}">`,
  );

  return (
    <div className="imgview">
      {isMarkdown ? <>
        <div className="markdown-file-controls">
          {(saving || saved || err) && <span className={err ? "err" : "dim"}>
            {err || (saving ? t("common.saving") : t("common.saved"))}
          </span>}
          <span className="markdown-view-toggle" role="group" aria-label={t("raw.markdownDisplayMode")}>
            <button type="button" className={markdownMode === "preview" ? "on" : ""}
                    aria-pressed={markdownMode === "preview"} onClick={() => setMarkdownMode("preview")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>
              {t("raw.preview")}
            </button>
            <button type="button" className={markdownMode === "raw" ? "on" : ""}
                    aria-pressed={markdownMode === "raw"} onClick={() => setMarkdownMode("raw")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4l-3 16"/></svg>
              {t("raw.raw")}
            </button>
          </span>
        </div>
        <div className="markdown-file-editor">
          <Editor
            key={rel}
            value={data.text ?? ""}
            onChange={(value) => changeDraft(value, true)}
            resolve={() => null}
            imageStrings={imageStrings}
            onNavigate={(url) => {
              if (/^https?:/i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
            }}
            showFrontmatter={markdownMode === "raw"}
            rawMarkdown={markdownMode === "raw"}
          />
        </div>
      </> : <>
      <div className="imgbar">
        <FileIcon name={name} />
        <span className="imgname">{name}{dirty ? " •" : ""}</span>
        <span className="dim" style={{ fontSize: 11.5 }}>{kb(data.size)}</span>
        {err && <span className="err" style={{ fontSize: 11.5, whiteSpace: "normal" }}>{err}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {isHtml && <span className="fileviewtoggle" role="group" aria-label={t("raw.displayMode")}>
            <button type="button" className={htmlMode === "view" ? "on" : ""}
                    aria-pressed={htmlMode === "view"} onClick={showHtml}>{t("raw.view")}</button>
            <button type="button" className={htmlMode === "raw" ? "on" : ""}
                    aria-pressed={htmlMode === "raw"} onClick={() => setHtmlMode("raw")}>{t("raw.raw")}</button>
          </span>}
          {saved && <span className="dim" style={{ fontSize: 11.5 }}>{t("common.saved")}</span>}
          <button className="newbtn" style={{ width: "auto", margin: 0, padding: "2px 10px" }}
                  disabled={!dirty || saving} onClick={save}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
          <a className="dim" href={href} download>{t("chrome.download")}</a>
        </span>
      </div>
      {isHtml && htmlMode === "view" ? (
        <div className="htmlpreview">
          <iframe
            key={`${rel}:${previewHtml}`}
            title={name}
            srcDoc={/<head(?:\s[^>]*)?>/i.test(previewHtml) ? htmlWithBase : `<base href="${previewBase}">${previewHtml}`}
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          />
        </div>
      ) : <div className="codewrap">
        <CodePane
          key={rel}
          filename={name}
          value={data.text ?? ""}
          onChange={(v) => changeDraft(v, false)}
          onSave={() => { if (dirty) save(); }}
        />
      </div>}
      </>}
    </div>
  );
}
