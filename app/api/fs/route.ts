import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, getIndex, invalidate } from "@/lib/server.ts";
import { bundleOf } from "@/src/config.ts";
import { relink } from "@/lib/relink.ts";
import { getT } from "@/lib/i18n.server.ts";
import { EXCLUDE_DIRS } from "@/src/config.ts";

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

/** Lista compacta para el selector de destino de la barra lateral. */
export async function GET() {
  const folders = [""];
  const inventory: Array<{ name: string; path: string; dir: boolean; ext: string; id?: string; title?: string }> = [];
  const byPath = new Map(getIndex().notes.map((note) => [
    path.relative(VAULT, note.abs).split(path.sep).join("/"),
    { id: note.id, title: note.title },
  ]));
  const stack: Array<{ abs: string; rel: string }> = [{ abs: path.resolve(VAULT), rel: "" }];
  const visited = new Set<string>();
  while (stack.length && folders.length < 5000) {
    const current = stack.pop()!;
    let real: string;
    try { real = fs.realpathSync(current.abs); } catch { continue; }
    if (visited.has(real)) continue;
    visited.add(real);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current.abs, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || (EXCLUDE_DIRS.has(entry.name) && entry.name !== "assets")) continue;
      const abs = path.join(current.abs, entry.name);
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) { try { isDir = fs.statSync(abs).isDirectory(); } catch { continue; } }
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      if (isDir) {
        folders.push(rel);
        if (inventory.length < 10000) inventory.push({ name: entry.name, path: rel, dir: true, ext: "" });
        stack.push({ abs, rel });
      } else {
        const indexed = byPath.get(rel);
        const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
        if (inventory.length < 10000) inventory.push({ name: entry.name, path: rel, dir: false, ext, ...indexed });
      }
      if (folders.length >= 5000) break;
    }
  }
  folders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  inventory.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return NextResponse.json({ folders, entries: inventory });
}

export async function POST(req: Request) {
  const { action, rel, name, confirm } = await req.json();
  // Crear dentro de la raíz es válido; modificar o borrar la raíz nunca lo es.
  const abs = action === "mkdir" && (rel ?? "") === "" ? path.resolve(VAULT) : safe(rel ?? "");
  if (!abs) return NextResponse.json({ error: getT()("err.invalidPath") }, { status: 400 });
  if (!fs.existsSync(abs)) return NextResponse.json({ error: getT()("err.doesNotExist") }, { status: 404 });

  const isDir = fs.statSync(abs).isDirectory();

  if (action === "mkdir") {
    if (!isDir) return NextResponse.json({ error: getT()("err.onlyInsideFolder") }, { status: 400 });
    // Las carpetas conservan la forma del nombre, igual que en rename, pero se
    // rechaza lo que rompería rutas: separadores, `..` y caracteres hostiles
    // para URLs. Es la misma clase de problema que causó el bug NFD.
    const base = (name ?? "").trim().replace(/[\/\\:*?"<>|]/g, "").replace(/^\.+/, "").trim();
    if (!base) return NextResponse.json({ error: getT()("err.nameRequired") }, { status: 400 });
    const dst = path.join(abs, base);
    if (!safe(path.relative(VAULT, dst))) return NextResponse.json({ error: getT()("err.invalidPath") }, { status: 400 });
    if (fs.existsSync(dst)) return NextResponse.json({ error: getT()("err.alreadyExists") }, { status: 409 });
    fs.mkdirSync(dst);
    return NextResponse.json({ ok: true, rel: path.relative(VAULT, dst).split(path.sep).join("/") });
  }

  if (action === "move") {
    const destAbs = safe(name ?? "");                    // `name` lleva la carpeta destino
    if (!destAbs || !fs.existsSync(destAbs) || !fs.statSync(destAbs).isDirectory())
      return NextResponse.json({ error: getT()("err.invalidTarget") }, { status: 400 });
    const dst = path.join(destAbs, path.basename(abs));
    if (dst === abs) return NextResponse.json({ ok: true, unchanged: true });
    // Mover una carpeta dentro de sí misma la borraría del árbol.
    if (isDir && (destAbs === abs || destAbs.startsWith(abs + path.sep)))
      return NextResponse.json({ error: getT()("err.folderIntoItself") }, { status: 400 });
    if (fs.existsSync(dst)) return NextResponse.json({ error: getT()("err.alreadyExistsThere") }, { status: 409 });

    // El mapa de movimientos se arma ANTES de mover: hay que saber a qué
    // apuntaba cada ruta vieja para poder recalcular las relativas.
    const relOf = (p: string) => path.relative(VAULT, p).split(path.sep).join("/");
    const moves = new Map<string, string>();
    if (isDir) {
      const stack = [abs];
      while (stack.length) {
        const d = stack.pop()!;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const child = path.join(d, e.name);
          if (e.isDirectory()) stack.push(child);
          else moves.set(relOf(child), relOf(path.join(dst, path.relative(abs, child))));
        }
      }
    } else {
      moves.set(relOf(abs), relOf(dst));
    }

    fs.renameSync(abs, dst);
    // Sin esto el vault queda con enlaces rotos en silencio, que es justo lo
    // que más caro ha costado arreglar a mano.
    const r = relink(moves);
    invalidate();
    return NextResponse.json({
      ok: true, rel: relOf(dst), id: idOf(dst),
      relinked: r,
    });
  }

  if (action === "rename") {
    if (!name?.trim()) return NextResponse.json({ error: getT()("err.nameRequired") }, { status: 400 });

    /*
     * La regla de slug de la spec (sección 3) es para NOTAS. Aplicarla a todo
     * archivo convertía cualquier otra cosa en markdown: renombrar
     * `indexer.ts` producía `indexer-ts.md` — un archivo de código destruido
     * en silencio, sin manera de deshacerlo. Antes casi no se notaba porque no
     * se podía abrir nada que no fuera nota; con el editor de cualquier
     * archivo, el clic derecho de renombrar quedó a un paso de ahí.
     *
     * Ahora solo los `.md` pasan por el slug. El resto conserva la forma de su
     * nombre, como las carpetas, y recupera su extensión si el usuario escribe
     * el nombre sin ella.
     */
    const orig = path.basename(abs);
    const isNote = /\.md$/i.test(orig);
    let base: string;

    if (isDir) {
      base = name.trim();
    } else if (isNote) {
      base = `${slugify(name.replace(/\.md$/i, ""))}.md`;
      if (base === ".md") return NextResponse.json({ error: "nombre sin caracteres usables" }, { status: 400 });
    } else {
      // Se quitan separadores y caracteres hostiles para rutas, pero NO el
      // punto inicial: `.DS_Store` y `.gitignore` son nombres legítimos.
      const clean = name.trim().replace(/[\/\\:*?"<>|]/g, "").trim();
      if (!clean || clean === "." || clean === "..") {
        return NextResponse.json({ error: getT()("err.invalidName") }, { status: 400 });
      }
      // extname(".DS_Store") es "" — Node no trata el punto inicial como
      // extensión, que es justo lo que hace falta aquí.
      base = path.extname(clean) ? clean : clean + path.extname(orig);
    }
    const dst = path.join(path.dirname(abs), base);
    if (dst === abs) return NextResponse.json({ ok: true, rel, id: isDir ? undefined : idOf(abs) });
    if (fs.existsSync(dst)) return NextResponse.json({ error: getT()("err.alreadyExists") }, { status: 409 });
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

  return NextResponse.json({ error: getT()("err.unknownAction") }, { status: 400 });
}
