"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FileTree, { type FileTreeCreateKind, type FileTreeCreateRequest } from "./FileTree.tsx";
import { FileIcon, FolderIcon } from "./FileIcon.tsx";
import { useTabs } from "./Tabs.tsx";
import { REVEAL_EVENT } from "./Crumb.tsx";
import { GRAPH_ID } from "./Tabs.tsx";
import { useT } from "./I18n";
import Help from "./Help.tsx";
import Settings from "./Settings.tsx";

interface NavItem { id: string; title: string; pinned?: boolean; }
interface NavGroup { id: string; label: string; blurb?: string; items: NavItem[]; total: number; hidden?: boolean; }
interface Menu { x: number; y: number; group: NavGroup; }

interface QLink { id: string; title: string; count: number; }

export default function SideNavClient({ groups, name, tagline, hasIcon }: {
  groups: NavGroup[];
  centre: { id: string; title: string } | null;
  questions: QLink[];
  name: string;
  tagline: string;
  /** Hay imagen configurada en el vault; si no, se cae a la inicial. */
  hasIcon: boolean;
}) {
  const t = useT();
  const [view, setView] = useState<"cat" | "files">("cat");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [confirming, setConfirming] = useState<NavGroup | null>(null);
  const [selectedDir, setSelectedDir] = useState("");
  const [createRequest, setCreateRequest] = useState<FileTreeCreateRequest | null>(null);
  const [locationPrompt, setLocationPrompt] = useState<{ kind: FileTreeCreateKind; folder: string } | null>(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [folderOptions, setFolderOptions] = useState<string[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const viewRef = useRef<"cat" | "files">("cat");
  const viewScroll = useRef({ cat: 0, files: 0 });
  const router = useRouter();
  const tabs = useTabs();

  useEffect(() => {
    const v = localStorage.getItem("wiki.sideview");
    if (v === "files" || v === "cat") { viewRef.current = v; setView(v); }
  }, []);

  useEffect(() => {
    if (!locationPrompt) return;
    setFolderSearch(""); setFolderLoading(true);
    fetch("/api/fs", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => setFolderOptions(Array.isArray(data.folders) ? data.folders : [""]))
      .catch(() => setFolderOptions([""]))
      .finally(() => setFolderLoading(false));
  }, [locationPrompt?.kind]);
  useEffect(() => { localStorage.setItem("wiki.sideview", view); }, [view]);

  /** Cambiar de vista no desmonta el árbol ni pierde la posición del usuario. */
  function changeView(next: "cat" | "files") {
    const current = viewRef.current;
    if (next === current) return;
    if (sideRef.current) viewScroll.current[current] = sideRef.current.scrollTop;
    viewRef.current = next;
    setView(next);
    requestAnimationFrame(() => {
      if (sideRef.current) sideRef.current.scrollTop = viewScroll.current[next];
    });
  }

  // A breadcrumb click must flip to the filesystem view, or the reveal lands
  // on a panel that is not showing.
  useEffect(() => {
    const onReveal = () => changeView("files");
    window.addEventListener(REVEAL_EVENT, onReveal as EventListener);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal as EventListener);
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, []);

  async function cat(action: string, body: Record<string, unknown> = {}) {
    await fetch("/api/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    setEditing(null); setAdding(false); setDraft(""); setMenu(null); setConfirming(null);
    router.refresh();
  }

  /** Single click reuses the current tab; Cmd/Ctrl or middle click opens a new one. */
  function openNote(e: React.MouseEvent, item: NavItem) {
    e.preventDefault();
    tabs?.open(item.id, item.title, e.metaKey || e.ctrlKey);
  }

  function requestCreate(kind: FileTreeCreateKind) {
    if (view === "files") {
      setCreateRequest({ seq: Date.now(), kind, folder: selectedDir });
      return;
    }
    setLocationPrompt({ kind, folder: "" });
  }

  function confirmCreateLocation() {
    if (!locationPrompt) return;
    const folder = locationPrompt.folder.trim().replace(/^\/+|\/+$/g, "");
    changeView("files");
    setCreateRequest({ seq: Date.now(), kind: locationPrompt.kind, folder });
    setLocationPrompt(null);
  }

  // Categories arrive already sorted alphabetically. Empty ones are dropped
  // here and only here: the portada shows them so an unfilled shelf reads as an
  // invitation, but in a 20-item rail they are dead weight.
  const visible = groups.filter((g) => !g.hidden && g.total > 0);
  const hidden = groups.filter((g) => g.hidden);
  const visibleFolders = folderOptions.filter((folder) => !folderSearch.trim() || folder.toLocaleLowerCase().includes(folderSearch.trim().toLocaleLowerCase())).slice(0, 100);

  const renderGroup = (g: NavGroup) => (
    <div key={g.id}>
      {editing === g.id ? (
        <input
          autoFocus className="inlineedit" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") cat("rename", { id: g.id, label: draft });
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <h4
          className="cathead"
          onContextMenu={(e) => {
            if (g.id === "__uncategorised") return;
            e.preventDefault(); e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY, group: g });
          }}
          title={g.id === "__uncategorised" ? "" : t("nav.rightClickActions")}
        >
          {g.label} <span className="catcount">{g.total}</span>
        </h4>
      )}
      <ul>
        {g.items.map((i) => (
          <li key={i.id}>
            <a
              href={`/note/${encodeURIComponent(i.id)}`}
              onClick={(e) => openNote(e, i)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); tabs?.open(i.id, i.title, true); } }}
            >
              {i.pinned && <span className="pinmark" title={t("nav.pinned")}>▪</span>}{i.title}
            </a>
          </li>
        ))}
        {g.total > g.items.length && (
          <li className="dim">
            <Link href={`/#cat-${g.id}`}>+{g.total - g.items.length} más</Link>
          </li>
        )}
      </ul>
    </div>
  );

  return (
    <nav className="side" ref={sideRef}>
      {/* Con foto se muestra la foto; sin ella, la inicial del nombre — que es
          lo que hacía la "B" fija, solo que ahora sigue a quien configure la
          wiki. `[...name][0]` y no `name[0]`: con un emoji o un carácter fuera
          del plano básico, indexar por unidad UTF-16 parte el carácter en dos
          y pinta un rombo. */}
      <div className={`logo${hasIcon ? " haspic" : ""}`}>
        {hasIcon
          ? <img src="/api/icon" alt="" />
          : ([...name][0] ?? "W").toUpperCase()}
      </div>
      <div className="sidename">{name}</div>
      {tagline && <div className="sidetag">{tagline}</div>}

      <div className="side-sticky-tools">
        <div className="viewtoggle">
          <button className={view === "cat" ? "on" : ""} onClick={() => changeView("cat")}>{t("nav.categories")}</button>
          <button className={view === "files" ? "on" : ""} onClick={() => changeView("files")}>{t("nav.files")}</button>
        </div>

        <div className="tree-createbar" data-tour="tree-create-actions">
          <button onClick={() => requestCreate("folder")} data-tooltip={t("tree.newFolder")} aria-label={t("tree.newFolder")}><FolderIcon open={false} /><span aria-hidden="true">+</span></button>
          <button onClick={() => requestCreate("note")} data-tooltip={t("tree.newNote")} aria-label={t("tree.newNote")}><FileIcon name="note.md" /><span aria-hidden="true">+</span></button>
          <button onClick={() => requestCreate("canvas")} data-tooltip={t("tree.newCanvas")} aria-label={t("tree.newCanvas")}><FileIcon name="board.canvas" /><span aria-hidden="true">+</span></button>
          <button onClick={() => tabs?.open(GRAPH_ID, t("nav.graph"), true)} data-tooltip={t("tree.openGraph")} aria-label={t("tree.openGraph")}>
            <svg className="ficon graph-action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><path d="M8 3.2 4.1 5.5v4.8L8 12.7l3.9-2.4V5.5zM8 3.2v4.7m-3.9-2.4L8 7.9l3.9-2.4M8 7.9v4.8"/><circle cx="8" cy="2.3" r="1.1" fill="currentColor" stroke="none"/><circle cx="3.3" cy="5.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.7" cy="5.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="3.3" cy="10.7" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.7" cy="10.7" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="13.6" r="1.1" fill="currentColor" stroke="none"/></svg>
          </button>
        </div>
      </div>

      <h4>{t("nav.navigation")}</h4>
      <ul>
        <li><Link href="/">{t("nav.home")}</Link></li>
        <li><Link href="/#categorias">{t("nav.allCategories")}</Link></li>
        <li><Link href="/health">{t("nav.health")}</Link></li>
      </ul>

      <div hidden={view !== "files"}>
        <FileTree createRequest={createRequest} onSelectedDirChange={setSelectedDir} />
      </div>
      <div hidden={view !== "cat"}>
          {visible.map(renderGroup)}

          {adding ? (
            <input
              autoFocus className="inlineedit" placeholder={t("nav.categoryNamePlaceholder")} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setAdding(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") cat("create", { label: draft });
                if (e.key === "Escape") setAdding(false);
              }}
            />
          ) : (
            <button className="newbtn" onClick={() => { setAdding(true); setDraft(""); }}>
              + Nueva categoría
            </button>
          )}

          {hidden.length > 0 && (
            <div className="hiddenzone">
              <button className="hiddentoggle" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? "▾" : "▸"} {t("nav.hiddenGroups", { n: hidden.length })}
              </button>
              {showHidden && hidden.map(renderGroup)}
            </div>
          )}
      </div>

      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{menu.group.label}</div>
          <button onClick={() => { setEditing(menu.group.id); setDraft(menu.group.label); setMenu(null); }}>
            {t("common.rename")}
          </button>
          <button onClick={() => cat(menu.group.hidden ? "show" : "hide", { id: menu.group.id })}>
            {menu.group.hidden ? t("nav.show") : t("nav.hide")}
          </button>
          <button className="danger" onClick={() => { setConfirming(menu.group); setMenu(null); }}>
            {t("common.delete")}
          </button>
        </div>
      )}

      {confirming && (
        <div className="confirmbox">
          <p style={{ margin: "0 0 4px" }}>
            {t("nav.confirmDeleteGroup", { name: confirming.label })}
          </p>
          <p className="dim" style={{ margin: "0 0 8px", fontSize: 11.5 }}>
            {t("nav.confirmDeleteBody", { hide: t("nav.hide") })}
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => cat("hide", { id: confirming.id })}>
              {t("nav.hide")}
            </button>
            <button className="newbtn danger" style={{ margin: 0 }} onClick={() => cat("delete", { id: confirming.id })}>
              {t("common.delete")}
            </button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setConfirming(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {locationPrompt && (
        <div className="qsback create-location-backdrop" onMouseDown={() => setLocationPrompt(null)}>
          <div className="qsbox create-location" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{t("tree.chooseLocation")}</h2>
            <p>{t("tree.chooseLocationHint")}</p>
            <input className="folder-search" autoFocus value={folderSearch} placeholder={t("tree.searchFolders")} onChange={(e) => setFolderSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setLocationPrompt(null); }} />
            <div className="folder-picker-list">
              {folderLoading && <div className="folder-picker-empty">{t("common.loading")}</div>}
              {!folderLoading && visibleFolders.map((folder) => <button key={folder || "__root"} className={locationPrompt.folder === folder ? "selected" : ""} onClick={() => setLocationPrompt({ ...locationPrompt, folder })}><FolderIcon open={locationPrompt.folder === folder} /><span>{folder || t("tree.rootLocation")}</span></button>)}
              {!folderLoading && visibleFolders.length === 0 && <div className="folder-picker-empty">{t("tree.noFoldersFound")}</div>}
            </div>
            <div className="onboarding-actions"><button onClick={() => setLocationPrompt(null)}>{t("common.cancel")}</button><button className="newbtn primary" onClick={confirmCreateLocation}>{t("common.next")}</button></div>
          </div>
        </div>
      )}

      <div className="side-footer">
        <Help />
        <Settings name={name} tagline={tagline} />
      </div>
    </nav>
  );
}
