import Ingest from "@/components/Ingest";
import { HAS_VAULT, vaultExists } from "@/src/config.ts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Traer carpetas del disco al vault. Sin vault no hay dónde meterlas. */
export default function IngestPage() {
  if (!HAS_VAULT || !vaultExists()) redirect("/setup");
  return <Ingest />;
}
