"use client";
import { useEffect, useState } from "react";
import { useT } from "./I18n";

function embedSource(input: string) {
  let src = input.trim().replaceAll('"', "%22");
  try {
    const parsed = new URL(src);
    if (parsed.hostname === "youtu.be") src = `https://www.youtube.com/embed/${parsed.pathname.slice(1)}`;
    else if (parsed.hostname.endsWith("youtube.com") && parsed.searchParams.get("v")) {
      src = `https://www.youtube.com/embed/${parsed.searchParams.get("v")}`;
    }
  } catch { /* Relative vault assets are valid video sources. */ }
  return /\.(?:mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(src)
    ? `<video controls src="${src}"></video>`
    : `<iframe src="${src}" allowfullscreen></iframe>`;
}

export default function VideoDialog({ onClose, onInsert, onUpload }: {
  onClose: () => void;
  onInsert: (html: string) => void;
  onUpload: (file: File) => Promise<string | null>;
}) {
  const t = useT();
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  async function insert() {
    setBusy(true);
    const href = tab === "upload" && file ? await onUpload(file) : url.trim();
    setBusy(false);
    if (href) onInsert(embedSource(href));
  }

  const ready = tab === "upload" ? !!file : /^(?:https?:\/\/|\.\.?\/|assets\/)/i.test(url.trim());
  return (
    <div className="editormodal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="editormodal" role="dialog" aria-modal="true" aria-labelledby="video-dialog-title">
        <header><strong id="video-dialog-title">{t("video.title")}</strong><button onClick={onClose}>{t("common.cancel")}</button></header>
        <div className="editormodal-tabs">
          <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>{t("image.upload")}</button>
          <button className={tab === "url" ? "on" : ""} onClick={() => setTab("url")}>{t("image.url")}</button>
        </div>
        <div className="editormodal-body">
          {tab === "upload" ? (
            <label className="image-drop">
              <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <span>{file?.name ?? t("video.choose")}</span><small>{t("video.dropHint")}</small>
            </label>
          ) : <label>{t("video.urlLabel")}<input autoFocus type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>}
        </div>
        <footer><button onClick={onClose}>{t("common.cancel")}</button><button className="primary" disabled={!ready || busy} onClick={insert}>{busy ? t("video.uploading") : t("video.insert")}</button></footer>
      </div>
    </div>
  );
}
