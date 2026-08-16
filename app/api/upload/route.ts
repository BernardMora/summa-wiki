import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveId, invalidate } from "@/lib/server.ts";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg",
};

function slug(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

/**
 * Paste an image into a note. Mirrors the vault convention from spec section 7:
 * assets live in a sibling assets/ folder, named <note-slug>-<n>.webp.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const id = form.get("id");
  const file = form.get("file");
  if (typeof id !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "id y file requeridos" }, { status: 400 });
  }

  const noteAbs = resolveId(id);
  if (!noteAbs || !fs.existsSync(noteAbs)) {
    return NextResponse.json({ error: getT()("err.noteNotFound") }, { status: 404 });
  }

  const srcExt = EXT[file.type];
  if (!srcExt) return NextResponse.json({ error: `tipo no soportado: ${file.type}` }, { status: 400 });

  const dir = path.dirname(noteAbs);
  const assets = path.join(dir, "assets");
  fs.mkdirSync(assets, { recursive: true });

  const base = slug(path.basename(noteAbs, ".md")) || "asset";
  // SVG is already vector; converting it would be lossy nonsense.
  const wantWebp = srcExt !== "svg" && srcExt !== "webp";
  let n = 1;
  const nameFor = (i: number, ext: string) => `${base}-${i}.${ext}`;
  while (
    fs.existsSync(path.join(assets, nameFor(n, "webp"))) ||
    fs.existsSync(path.join(assets, nameFor(n, srcExt)))
  ) n++;

  const buf = Buffer.from(await file.arrayBuffer());
  let finalName = nameFor(n, srcExt);
  let finalPath = path.join(assets, finalName);
  fs.writeFileSync(finalPath, buf);

  if (wantWebp) {
    const webpName = nameFor(n, "webp");
    const webpPath = path.join(assets, webpName);
    try {
      execFileSync("cwebp", ["-quiet", "-q", "88", finalPath, "-o", webpPath], { timeout: 20000 });
      fs.unlinkSync(finalPath);           // drop the original once converted
      finalName = webpName;
      finalPath = webpPath;
    } catch {
      // cwebp missing or failed: keep the original rather than losing the paste.
    }
  }

  invalidate();
  return NextResponse.json({
    ok: true,
    name: finalName,
    // Relative to the note, which is exactly what the markdown link needs.
    href: `assets/${finalName}`,
    bytes: fs.statSync(finalPath).size,
  });
}
