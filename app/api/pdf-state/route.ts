import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * Last page read, per PDF.
 *
 * Kept in the vault rather than localStorage so it survives a different
 * browser or machine and travels with the notes, the same reasoning as
 * wiki-categories.json. A .json extension keeps it out of the note index.
 */
const STATE = path.join(VAULT, "04-Sistema/wiki-pdf-state.json");

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE, "utf8"));
    return raw?.pages ?? {};
  } catch { return {}; }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  const pages = read();
  if (p) return NextResponse.json({ page: pages[p] ?? 1 });
  return NextResponse.json({ pages });
}

export async function PUT(req: Request) {
  const { p, page } = await req.json();
  if (typeof p !== "string" || typeof page !== "number") {
    return NextResponse.json({ error: "p y page requeridos" }, { status: 400 });
  }
  const pages = read();
  if (page <= 1) delete pages[p]; else pages[p] = page;
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ version: 1, pages }, null, 2), "utf8");
  return NextResponse.json({ ok: true });
}
