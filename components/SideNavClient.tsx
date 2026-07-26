"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FileTree from "./FileTree.tsx";
import { useTabs } from "./Tabs.tsx";

interface NavItem { id: string; title: string; pinned?: boolean; }
interface NavGroup { id: string; label: string; items: NavItem[]; total: number; }

export default function SideNavClient({ groups }: { groups: NavGroup[] }) {
  const [view, setView] = useState<"cat" | "files">("cat");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const tabs = useTabs();

  useEffect(() => {
    const v = localStorage.getItem("wiki.sideview");
    if (v === "files" || v === "cat") setView(v);
  }, []);
  useEffect(() => { localStorage.setItem("wiki.sideview", view); }, [view]);

  async function cat(action: string, body: Record<string, unknown> = {}) {
    await fetch("/api/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    setEditing(null); setAdding(false); setDraft("");
    router.refresh();
  }

  /** Single click keeps the current tab; Cmd/Ctrl or middle click opens a new one. */
  function openNote(e: React.MouseEvent, item: NavItem) {
    e.preventDefault();
    tabs?.open(item.id, item.title, e.metaKey || e.ctrlKey);
  }

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
        <li><Link href="/search">Búsqueda avanzada</Link></li>
        <li><Link href="/categories">Todas las categorías</Link></li>
        <li><Link href="/health">Salud del wiki</Link></li>
      </ul>

      {view === "files" ? (
        <FileTree />
      ) : (
        <>
          {groups.map((g) => (
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
                    e.preventDefault();
                    if (confirm(`¿Borrar la categoría «${g.label}»? Las notas no se tocan.`)) {
                      cat("delete", { id: g.id });
                    }
                  }}
                  onDoubleClick={() => {
                    if (g.id === "__uncategorised") return;
                    setEditing(g.id); setDraft(g.label);
                  }}
                  title={g.id === "__uncategorised" ? "" : "Doble clic renombra · clic derecho borra"}
                >
                  {g.label}
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
          ))}

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
        </>
      )}
    </nav>
  );
}
