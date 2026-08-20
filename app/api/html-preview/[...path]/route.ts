import { resolveAsset } from "@/lib/server.ts";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

/**
 * Assets used by an HTML preview need a real path-shaped URL. A query-string
 * asset URL cannot be used as <base>: browsers resolve `./app.js` against the
 * endpoint path and discard its query, breaking every relative dependency.
 */
export async function GET(_req: Request, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path;
  // Next already decodes dynamic path segments. Decoding again would break a
  // perfectly valid filename containing a literal percent sign.
  const rel = segments.join("/");
  const abs = resolveAsset(rel);
  if (!abs) return new Response("not found", { status: 404 });
  const stat = fs.statSync(abs);
  if (!stat.isFile()) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(abs)), {
    headers: {
      "Content-Type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}
