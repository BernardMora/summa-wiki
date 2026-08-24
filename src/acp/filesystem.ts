import fs from "node:fs";
import path from "node:path";
import { applyAgentProvenance, applyNewAgentProvenance } from "../../lib/provenance.ts";

export interface LiveBuffer {
  content: string;
  updatedAt: number;
}

export interface AcpFileSystemOptions {
  root: string;
  buffers: Map<string, LiveBuffer>;
  onWrite?: (absolutePath: string, content: string, mtimeMs: number) => void;
}

/** Resolve and constrain an ACP path to the session workspace. */
export function safeAcpPath(root: string, requested: string): string {
  const base = path.resolve(root);
  const absolute = path.resolve(requested);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) {
    throw new Error("ACP filesystem access is limited to the current vault");
  }
  return absolute;
}

export function readAcpTextFile(
  opts: AcpFileSystemOptions,
  requested: string,
  line?: number | null,
  limit?: number | null,
): string {
  const absolute = safeAcpPath(opts.root, requested);
  const content = opts.buffers.get(absolute)?.content ?? fs.readFileSync(absolute, "utf8");
  if (line == null && limit == null) return content;
  const lines = content.split(/(?<=\n)/);
  const start = Math.max(0, (line ?? 1) - 1);
  return lines.slice(start, limit == null ? undefined : start + Math.max(0, limit)).join("");
}

export function writeAcpTextFile(opts: AcpFileSystemOptions, requested: string, replacement: string): void {
  const absolute = safeAcpPath(opts.root, requested);
  const exists = fs.existsSync(absolute);
  if (exists && !fs.statSync(absolute).isFile()) throw new Error("ACP may only write regular files in the vault");
  if (!exists) fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const before = exists ? (opts.buffers.get(absolute)?.content ?? fs.readFileSync(absolute, "utf8")) : "";
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const attributed = /\.md$/i.test(absolute)
    ? (exists ? applyAgentProvenance(before, replacement) : applyNewAgentProvenance(replacement))
    : { content: replacement };
  // Stamp after diffing. If the date changes before attribution, the collapsed
  // diff stretches from frontmatter to the body and every safe paragraph edit
  // is forced into the file-level fallback.
  const result = {
    ...attributed,
    content: /\.md$/i.test(absolute)
      ? attributed.content.replace(/^(---\r?\n[\s\S]*?)^updated:.*$/m, (_match, head) => `${head}updated: ${today}`)
      : attributed.content,
  };
  fs.writeFileSync(absolute, result.content, "utf8");
  const mtimeMs = fs.statSync(absolute).mtimeMs;
  opts.buffers.set(absolute, { content: result.content, updatedAt: Date.now() });
  opts.onWrite?.(absolute, result.content, mtimeMs);
}
