import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, getIndex } from "@/lib/server.ts";
import { EXCLUDE_DIRS, ARCH } from "@/src/config.ts";

export const dynamic = "force-dynamic";

interface Node {
  name: string;
  /** Path relative to the vault root, POSIX separators. */
  rel: string;
  dir: boolean;
  /** Note id when this file is an indexed note. */
  id?: string;
  /** Lowercase extension without the dot, for the type badge. */
  ext?: string;
  children?: Node[];
}

/** Files never worth showing: OS noise and lockfiles. */
const HIDE = /^(\.|Icon\r?$|Thumbs\.db$|desktop\.ini$)/i;

function walk(
  abs: string, rel: string, byPath: Map<string, string>, depth: number,
  /** Carpetas montadas por symlink -> su destino real, para el menú «copiar ruta». */
  links: Record<string, string>,
  showHidden: boolean
): Node[] {
  if (depth > 8) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }

  const out: Node[] = [];
  for (const e of entries) {
    if (!showHidden) {
      if (e.name.startsWith(".")) continue;
      if (EXCLUDE_DIRS.has(e.name) && e.name !== "assets") continue;
    } else {
      // Even if showHidden is true, we probably shouldn't descend into massive EXCLUDE_DIRS like node_modules or .git
      if (EXCLUDE_DIRS.has(e.name) && e.name !== "assets" && e.name !== ".obsidian" && e.name !== ".claude" && e.name !== ".vscode" && e.name !== ".cursor") {
          continue;
      }
    }
    const childAbs = path.join(abs, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;

    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = fs.statSync(childAbs).isDirectory(); } catch { continue; }
      // El bundle de Veridia vive en Drive: su ruta real no se puede deducir
      // desde el cliente concatenando la del vault.
      if (isDir) { try { links[childRel] = fs.realpathSync(childAbs); } catch { /* enlace roto */ } }
    }

    if (isDir) {
      // 05-Projects holds codebases; show the folder but never descend.
      const children = childRel.startsWith("05-Projects") && rel !== ""
        ? []
        : walk(childAbs, childRel, byPath, depth + 1, links, showHidden);
      out.push({ name: e.name, rel: childRel, dir: true, children });
    } else if (showHidden || !HIDE.test(e.name)) {
      // Everything shows, like Obsidian; the badge tells you what it is.
      const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : "";
      out.push({ name: e.name, rel: childRel, dir: false, id: byPath.get(childRel), ext });
    }
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "es") : a.dir ? -1 : 1));
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("hidden") === "1";
  const idx = getIndex();
  const byPath = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );
  const links: Record<string, string> = {};
  const root = walk(VAULT, "", byPath, 0, links, showHidden);
  // `defaultOpen` viaja con el árbol porque el componente es de cliente y la
  // arquitectura solo se puede leer en el servidor. Es lo que el árbol abre la
  // PRIMERA vez; después manda lo que el usuario dejó abierto en localStorage.
  return NextResponse.json({ root, vault: VAULT, links, defaultOpen: ARCH.defaultOpen });
}
