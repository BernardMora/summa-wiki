import fs from "node:fs";
import path from "node:path";
import { VAULT } from "../src/config.ts";

/**
 * Categories are user-owned, not derived. They live in the vault so they are
 * versioned and travel with it; JSON rather than markdown because they are
 * structured config, and the .json extension keeps them out of the note index.
 */
export const CATEGORIES_PATH = path.join(VAULT, "04-Sistema/wiki-categories.json");

export interface Category {
  id: string;
  label: string;
  /** Auto-include notes with this pillar, on top of any pinned ones. */
  pillar?: string;
  /** Explicitly pinned note ids. */
  notes: string[];
  /** Collapsed out of the way without losing the grouping. */
  hidden?: boolean;
}

const SEED: Category[] = [
  { id: "veridia", label: "Veridia", pillar: "consulting", notes: [] },
  { id: "contenido", label: "Contenido", pillar: "content", notes: [] },
  { id: "estudio", label: "Estudio", pillar: "study", notes: [] },
  { id: "finanzas", label: "Finanzas", pillar: "finance", notes: [] },
  { id: "salud", label: "Salud", pillar: "health", notes: [] },
  { id: "otros", label: "Otros", pillar: "other", notes: [] },
];

export function readCategories(): Category[] {
  try {
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_PATH, "utf8"));
    if (Array.isArray(raw?.categories)) return raw.categories;
  } catch { /* missing or corrupt: fall through to the seed */ }
  writeCategories(SEED);
  return SEED;
}

export function writeCategories(categories: Category[]) {
  fs.mkdirSync(path.dirname(CATEGORIES_PATH), { recursive: true });
  fs.writeFileSync(CATEGORIES_PATH, JSON.stringify({ version: 1, categories }, null, 2), "utf8");
}
