import PdfClient from "@/components/PdfClient.tsx";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

export default async function PdfPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = sp.p ?? "";
  if (!p) return <article><h1>PDF</h1><p className="dim">{getT()("page.missingParam", { param: "p" })}</p></article>;
  return <PdfClient path={p} />;
}
