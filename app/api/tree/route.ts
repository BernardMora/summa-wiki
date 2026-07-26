import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VAULT, getIndex } from "@/lib/server.ts";
import { EXCLUDE_DIRS } from "@/src/config.ts";

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

function walk(abs: string, rel: string, byPath: Map<string, string>, depth: number): Node[] {
  if (depth > 8) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }

  const out: Node[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (EXCLUDE_DIRS.has(e.name) && e.name !== "assets") continue;
    const childAbs = path.join(abs, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;

    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(childAbs).isDirectory(); } catch { continue; } }

    if (isDir) {
      // 05-Projects holds codebases; show the folder but never descend.
      const children = childRel.startsWith("05-Projects") && rel !== ""
        ? []
        : walk(childAbs, childRel, byPath, depth + 1);
      out.push({ name: e.name, rel: childRel, dir: true, children });
    } else if (!HIDE.test(e.name)) {
      // Everything shows, like Obsidian; the badge tells you what it is.
      const ext = e.name.includes(".") ? e.name.split(".").pop()!.toLowerCase() : "";
      out.push({ name: e.name, rel: childRel, dir: false, id: byPath.get(childRel), ext });
    }
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "es") : a.dir ? -1 : 1));
  return out;
}

export async function GET() {
  const idx = getIndex();
  const byPath = new Map(
    idx.notes.map((n) => [path.relative(VAULT, n.abs).split(path.sep).join("/"), n.id]),
  );
  return NextResponse.json({ root: walk(VAULT, "", byPath, 0) });
}
