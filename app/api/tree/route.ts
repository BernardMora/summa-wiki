import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, getIndex } from "@/lib/server.ts";
import { EXCLUDE_DIRS, ARCH } from "@/src/config.ts";
import { getT, getCollator } from "@/lib/i18n.server.ts";

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
  /**
   * `undefined` = not fetched yet (lazily fetchable); `[]` = fetched and
   * empty. Never populated recursively by this route — one level per
   * request.
   */
  children?: Node[];
}

/** Files never worth showing: OS noise and lockfiles. */
const HIDE = /^(\.|Icon\r?$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * Valida `dir` contra el vault. A diferencia de `safe()` en `api/fs`, la
 * raíz (`dir === ""`) es una petición legítima aquí — no se escribe nada.
 */
function safeDir(dir: string): string | null {
  const abs = path.resolve(VAULT, dir);
  const root = path.resolve(VAULT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(abs).isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

/**
 * Un solo nivel de `dir`, no todo el árbol. El árbol completo era un
 * `fs.readdirSync` recursivo hasta profundidad 8 en cada carga y en cada
 * evento del watcher — sobre un punto de montaje remoto eso es lento y a veces
 * incompleto. El cliente pide cada
 * carpeta cuando el usuario la abre, como Finder o VS Code.
 */
function listDir(
  abs: string, dir: string, byPath: Map<string, string>,
  /** Carpetas montadas por symlink -> su destino real, para el menú «copiar ruta». */
  links: Record<string, string>,
  showHidden: boolean
): Node[] {
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
    const childRel = dir ? `${dir}/${e.name}` : e.name;

    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = fs.statSync(childAbs).isDirectory(); } catch { continue; }
      // La ruta real de un bundle enlazado no se puede deducir desde el cliente
      // concatenando la del vault.
      if (isDir) { try { links[childRel] = fs.realpathSync(childAbs); } catch { /* enlace roto */ } }
    }

    if (isDir) {
      // 05-Projects holds real codebases, pero el árbol ya no las congela: se
      // navegan como cualquier otra carpeta, y `EXCLUDE_DIRS` (node_modules,
      // .git, .next…) sigue aplicando en cada nivel para no inundarlas de
      // dependencias.
      out.push({ name: e.name, rel: childRel, dir: true, children: undefined });
    } else if (showHidden || !HIDE.test(e.name)) {
      // Everything shows, like Obsidian; the badge tells you what it is.
      const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : "";
      out.push({ name: e.name, rel: childRel, dir: false, id: byPath.get(childRel), ext });
    }
  }
  const cmp = getCollator();
  out.sort((a, b) => (a.dir === b.dir ? cmp.compare(a.name, b.name) : a.dir ? -1 : 1));
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir") ?? "";
  const showHidden = url.searchParams.get("hidden") === "1";
  const abs = safeDir(dir);
  if (!abs) return NextResponse.json({ error: getT()("err.invalidPath") }, { status: 400 });

  const idx = getIndex();
  const byPath = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );
  const links: Record<string, string> = {};
  const children = listDir(abs, dir, byPath, links, showHidden);
  // `defaultOpen` viaja con cada respuesta porque el componente es de cliente y
  // la arquitectura solo se puede leer en el servidor; el cliente solo la usa
  // en la carga de la raíz. Es lo que el árbol abre la PRIMERA vez; después
  // manda lo que el usuario dejó abierto en localStorage.
  return NextResponse.json({ children, vault: VAULT, links, defaultOpen: ARCH.defaultOpen });
}
