import CanvasEditor from "@/components/CanvasEditor.tsx";
import Crumb from "@/components/Crumb.tsx";

export const dynamic = "force-dynamic";

/** Ruta propia del canvas. Antes compartía /pdf y al recargar una pestaña de
 *  canvas se abría el visor de PDF sobre un archivo que no lo es. */
export default async function CanvasPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = (await searchParams).p ?? "";
  if (!p) return <article><h1>Canvas</h1><p className="dim">Falta el parámetro p.</p></article>;
  const name = p.split("/").pop() ?? p;
  return (
    <article>
      <h1 style={{ fontSize: 22 }}>{name}</h1>
      <div style={{ marginBottom: 10 }}><Crumb vaultPath={p} /></div>
      <CanvasEditor path={p} />
    </article>
  );
}
