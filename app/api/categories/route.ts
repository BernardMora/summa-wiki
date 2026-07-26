import { NextResponse } from "next/server";
import { readCategories, writeCategories, type Category } from "@/lib/categories.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ categories: readCategories() });
}

const slug = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "").toLowerCase();

export async function POST(req: Request) {
  const { action, id, label, noteId } = await req.json();
  const cats = readCategories();

  switch (action) {
    case "create": {
      if (!label?.trim()) return NextResponse.json({ error: "nombre requerido" }, { status: 400 });
      const newId = slug(label) || `cat-${Date.now()}`;
      if (cats.some((c) => c.id === newId)) return NextResponse.json({ error: "ya existe" }, { status: 409 });
      cats.push({ id: newId, label: label.trim(), notes: [] });
      break;
    }
    case "rename": {
      const c = cats.find((x) => x.id === id);
      if (!c) return NextResponse.json({ error: "no existe" }, { status: 404 });
      if (!label?.trim()) return NextResponse.json({ error: "nombre requerido" }, { status: 400 });
      c.label = label.trim();
      break;
    }
    case "delete": {
      const i = cats.findIndex((x) => x.id === id);
      if (i < 0) return NextResponse.json({ error: "no existe" }, { status: 404 });
      // Deleting a category never touches notes; it only drops the grouping.
      cats.splice(i, 1);
      break;
    }
    case "hide":
    case "show": {
      const c = cats.find((x) => x.id === id);
      if (!c) return NextResponse.json({ error: "no existe" }, { status: 404 });
      // Hiding keeps the category and its pins; it only collapses the group.
      if (action === "hide") c.hidden = true; else delete c.hidden;
      break;
    }
    case "pin":
    case "unpin": {
      const c = cats.find((x) => x.id === id);
      if (!c || !noteId) return NextResponse.json({ error: "categoría o nota inválida" }, { status: 400 });
      c.notes = action === "pin"
        ? [...new Set([...c.notes, noteId])]
        : c.notes.filter((n) => n !== noteId);
      break;
    }
    case "reorder": {
      const order: string[] = (await Promise.resolve(id)) as unknown as string[];
      if (!Array.isArray(order)) return NextResponse.json({ error: "orden inválido" }, { status: 400 });
      cats.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      break;
    }
    default:
      return NextResponse.json({ error: "acción desconocida" }, { status: 400 });
  }

  writeCategories(cats as Category[]);
  return NextResponse.json({ ok: true, categories: cats });
}
