"use client";
import { useEffect } from "react";
import PdfViewer from "./PdfViewer.tsx";
import Crumb from "./Crumb.tsx";
import { useTabs } from "./Tabs.tsx";

export default function PdfClient({ path }: { path: string }) {
  const name = path.split("/").pop() ?? path;
  const tabs = useTabs();
  useEffect(() => { tabs?.register(`pdf:${path}`, name); }, [path, name]);
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
