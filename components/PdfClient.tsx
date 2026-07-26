"use client";
import PdfViewer from "./PdfViewer.tsx";
import Crumb from "./Crumb.tsx";

export default function PdfClient({ path }: { path: string }) {
  const name = path.split("/").pop() ?? path;
  const src = `/api/asset?p=${encodeURIComponent(path)}`;
  return (
    <article>
      <h1 style={{ fontSize: 22 }}>{name}</h1>
      <p className="infoline">
        <span>PDF</span>
        <span>selecciona texto para citar</span>
      </p>
      <div style={{ marginBottom: 10 }}><Crumb vaultPath={path} /></div>
      <PdfViewer src={src} name={name} />
    </article>
  );
}
