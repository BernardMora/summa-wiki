import { resolveAsset } from "@/lib/server.ts";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".mp4": "video/mp4",
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return new Response("p required", { status: 400 });
  const abs = resolveAsset(decodeURIComponent(p));
  if (!abs) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
