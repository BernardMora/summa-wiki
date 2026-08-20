import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, invalidate } from "@/lib/server.ts";
import { bundleOf } from "@/src/config.ts";

export const dynamic = "force-dynamic";

const TYPES = new Set(["knowledge", "project", "area", "moc", "journal", "source", "connection", "system"]);

function slugify(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export async function POST(req: Request) {
  const { folder = "", title = "", type = "knowledge", format = "note" } = await req.json();
  if (!title.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (format !== "note" && format !== "canvas") return NextResponse.json({ error: "invalid format" }, { status: 400 });
  if (!TYPES.has(type)) return NextResponse.json({ error: "invalid type" }, { status: 400 });

  const slug = slugify(title);
  if (!slug) return NextResponse.json({ error: "title has no usable characters" }, { status: 400 });

  // Containment: the target must resolve inside the vault.
  const dirAbs = path.resolve(VAULT, folder);
  const root = path.resolve(VAULT);
  if (dirAbs !== root && !dirAbs.startsWith(root + path.sep))
    return NextResponse.json({ error: "outside vault" }, { status: 400 });
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory())
    return NextResponse.json({ error: "folder not found" }, { status: 400 });

  const extension = format === "canvas" ? ".canvas" : ".md";
  const abs = path.join(dirAbs, `${slug}${extension}`);
  if (fs.existsSync(abs)) return NextResponse.json({ error: "ya existe un archivo con ese nombre" }, { status: 409 });

  if (format === "canvas") {
    fs.writeFileSync(abs, '{\n\t"nodes":[],\n\t"edges":[]\n}', "utf8");
    invalidate();
    const rel = path.relative(VAULT, abs).split(path.sep).join("/");
    return NextResponse.json({ ok: true, rel, id: `canvas:${rel}` });
  }

  // Local date, not toISOString(): UTC would stamp tomorrow after 5pm here.
  const d = new Date();
  const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");

  const fm = [
    "---",
    `type: ${type}`,
    `title: "${title.replace(/"/g, "'")}"`,
    `created: ${today}`,
    `updated: ${today}`,
    "author: human",
    "---",
    "",
    `# ${title}`,
    "",
    "",
  ].join("\n");

  fs.writeFileSync(abs, fm, "utf8");
  invalidate();

  const bundle = bundleOf(abs);
  const rel = path.relative(bundle.root, abs).split(path.sep).join("/");
  return NextResponse.json({ ok: true, id: `${bundle.id}:${rel}` });
}
