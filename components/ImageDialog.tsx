"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

export default function ImageDialog({ onClose, onInsert, onUpload }: {
  onClose: () => void;
  onInsert: (markdown: string) => void;
  onUpload: (file: File) => Promise<string | null>;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  async function insert() {
    setBusy(true);
    const href = tab === "upload" && file ? await onUpload(file) : url.trim();
    setBusy(false);
    if (!href) return;
    const title = caption.trim().replaceAll('"', "'");
    onInsert(`![${alt.trim()}](${encodeURI(href)}${title ? ` "${title}"` : ""})`);
  }

  const ready = tab === "upload" ? !!file : /^https?:\/\//i.test(url.trim());
  return (
    <div className="editormodal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="editormodal" role="dialog" aria-modal="true" aria-labelledby="image-dialog-title" ref={box}>
        <header><strong id="image-dialog-title">{t("image.title")}</strong><button onClick={onClose}>{t("common.cancel")}</button></header>
        <div className="editormodal-tabs">
          <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>{t("image.upload")}</button>
          <button className={tab === "url" ? "on" : ""} onClick={() => setTab("url")}>{t("image.url")}</button>
        </div>
        <div className="editormodal-body">
          {tab === "upload" ? (
            <label className="image-drop">
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <span>{file?.name ?? t("image.choose")}</span><small>{t("image.dropHint")}</small>
            </label>
          ) : <label>{t("image.urlLabel")}<input autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>}
          <label>{t("image.alt")}<input value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
          <label>{t("image.caption")}<input value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        </div>
        <footer><button onClick={onClose}>{t("common.cancel")}</button><button className="primary" disabled={!ready || busy} onClick={insert}>{busy ? t("image.uploading") : t("image.insert")}</button></footer>
      </div>
    </div>
  );
}
