import PdfClient from "@/components/PdfClient.tsx";

export const dynamic = "force-dynamic";

export default async function PdfPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = sp.p ?? "";
  if (!p) return <article><h1>PDF</h1><p className="dim">Falta el parámetro p.</p></article>;
  return <PdfClient path={p} />;
}
