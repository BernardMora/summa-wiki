import fs from "node:fs";
import path from "node:path";
import { buildIndex } from "../src/indexer.ts";
import { VAULT, bundles } from "../src/config.ts";
import type { WikiIndex, Note } from "../src/types.ts";
import { applyHumanProvenance } from "./provenance.ts";

/**
 * Server-side vault access. Everything here touches the real filesystem, so
 * every path is validated against the bundle roots before use — a request must
 * never be able to read or write outside the vault.
 */

let cache: { index: WikiIndex; builtAt: number } | null = null;
/*
 * Reconstruir el índice implica recorrer y parsear todo el vault. Cinco
 * segundos convertían cualquier clic después de leer un rato en un rebuild
 * síncrono antes de poder mostrar la nota. Las mutaciones propias ya llaman a
 * `invalidate()` y el watcher invalida cambios externos, así que el TTL queda
 * como red de seguridad, no como mecanismo normal de frescura.
 */
const TTL_MS = 5 * 60_000;

export function getIndex(force = false): WikiIndex {
  if (!force && cache && Date.now() - cache.builtAt < TTL_MS) return cache.index;
  cache = { index: buildIndex(), builtAt: Date.now() };
  return cache.index;
}

export function invalidate() {
  cache = null;
}

/** Resolve a note id ("bundle:relative/path.md") to an absolute path inside a bundle. */
export function resolveId(id: string): string | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const bundle = bundles.find((b) => b.id === id.slice(0, i));
  if (!bundle) return null;
  const abs = path.resolve(bundle.root, id.slice(i + 1));
  // Containment check: refuse anything that escapes the bundle root.
  const root = path.resolve(bundle.root);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!abs.endsWith(".md")) return null;
  return abs;
}

export function findNote(index: WikiIndex, idOrSlug: string): Note | undefined {
  return (
    index.notes.find((n) => n.id === idOrSlug) ??
    index.notes.find((n) => n.slug === idOrSlug) ??
    index.notes.find((n) => n.path === idOrSlug)
  );
}

export interface ReadResult {
  id: string;
  content: string;
  /** Filesystem mtime, used as the concurrency token on save. */
  mtimeMs: number;
}

export function readNote(id: string): ReadResult | null {
  const abs = resolveId(id);
  if (!abs || !fs.existsSync(abs)) return null;
  return {
    id,
    content: fs.readFileSync(abs, "utf8"),
    mtimeMs: fs.statSync(abs).mtimeMs,
  };
}

export type WriteResult =
  | { ok: true; mtimeMs: number; wrapped: boolean; authorChanged: string | null }
  | { ok: false; reason: "not-found" | "stale"; currentMtimeMs?: number; currentContent?: string };

/**
 * Write a note, guarding against the stale-buffer case.
 *
 * The failure this prevents: the app has a note open, the agent edits the file
 * on disk, then the app saves and silently discards the agent's work. That is
 * sequential, not concurrent, so "I never edit in two places at once" does not
 * protect against it. There is no snapshot layer by design, so this check is
 * the only net between commits.
 */
export function writeNote(id: string, content: string, expectedMtimeMs?: number): WriteResult {
  const abs = resolveId(id);
  if (!abs || !fs.existsSync(abs)) return { ok: false, reason: "not-found" };

  const current = fs.statSync(abs).mtimeMs;
  if (expectedMtimeMs !== undefined && Math.abs(current - expectedMtimeMs) > 1) {
    return {
      ok: false,
      reason: "stale",
      currentMtimeMs: current,
      currentContent: fs.readFileSync(abs, "utf8"),
    };
  }

  // Stamp updated: on save, per spec section 5.
  // LOCAL date, not toISOString() — that returns UTC, so an evening save in
  // Tijuana (UTC-7) would stamp tomorrow and quietly corrupt journal dates.
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const stamped = content.replace(
    /^(---\r?\n[\s\S]*?)^updated:.*$/m,
    (_m, head) => `${head}updated: ${today}`,
  );

  // Attribute the edit before writing: a human insertion inside an agent
  // block gets wrapped, and author: is moved to mixed when warranted.
  const before = fs.readFileSync(abs, "utf8");
  const prov = applyHumanProvenance(before, stamped);

  fs.writeFileSync(abs, prov.content, "utf8");
  invalidate();
  return {
    ok: true,
    mtimeMs: fs.statSync(abs).mtimeMs,
    wrapped: prov.wrapped,
    authorChanged: prov.authorChanged,
  };
}

/** Serve an asset (image/pdf) referenced by a note, still constrained to the vault. */
export function resolveAsset(relFromVault: string): string | null {
  const abs = path.resolve(VAULT, relFromVault);
  const root = path.resolve(VAULT);
  if (!abs.startsWith(root + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

export { VAULT };
