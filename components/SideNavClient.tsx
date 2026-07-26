"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import FileTree from "./FileTree.tsx";

interface NavItem { id: string; title: string; }
interface NavGroup { label: string; items: NavItem[]; total: number; }

export default function SideNavClient({ groups }: { groups: NavGroup[] }) {
  const [view, setView] = useState<"cat" | "files">("cat");

  // Remember the choice across navigations.
  useEffect(() => {
    const v = localStorage.getItem("wiki.sideview");
    if (v === "files" || v === "cat") setView(v);
  }, []);
  useEffect(() => { localStorage.setItem("wiki.sideview", view); }, [view]);

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
        groups.map((g) => (
          <div key={g.label}>
            <h4>{g.label}</h4>
            <ul>
              {g.items.map((i) => (
                <li key={i.id}><Link href={`/note/${encodeURIComponent(i.id)}`}>{i.title}</Link></li>
              ))}
              {g.total > g.items.length && (
                <li className="dim">
                  <Link href={`/categories#${encodeURIComponent(g.label)}`}>+{g.total - g.items.length} más</Link>
                </li>
              )}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}
