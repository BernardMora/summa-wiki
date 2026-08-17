import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveId, invalidate } from "@/lib/server.ts";
import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg",
  "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
  "video/quicktime": "mov",
};

function safeFilename(input: string, fallbackExt: string) {
  const base = path.basename(input).normalize("NFC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/^\.+|\.+$/g, "").trim();
  return base || `asset.${fallbackExt}`;
}

/**
 * Upload visual media into a note. Mirrors the vault convention from spec section 7:
 * Assets live in a sibling assets/ folder and retain the uploaded filename.
 * A numeric suffix resolves collisions without ever overwriting an asset.
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

  const original = safeFilename(file.name, srcExt);
  const parsed = path.parse(original);
  let finalName = original;
  for (let n = 2; fs.existsSync(path.join(assets, finalName)); n++) {
    finalName = `${parsed.name}-${n}${parsed.ext || `.${srcExt}`}`;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const finalPath = path.join(assets, finalName);
  fs.writeFileSync(finalPath, buf);

  invalidate();
  return NextResponse.json({
    ok: true,
    name: finalName,
    // Relative to the note, which is exactly what the markdown link needs.
    href: `assets/${finalName}`,
    bytes: fs.statSync(finalPath).size,
  });
}
