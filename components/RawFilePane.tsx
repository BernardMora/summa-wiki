"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CodePane from "./CodePane.tsx";
import { FileIcon, extOf } from "./FileIcon.tsx";

/**
 * El panel de "cualquier otro archivo".
 *
 * Antes era solo una ficha con un botón de descarga, porque la app no sabía
 * abrir nada que no fuera nota, PDF, imagen o canvas — hacer clic en un `.ts`
 * era un callejón sin salida. Ahora el servidor decide: si el archivo es texto
 * y cabe, se edita aquí mismo con resaltado; si es binario o enorme, se
 * conserva la ficha, que sigue siendo la respuesta correcta para un `.docx`.
 */

const NOTA: Record<string, string> = {
  excalidraw:
    "Dibujo de Excalidraw (formato del plugin de Obsidian: markdown con la escena comprimida). Todavía no hay editor para este formato en la app. Los diagramas de nodos y conexiones sí se editan aquí: son los archivos .canvas.",
  docx: "Documento de Word. Se abre en Word o en Google Docs desde Drive.",
  xlsx: "Hoja de cálculo. Se abre en Excel o en Google Sheets desde Drive.",
  pptx: "Presentación. Se abre en PowerPoint o en Google Slides desde Drive.",
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
      .catch(() => { if (alive) setErr("no se pudo leer el archivo"); });
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
        setErr("el archivo cambió en disco desde que se abrió — recarga la pestaña para ver la versión nueva");
        return;
      }
      if (!r.ok) { setErr(d.error ?? "no se pudo guardar"); return; }
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
          <p className="infoline"><span>{ext || "sin extensión"}</span><span>{kb(data.size)}</span><span>{rel}</span></p>
          <p>
            {data.tooBig
              ? `El archivo pesa ${kb(data.size)}; el editor abre hasta 2 MB. Descárgalo para verlo completo.`
              : (NOTA[ext] ?? "Es un archivo binario: no hay nada legible que mostrar como texto.")}
          </p>
          <p>
            <a className="centrego" href={href} download>Descargar</a>{" "}
            <a href={href} target="_blank" rel="noreferrer">Abrir en el navegador</a>
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
          <a className="dim" href={href} download>Descargar</a>
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
