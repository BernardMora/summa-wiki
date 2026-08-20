"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import Editor, { markSelection, unmarkSelection } from "./Editor.tsx";
import Toc, { parseHeads, type Head } from "./Toc.tsx";
import Crumb from "./Crumb.tsx";
import { useTabs } from "./Tabs.tsx";
import LinkPicker, { type LinkQuery, type LinkTarget } from "./LinkPicker.tsx";
import { useT } from "./I18n";
import EditorToolbar from "./EditorToolbar.tsx";
import ImageDialog from "./ImageDialog.tsx";
import VideoDialog from "./VideoDialog.tsx";
import { insertText } from "./editorCommands.ts";

export interface Ref { id: string; title: string; path: string; }
export interface Meta {
  title: string; type: string; bundle: string; pathRel: string;
  created: string; updated: string; author: string; pillar: string;
  status: string; resource: string; tags: string[]; words: number;
  humanWords: number; agentWords: number; vaultPath: string;
  /** One of the six identity articles. */
  core?: boolean;
  /** Every category this note falls into — a note may be in several. */
  categories?: { id: string; label: string }[];
}
export interface Payload {
  id: string; content: string; mtimeMs: number; meta: Meta;
  backlinks: Ref[]; outbound: Ref[]; resolve: Record<string, string>;
}

type Tab = "article" | "data" | "links";
const AUTOSAVE_MS = 900;

/**
 * Guardados en vuelo, por nota. Al cambiar de pestaña el panel se desmonta y
 * vacía su autosave, pero ese PUT es asíncrono: si se vuelve enseguida, el
 * GET podría leer el archivo antes de que aterrice. Esperar aquí cierra la
 * carrera sin bloquear el desmontaje.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * One article, complete: its own tabs, editor, autosave, provenance controls
 * and contents rail. Used for the main pane and for a note opened in a split,
 * so a side pane is a real article rather than a cut-down preview.
 */
export default function ArticlePane({
  initial, id, secondary, onClose, onEditorReady, showToc = true,
}: {
  /** Seeded server-side for the main pane. */
  initial?: Payload;
  /** Fetched when no payload is given. */
  id?: string;
  /** Renders the pane header with a close button. */
  secondary?: boolean;
  onClose?: () => void;
  onEditorReady?: (v: EditorView) => void;
  showToc?: boolean;
}) {
  const t = useT();
  const [data, setData] = useState<Payload | null>(initial ?? null);
  const [tab, setTab] = useState<Tab>("article");
  const [hideProv, setHideProv] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [heads, setHeads] = useState<Head[]>(() => (initial ? parseHeads(initial.content) : []));
  const [view, setView] = useState<EditorView | null>(null);
  const [videoDialog, setVideoDialog] = useState(false);
  const [err, setErr] = useState("");
  const [docVersion, setDocVersion] = useState(0);
  const [linkQ, setLinkQ] = useState<LinkQuery | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [imageDialog, setImageDialog] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [rawMarkdown, setRawMarkdown] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);

  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef(initial?.content ?? "");
  const mtimeRef = useRef(initial?.mtimeMs ?? 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const tabs = useTabs();

  useEffect(() => {
    setShowNavigation(localStorage.getItem("wiki.articleNavigation") === "1");
    setShowFrontmatter(localStorage.getItem("wiki.frontmatter") === "1");
    setRawMarkdown(localStorage.getItem("wiki.rawMarkdown") === "1");
    setToolbarVisible(localStorage.getItem("wiki.editorToolbar") !== "0");
  }, []);

  const noteId = data?.id ?? id ?? "";

  /**
   * Siempre se relee al montar, incluso con `initial`. Ese payload es el
   * snapshot del render en servidor del momento en que se cargó la página: al
   * volver a una pestaña editada mostraba el contenido anterior. Sirve para
   * pintar de inmediato, no como fuente de verdad.
   */
  useEffect(() => {
    const nid = id ?? initial?.id;
    if (!nid) return;
    let dead = false;
    (async () => {
      await inFlight.get(nid)?.catch(() => {});
      const r = await fetch(`/api/note-full?id=${encodeURIComponent(nid)}`, { cache: "no-store" });
      if (!r.ok) { if (!initial) setErr(t("pane.openFailed")); return; }
      const d: Payload = await r.json();
      if (dead) return;
      const changed = d.content !== savedRef.current;
      setData(d); savedRef.current = d.content; mtimeRef.current = d.mtimeMs;
      setHeads(parseHeads(d.content));
      // CodeMirror construye su documento una sola vez, así que refrescar el
      // estado no basta: hay que remontar el editor cuando el texto cambió.
      if (changed) setDocVersion((v) => v + 1);
    })();
    return () => { dead = true; };
  }, [id, initial]);

  useEffect(() => { if (!secondary) document.body.classList.toggle("hide-prov", hideProv); }, [hideProv, secondary]);

  const save = useCallback(async (force = false) => {
    const body = viewRef.current?.state.doc.toString();
    if (body === undefined || (body === savedRef.current && !force)) return;
    setStatus(t("pane.saving"));
    const req = fetch("/api/note", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: noteId, content: body, mtimeMs: force ? undefined : mtimeRef.current }),
    });
    inFlight.set(noteId, req);
    const r = await req.finally(() => { if (inFlight.get(noteId) === req) inFlight.delete(noteId); });
    if (r.status === 409) { setConflict((await r.json()).currentContent); setStatus(""); return; }
    if (!r.ok) { setStatus(t("pane.saveFailed")); return; }
    const d = await r.json();
    mtimeRef.current = d.mtimeMs; savedRef.current = body; setStatus("guardado");
    setTimeout(() => setStatus((s) => (s === "guardado" ? "" : s)), 1400);
  }, [noteId]);

  const onChange = useCallback(() => {
    const doc = viewRef.current?.state.doc.toString();
    if (doc !== undefined) setHeads(parseHeads(doc));
    setStatus(t("pane.unsaved"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), AUTOSAVE_MS);
  }, [save]);

  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } save(); };
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      // Flush on unmount, do not just cancel. Switching tabs unmounts the pane,
      // and dropping the pending timer silently discarded the last edits.
      if (timer.current) { clearTimeout(timer.current); timer.current = null; save(); }
    };
  }, [save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  /**
   * Construye el enlace para una nota elegida en el buscador de `[[`.
   *
   * Dentro del mismo bundle va una ruta relativa; cruzando bundles va el
   * esquema `aios://`, que es lo que exige la spec §2 — una ruta relativa que
   * se escapa del bundle no resuelve.
   */
  const linkTo = useCallback((t: LinkTarget) => {
    const label = t.title.replace(/[[\]]/g, "");
    if (!data || t.bundle !== data.meta.bundle) {
      return `[${label}](aios://${t.bundle}/${encodeURI(t.path)})`;
    }
    const from = data.meta.pathRel.split("/").slice(0, -1);
    const to = t.path.split("/");
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    const rel = [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
    return `[${label}](${encodeURI(rel || to[to.length - 1])})`;
  }, [data]);

  const insertLink = useCallback((t: LinkTarget) => {
    const v = viewRef.current;
    if (!v || !linkQ) return;
    const text = linkTo(t);
    v.dispatch({
      changes: { from: linkQ.from, to: linkQ.to, insert: text },
      selection: { anchor: linkQ.from + text.length },
    });
    setLinkQ(null);
    v.focus();
    onChange();
  }, [linkQ, linkTo]);

  const resolveHref = useCallback((href: string) => {
    const hit = data?.resolve[href];
    if (hit) return hit;
    // External URLs must reach onNavigate, which sends them to Electron's
    // confirmation bridge. Returning null used to let them fall through the
    // editor and, in some paths, Next's router loaded them inside this pane.
    if (/^(https?:|mailto:)/i.test(href)) return href;
    if (!data || /^(aios:|#)/.test(href) || /\.md$/i.test(href)) return null;
    const dir = data.meta.vaultPath.split("/").slice(0, -1).join("/");
    const out: string[] = [];
    for (const sg of `${dir}/${href}`.split("/")) {
      if (!sg || sg === ".") continue;
      if (sg === "..") out.pop(); else out.push(sg);
    }
    return `/api/asset?p=${encodeURIComponent(out.join("/"))}`;
  }, [data]);

  if (err) return <section className="pane"><p className="warn">{err}</p></section>;
  if (!data) return <section className="pane"><p className="dim">{t("common.loading")}</p></section>;

  const m = data.meta;
  const total = m.humanWords + m.agentWords;
  const doMark = (kind: "human" | "ai") => {
    const v = viewRef.current;
    if (v && markSelection(v, kind)) { onChange(); setHasSel(false); }
  };

  return (
    <section className={secondary ? "pane" : undefined}>
      {secondary && (
        <header className="panehead">
          <span className="panetitle" title={m.vaultPath}>{m.title}</span>
          <span className="dim">{status}</span>
          <button onClick={onClose} title={t("pane.close")}>×</button>
        </header>
      )}

      {/* Chrome: never scrolls. Sticky positioning inside the scroller kept
          leaving this row stranded mid-article, so it now sits outside it. */}
      {showNavigation && <div className="tabs panechrome">
        <button className={tab === "article" ? "on" : ""} onClick={() => setTab("article")}>{t("pane.tabArticle")}</button>
        <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>{t("pane.tabData")}</button>
        <button className={tab === "links" ? "on" : ""} onClick={() => setTab("links")}>
          Enlaces ({data.backlinks.length + data.outbound.length})
        </button>
        <Crumb vaultPath={m.vaultPath} />
      </div>}

      <div className="panescroll">

        <div className="artrow">
          <article>
            <p className="infoline">
              {m.core && <span className="corebadge" style={{ marginLeft: 0, marginRight: 8 }} title={t("pane.coreArticle")}>{t("pane.core")}</span>}
              <span>{m.type}</span><span>{m.bundle}</span>
              {m.pillar && <span>{m.pillar}</span>}
              <span>creada {m.created || "—"}</span>
              <span>actualizada {m.updated}</span>
              <span>{m.words} palabras</span>
              {m.agentWords > 0 && total > 0 && <span>{Math.round((100 * m.agentWords) / total)}% agente</span>}
            </p>
            {(m.categories?.length ?? 0) > 0 && (
              <p className="catline">
                <span className="catlinelabel">{t("pane.categories")}</span>
                {m.categories!.map((c) => (
                  <Link key={c.id} href={`/#cat-${c.id}`}>{c.label}</Link>
                ))}
              </p>
            )}

            {/* El estado de la selección lo reporta el editor, no un onMouseUp:
                seleccionar con shift+flechas nunca disparaba ese evento y los
                botones de procedencia se quedaban apagados. */}
            <div style={{ display: tab === "article" ? "block" : "none" }} data-tour="editor-area">
              {toolbarVisible ? <EditorToolbar view={view} revision={selectionRevision} onImage={() => setImageDialog(true)} onVideo={() => setVideoDialog(true)}
                showNavigation={showNavigation} showFrontmatter={showFrontmatter}
                rawMarkdown={rawMarkdown} hasSelection={hasSel} hideAuthorship={hideProv}
                onMarkHuman={() => doMark("human")} onMarkAi={() => doMark("ai")}
                onUnmark={() => { const current = viewRef.current; if (current && unmarkSelection(current)) onChange(); }}
                onToggleAuthorship={() => setHideProv((current) => !current)}
                onToggleNavigation={() => setShowNavigation((current) => {
                  const next = !current;
                  if (!next) setTab("article");
                  localStorage.setItem("wiki.articleNavigation", next ? "1" : "0");
                  return next;
                })}
                onToggleFrontmatter={() => setShowFrontmatter((current) => {
                  const next = !current;
                  localStorage.setItem("wiki.frontmatter", next ? "1" : "0");
                  return next;
                })}
                onToggleMarkdown={() => setRawMarkdown((current) => {
                  const next = !current;
                  localStorage.setItem("wiki.rawMarkdown", next ? "1" : "0");
                  return next;
                })}
                onHide={() => {
                  setToolbarVisible(false);
                  localStorage.setItem("wiki.editorToolbar", "0");
                }} /> : (
                <button className="editor-toolbar-restore" type="button" title={t("editor.showToolbar")} onClick={() => {
                  setToolbarVisible(true);
                  localStorage.setItem("wiki.editorToolbar", "1");
                }}><span aria-hidden>⌄</span> {t("editor.showToolbar")}</button>
              )}
              <Editor
                key={docVersion}
                value={data.content}
                onChange={onChange}
                resolve={resolveHref}
                onLinkQuery={setLinkQ}
                onSelectionChange={(selected) => { setHasSel(selected); setSelectionRevision((n) => n + 1); }}
                showFrontmatter={showFrontmatter}
                rawMarkdown={rawMarkdown}
                onNavigate={(url, text) => {
                  if (/^(https?:|mailto:)/i.test(url)) {
                    if (window.summa?.openExternal) {
                      void window.summa.openExternal(url);
                    } else if (window.confirm(t("external.confirm"))) {
                      window.open(url, "_blank", "noopener,noreferrer");
                    }
                    return;
                  }
                  // ⌘clic abre en pestaña nueva. Antes hacía router.push, que
                  // remonta el workspace entero y cierra los paneles divididos.
                  if (url.startsWith("/note/")) {
                    tabs.open(decodeURIComponent(url.slice("/note/".length)), text, true);
                    return;
                  }
                  const m = url.match(/^\/pdf\?p=(.+)$/);
                  if (m) {
                    const p = decodeURIComponent(m[1]);
                    const kind = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p) ? "img:" : "pdf:";
                    tabs.open(kind + p, text || p.split("/").pop() || p, true);
                    return;
                  }
                  router.push(url);
                }}
                onReady={(v) => { viewRef.current = v; setView(v); onEditorReady?.(v); }}
                onPasteImage={async (file) => {
                  const fd = new FormData();
                  fd.append("id", noteId); fd.append("file", file);
                  const r = await fetch("/api/upload", { method: "POST", body: fd });
                  if (!r.ok) { setStatus(t("pane.uploadFailed")); return null; }
                  return (await r.json()).href as string;
                }}
              />
            </div>

            {tab === "data" && (
              <table>
                <tbody>
                  <tr><th>type</th><td>{m.type}</td></tr>
                  <tr><th>title</th><td>{m.title}</td></tr>
                  <tr><th>created</th><td>{m.created || <em className="dim">{t("pane.emptyNotDerivable")}</em>}</td></tr>
                  <tr><th>updated</th><td>{m.updated}</td></tr>
                  <tr><th>author</th><td>{m.author}</td></tr>
                  {m.pillar && <tr><th>pillar</th><td>{m.pillar}</td></tr>}
                  {m.status && <tr><th>status</th><td>{m.status}</td></tr>}
                  {m.resource && <tr><th>resource</th><td>{m.resource}</td></tr>}
                  <tr><th>tags</th><td>{m.tags.join(", ") || "—"}</td></tr>
                  <tr><th>{t("pane.fieldPath")}</th><td><code>{m.vaultPath}</code></td></tr>
                  <tr><th>{t("pane.fieldAuthorship")}</th><td>{t("pane.humanAgent", { human: m.humanWords, agent: m.agentWords })}</td></tr>
                </tbody>
              </table>
            )}

            {tab === "links" && (
              <>
                <h2>{t("pane.outbound", { n: data.outbound.length })}</h2>
                {data.outbound.length === 0 ? <p className="dim">{t("pane.none")}</p> : (
                  <ul>{data.outbound.map((r) => (
                    <li key={r.id}><Link href={`/note/${encodeURIComponent(r.id)}`}>{r.title}</Link></li>
                  ))}</ul>
                )}
                <h2>{t("pane.inbound", { n: data.backlinks.length })}</h2>
                {data.backlinks.length === 0 ? <p className="dim">{t("pane.noneOrphan")}</p> : (
                  <ul>{data.backlinks.map((r) => (
                    <li key={r.id}><Link href={`/note/${encodeURIComponent(r.id)}`}>{r.title}</Link></li>
                  ))}</ul>
                )}
              </>
            )}
          </article>
          {showToc && !secondary && tab === "article" && <Toc heads={heads} view={view} />}
        </div>

        {conflict !== null && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--link-red)" }}>
            <p className="warn" style={{ margin: "0 0 6px" }}>{t("pane.changedOnDisk")}</p>
            <button onClick={() => location.reload()}>{t("pane.reload")}</button>{" "}
            <button className="primary" onClick={() => { setConflict(null); save(true); }}>{t("pane.overwrite")}</button>
          </div>
        )}
      </div>

      {linkQ && <LinkPicker q={linkQ} onPick={insertLink} onClose={() => setLinkQ(null)} />}
      {imageDialog && <ImageDialog
        onClose={() => setImageDialog(false)}
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("id", noteId); fd.append("file", file);
          const r = await fetch("/api/upload", { method: "POST", body: fd });
          if (!r.ok) { setStatus(t("pane.uploadFailed")); return null; }
          return (await r.json()).href as string;
        }}
        onInsert={(markdown) => {
          const v = viewRef.current;
          if (v) { insertText(v, markdown); onChange(); }
          setImageDialog(false);
        }}
      />}
      {videoDialog && <VideoDialog
        onClose={() => setVideoDialog(false)}
        onUpload={async (file) => {
          const fd = new FormData();
          fd.append("id", noteId); fd.append("file", file);
          const r = await fetch("/api/upload", { method: "POST", body: fd });
          if (!r.ok) { setStatus(t("pane.videoUploadFailed")); return null; }
          return (await r.json()).href as string;
        }}
        onInsert={(html) => {
          const v = viewRef.current;
          if (v) { insertText(v, `\n${html}\n`); onChange(); }
          setVideoDialog(false);
        }}
      />}

    </section>
  );
}
