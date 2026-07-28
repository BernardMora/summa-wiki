import TerminalPane from "@/components/TerminalPane.tsx";

export const dynamic = "force-dynamic";

/** Ruta propia, adonde recarga una pestaña de terminal — ver app/canvas/page.tsx,
 *  mismo motivo: al recargar, esa pestaña deja de estar dentro del workspace.
 *  El `id` en la URL es lo que permite reengancharse a la misma pty en vez de
 *  abrir una shell nueva — ver server.ts. */
export default async function TerminalPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const id = (await searchParams).id || crypto.randomUUID();
  return (
    <article className="termpage">
      <header className="termpage-head">
        <h1 style={{ fontSize: 22 }}>Terminal</h1>
      </header>
      <TerminalPane id={id} />
    </article>
  );
}
