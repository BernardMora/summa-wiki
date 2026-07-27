import path from "node:path";
import fs from "node:fs";
import type { BundleConfig } from "./types.ts";

/**
 * Vault location is configuration, never a constant — this is what lets the
 * whole system be pointed at someone else's vault (see spec section 8).
 * Override with WIKI_VAULT.
 */
export const VAULT = process.env.WIKI_VAULT
  ? path.resolve(process.env.WIKI_VAULT)
  : path.resolve(process.env.HOME ?? "", "Documents/aios");

export const bundles: BundleConfig[] = [
  { id: "personal", root: VAULT, shared: false },
  {
    id: "veridia",
    root: path.join(VAULT, "01-Hacer/01-veridia"),
    shared: true,
  },
];

/**
 * Directories never indexed.
 *
 * 05-Projects holds full codebases: 1,524 of its 1,526 markdown files are
 * node_modules READMEs. Only its _index.md belongs in the graph.
 *
 * Dot-directories are excluded explicitly — Obsidian ignores them by
 * convention, but this indexer inherits no such convention.
 */
export const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".next", ".open-next", ".hermes", ".obsidian",
  ".claude", ".agents", ".codex", ".vscode", "assets", "__pycache__", "venv",
]);

export const EXCLUDE_PATH_RE = [
  /^05-Projects\/.+\//,          // anything inside a project subfolder
  /(^|\/)\.[^/]+\//,             // any dot-directory segment
  // Repo and tooling docs are instructions, not knowledge. They carry no
  // frontmatter by design and would otherwise pollute health output.
  /^(CLAUDE|AGENTS|README|EXPANSIONS|Index)\.md$/,
  /^scripts\/README\.md$/,
  /\.excalidraw\.md$/,          // Excalidraw payloads are JSON, not notes
];

export function isExcluded(relPath: string): boolean {
  return EXCLUDE_PATH_RE.some((re) => re.test(relPath));
}

/** The veridia bundle lives inside the personal tree; classify by prefix. */
export function bundleOf(abs: string): BundleConfig {
  const veridia = bundles.find((b) => b.id === "veridia")!;
  if (abs.startsWith(veridia.root + path.sep) || abs === veridia.root) return veridia;
  return bundles.find((b) => b.id === "personal")!;
}

export const INDEX_PATH = process.env.WIKI_INDEX
  ? path.resolve(process.env.WIKI_INDEX)
  : path.join(path.dirname(new URL(import.meta.url).pathname), "..", "index.json");

export function vaultExists(): boolean {
  return fs.existsSync(VAULT);
}
