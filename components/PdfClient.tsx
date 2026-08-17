"use client";
import PdfViewer from "./PdfViewer.tsx";
import Crumb from "./Crumb.tsx";
import { useT } from "./I18n";

/** Standalone PDF route, used when a PDF URL is opened directly. */
export default function PdfClient({ path }: { path: string }) {
  const t = useT();
  const name = path.split("/").pop() ?? path;
  return (
    <article>
      <h1 style={{ fontSize: 22 }}>{name}</h1>
      <p className="infoline"><span>PDF</span><span>{t("pdf.selectToCite")}</span></p>
      <div style={{ marginBottom: 10 }}><Crumb vaultPath={path} /></div>
      <PdfViewer src={`/api/asset?p=${encodeURIComponent(path)}`} name={name} path={path} />
    </article>
  );
}
