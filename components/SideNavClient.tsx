"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FileTree from "./FileTree.tsx";
import { useTabs } from "./Tabs.tsx";
import { REVEAL_EVENT } from "./Crumb.tsx";

interface NavItem { id: string; title: string; pinned?: boolean; }
interface NavGroup { id: string; label: string; items: NavItem[]; total: number; hidden?: boolean; }
interface Menu { x: number; y: number; group: NavGroup; }

export default function SideNavClient({ groups }: { groups: NavGroup[] }) {
  const [view, setView] = useState<"cat" | "files">("cat");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [confirming, setConfirming] = useState<NavGroup | null>(null);
  const router = useRouter();
  const tabs = useTabs();

  useEffect(() => {
    const v = localStorage.getItem("wiki.sideview");
    if (v === "files" || v === "cat") setView(v);
  }, []);
  useEffect(() => { localStorage.setItem("wiki.sideview", view); }, [view]);

  // A breadcrumb click must flip to the filesystem view, or the reveal lands
  // on a panel that is not showing.
  useEffect(() => {
    const onReveal = () => setView("files");
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

  const visible = groups.filter((g) => !g.hidden);
  const hidden = groups.filter((g) => g.hidden);

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
          title={g.id === "__uncategorised" ? "" : "Clic derecho para acciones"}
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
              {i.pinned && <span className="pinmark" title="Fijada">▪</span>}{i.title}
            </a>
          </li>
        ))}
        {g.total > g.items.length && (
          <li className="dim">
            <Link href={`/categories#${encodeURIComponent(g.label)}`}>+{g.total - g.items.length} más</Link>
          </li>
        )}
      </ul>
    </div>
  );

  return (
    <nav className="side">
      <div className="logo">B</div>
      <div className="sidename">Berni&apos;s Wiki</div>
      <div className="sidetag">La enciclopedia personal</div>

      <div className="viewtoggle">
        <button className={view === "cat" ? "on" : ""} onClick={() => setView("cat")}>Categorías</button>
        <button className={view === "files" ? "on" : ""} onClick={() => setView("files")}>Archivos</button>
      </div>

      <h4>Navegación</h4>
      <ul>
        <li><Link href="/">Portada</Link></li>
        <li><Link href="/random">Artículo aleatorio</Link></li>
        <li><Link href="/graph">Grafo</Link></li>
        <li><Link href="/categories">Todas las categorías</Link></li>
        <li><Link href="/health">Salud del wiki</Link></li>
      </ul>

      {view === "files" ? (
        <FileTree />
      ) : (
        <>
          {visible.map(renderGroup)}

          {adding ? (
            <input
              autoFocus className="inlineedit" placeholder="Nombre de la categoría" value={draft}
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
                {showHidden ? "▾" : "▸"} Ocultas ({hidden.length})
              </button>
              {showHidden && hidden.map(renderGroup)}
            </div>
          )}
        </>
      )}

      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{menu.group.label}</div>
          <button onClick={() => { setEditing(menu.group.id); setDraft(menu.group.label); setMenu(null); }}>
            Renombrar
          </button>
          <button onClick={() => cat(menu.group.hidden ? "show" : "hide", { id: menu.group.id })}>
            {menu.group.hidden ? "Mostrar" : "Ocultar"}
          </button>
          <button className="danger" onClick={() => { setConfirming(menu.group); setMenu(null); }}>
            Borrar
          </button>
        </div>
      )}

      {confirming && (
        <div className="confirmbox">
          <p style={{ margin: "0 0 4px" }}>
            Borrar «<strong>{confirming.label}</strong>»
          </p>
          <p className="dim" style={{ margin: "0 0 8px", fontSize: 11.5 }}>
            Las notas no se tocan, solo se pierde la agrupación. Si solo quieres
            quitarla de en medio, usa <em>Ocultar</em>.
          </p>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => cat("hide", { id: confirming.id })}>
              Ocultar
            </button>
            <button className="newbtn danger" style={{ margin: 0 }} onClick={() => cat("delete", { id: confirming.id })}>
              Borrar
            </button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
