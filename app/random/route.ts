import { redirect } from "next/navigation";
import { getIndex } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const notes = getIndex().notes.filter((n) => n.slug !== "_index" && n.words > 80);
  const pick = notes[Math.floor(Math.random() * notes.length)];
  redirect(`/note/${encodeURIComponent(pick.id)}`);
}
