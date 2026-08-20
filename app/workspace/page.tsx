import ArticleClient from "@/components/ArticleClient.tsx";
import { VAULT } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * El workspace sin nota: adonde va lo que no es una nota (terminal, grafo,
 * PDF, imagen, archivo suelto) cuando se abre desde una página que no tiene
 * panes montados — la portada, /search, /categories.
 *
 * Antes esos clics iban a la ruta suelta del contenido, `/terminal?id=…` entre
 * ellas: la terminal ocupaba la página entera, sin barra de pestañas y sin lo
 * demás que estuviera abierto. Aquí se restaura el layout guardado y la
 * pestaña pedida se añade como una más.
 *
 * Las rutas sueltas siguen existiendo como enlaces profundos; lo que cambia es
 * que la app ya no manda a nadie ahí.
 */
export default async function WorkspacePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const id = q.open?.trim();
  const seed = id ? { id, title: q.title?.trim() || id } : null;
  return <ArticleClient initial={null} seed={seed} vaultKey={VAULT} />;
}
