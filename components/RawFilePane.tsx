"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CodePane from "./CodePane.tsx";
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
  const name = rel.split("/").pop() ?? rel;
  const ext = extOf(name);
  const href = `/api/asset?p=${encodeURIComponent(rel)}`;

  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // El texto en vuelo no vive en el estado de React: cambiarlo en cada
  // pulsación volvería a renderizar el panel entero y CodeMirror ya lleva su
  // propio documento. Solo se lee al guardar.
  const draft = useRef("");
  const mtime = useRef(0);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(""); setDirty(false);
    fetch(`/api/file?p=${encodeURIComponent(rel)}`)
      .then((r) => r.json())
      .then((d: Loaded & { error?: string }) => {
        if (!alive) return;
        if (d.error) { setErr(d.error); return; }
        draft.current = d.text ?? "";
        mtime.current = d.mtimeMs;
        setData(d);
      })
      .catch(() => { if (alive) setErr(t("raw.readFailed")); });
    return () => { alive = false; };
  }, [rel]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: rel, text: draft.current, mtimeMs: mtime.current }),
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
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } finally {
      setSaving(false);
    }
  }, [rel, saving]);

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

  return (
    <div className="imgview">
      <div className="imgbar">
        <FileIcon name={name} />
        <span className="imgname">{name}{dirty ? " •" : ""}</span>
        <span className="dim" style={{ fontSize: 11.5 }}>{kb(data.size)}</span>
        {err && <span className="err" style={{ fontSize: 11.5, whiteSpace: "normal" }}>{err}</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {saved && <span className="dim" style={{ fontSize: 11.5 }}>guardado</span>}
          <button className="newbtn" style={{ width: "auto", margin: 0, padding: "2px 10px" }}
                  disabled={!dirty || saving} onClick={save}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <a className="dim" href={href} download>{t("chrome.download")}</a>
        </span>
      </div>
      <div className="codewrap">
        <CodePane
          key={rel}
          filename={name}
          value={data.text ?? ""}
          onChange={(v) => { draft.current = v; if (!dirty) setDirty(true); }}
          onSave={() => { if (dirty) save(); }}
        />
      </div>
    </div>
  );
}
