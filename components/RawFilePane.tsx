"use client";

/**
 * Ficha para archivos que la app no sabe abrir todavía.
 *
 * Antes el explorador mandaba estos archivos a `/api/asset` en una pestaña del
 * navegador, lo que en la práctica los descargaba sin avisar: parecía que el
 * clic no había hecho nada, o peor, que la app estaba rota.
 */
const NOTA: Record<string, string> = {
  "excalidraw.md":
    "Dibujo de Excalidraw (formato del plugin de Obsidian: markdown con la escena comprimida). Todavía no hay editor para este formato en la app. Los diagramas de nodos y conexiones sí se editan aquí: son los archivos .canvas.",
  docx: "Documento de Word. Se abre en Word o en Google Docs desde Drive.",
  xlsx: "Hoja de cálculo. Se abre en Excel o en Google Sheets desde Drive.",
  pptx: "Presentación. Se abre en PowerPoint o en Google Slides desde Drive.",
};

export default function RawFilePane({ rel }: { rel: string }) {
  const name = rel.split("/").pop() ?? rel;
  const ext = name.toLowerCase().endsWith(".excalidraw.md")
    ? "excalidraw.md"
    : (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
  const href = `/api/asset?p=${encodeURIComponent(rel)}`;

  return (
    <div className="panescroll">
      <article>
        <h1>{name}</h1>
        <p className="infoline"><span>{ext || "sin extensión"}</span><span>{rel}</span></p>
        <p>{NOTA[ext] ?? "La app no tiene visor para este tipo de archivo."}</p>
        <p>
          <a className="centrego" href={href} download>Descargar</a>{" "}
          <a href={href} target="_blank" rel="noreferrer">Abrir en el navegador</a>
        </p>
      </article>
    </div>
  );
}
