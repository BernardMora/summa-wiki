import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, invalidate } from "@/lib/server.ts";
import { bundleOf } from "@/src/config.ts";

export const dynamic = "force-dynamic";

/** Every path from the client is untrusted; resolve and prove containment. */
function safe(rel: string): string | null {
  const abs = path.resolve(VAULT, rel);
  const root = path.resolve(VAULT);
  if (abs === root) return null;                       // never touch the vault root
  if (!abs.startsWith(root + path.sep)) return null;   // no escaping
  return abs;
}

function slugify(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function idOf(abs: string) {
  const b = bundleOf(abs);
  return `${b.id}:${path.relative(b.root, abs).split(path.sep).join("/")}`;
}

function countInside(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    n += e.isDirectory() ? countInside(path.join(dir, e.name)) + 1 : 1;
  }
  return n;
}

export async function POST(req: Request) {
  const { action, rel, name, confirm } = await req.json();
  const abs = safe(rel ?? "");
  if (!abs) return NextResponse.json({ error: "ruta inválida" }, { status: 400 });
  if (!fs.existsSync(abs)) return NextResponse.json({ error: "no existe" }, { status: 404 });

  const isDir = fs.statSync(abs).isDirectory();

  if (action === "mkdir") {
    if (!isDir) return NextResponse.json({ error: "solo dentro de una carpeta" }, { status: 400 });
    // Las carpetas conservan la forma del nombre, igual que en rename, pero se
    // rechaza lo que rompería rutas: separadores, `..` y caracteres hostiles
    // para URLs. Es la misma clase de problema que causó el bug NFD.
    const base = (name ?? "").trim().replace(/[\/\\:*?"<>|]/g, "").replace(/^\.+/, "").trim();
    if (!base) return NextResponse.json({ error: "nombre requerido" }, { status: 400 });
    const dst = path.join(abs, base);
    if (!safe(path.relative(VAULT, dst))) return NextResponse.json({ error: "ruta inválida" }, { status: 400 });
    if (fs.existsSync(dst)) return NextResponse.json({ error: "ya existe" }, { status: 409 });
    fs.mkdirSync(dst);
    return NextResponse.json({ ok: true, rel: path.relative(VAULT, dst).split(path.sep).join("/") });
  }

  if (action === "rename") {
    if (!name?.trim()) return NextResponse.json({ error: "nombre requerido" }, { status: 400 });
    // Files follow the slug rule from spec section 3; folders keep their name shape.
    const base = isDir ? name.trim() : `${slugify(name.replace(/\.md$/i, ""))}.md`;
    if (!isDir && base === ".md") return NextResponse.json({ error: "nombre sin caracteres usables" }, { status: 400 });
    const dst = path.join(path.dirname(abs), base);
    if (dst === abs) return NextResponse.json({ ok: true, rel, id: isDir ? undefined : idOf(abs) });
    if (fs.existsSync(dst)) return NextResponse.json({ error: "ya existe" }, { status: 409 });
    // Two-step: a case-only rename is a no-op on this filesystem otherwise.
    const tmp = `${abs}.__rename__`;
    fs.renameSync(abs, tmp);
    fs.renameSync(tmp, dst);
    invalidate();
    return NextResponse.json({
      ok: true,
      rel: path.relative(VAULT, dst).split(path.sep).join("/"),
      id: isDir ? undefined : idOf(dst),
    });
  }

  if (action === "delete") {
    if (isDir) {
      const n = countInside(abs);
      // Never silently delete a populated folder.
      if (n > 0 && !confirm) return NextResponse.json({ error: "not-empty", count: n }, { status: 409 });
      fs.rmSync(abs, { recursive: true, force: true });
    } else {
      fs.unlinkSync(abs);
    }
    invalidate();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "acción desconocida" }, { status: 400 });
}
