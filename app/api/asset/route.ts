import { resolveAsset } from "@/lib/server.ts";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".ogg": "video/ogg", ".ogv": "video/ogg", ".mov": "video/quicktime",
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return new Response("p required", { status: 400 });
  const abs = resolveAsset(decodeURIComponent(p));
  if (!abs) return new Response("not found", { status: 404 });
  const size = fs.statSync(abs).size;
  const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const requestedStart = range[1] ? Number(range[1]) : 0;
    const requestedEnd = range[2] ? Number(range[2]) : size - 1;
    const start = Math.max(0, Math.min(requestedStart, size - 1));
    const end = Math.max(start, Math.min(requestedEnd, size - 1));
    const buf = Buffer.alloc(end - start + 1);
    const file = fs.openSync(abs, "r");
    try { fs.readSync(file, buf, 0, buf.length, start); } finally { fs.closeSync(file); }
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(buf.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
