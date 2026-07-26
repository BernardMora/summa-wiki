import Link from "next/link";
import { navGroups } from "@/lib/nav.ts";

export default function SideNav() {
  const groups = navGroups(10);
  return (
    <nav className="side">
      <div className="logo">B</div>
      <div className="sidename">Berni&apos;s Wiki</div>
      <div className="sidetag">La enciclopedia personal</div>

      <h4>Navegación</h4>
      <ul>
        <li><Link href="/">Portada</Link></li>
        <li><Link href="/random">Artículo aleatorio</Link></li>
        <li><Link href="/search">Búsqueda avanzada</Link></li>
        <li><Link href="/categories">Todas las categorías</Link></li>
        <li><Link href="/health">Salud del wiki</Link></li>
      </ul>

      {groups.map((g) => (
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
      ))}
    </nav>
  );
}
