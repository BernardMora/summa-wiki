import fs from "node:fs";
import path from "node:path";
import { summaFile, vaultExists, ARCH } from "../src/config.ts";
import type { ArchCategory } from "../src/architecture.ts";

/**
 * Categories are user-owned, not derived. They live in the vault so they are
 * versioned and travel with it; JSON rather than markdown because they are
 * structured config, and the .json extension keeps them out of the note index.
 *
 * A category is a *rule* plus a pin list, not a folder. The rule is what makes
 * the shelf fill itself: writing a note under `02-Saber/fisica/` or tagging it
 * `libro` files it without anybody maintaining a list. Pins exist for the cases
 * a rule cannot express.
 *
 * Membership is deliberately non-exclusive. Sapiens is a book, it is history,
 * and it is one of the works that shaped the position articles — a taxonomy
 * that forces one answer would be lying about all three.
 */
export const CATEGORIES_PATH = summaFile("categories.json");

export const CATEGORIES_VERSION = 2;

/**
 * Una categoría es exactamente lo que declara la arquitectura. El alias se
 * conserva porque medio código importa `Category` de aquí, y renombrarlo en
 * 8 archivos no compra nada.
 */
export type Category = ArchCategory;


/**
 * La semilla ya no vive aquí: es `ARCH.categories`, parte de la arquitectura
 * de información (Fase 12). Un array de 23 categorías con rutas como
 * `02-Saber/fisica/` describe UN vault, y mientras estuviera en el código
 * elegir otra arquitectura no podía ser una función del programa.
 */
const SEED: Category[] = ARCH.categories;

/** Accent- and case-insensitive key, so `Física` and `fisica` are one tag. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Merge the architecture seed with stored categories without knowing any
 * vault-specific ids. Unknown groups are user data and always survive.
 */
function migrate(stored: Category[]): Category[] {
  const out = SEED.map((s) => ({ ...s, notes: [...s.notes] }));
  const byId = new Map(out.map((c) => [c.id, c]));
  for (const old of stored) {
    const hit = byId.get(old.id);
    if (hit) {
      hit.notes = [...new Set([...hit.notes, ...(old.notes ?? [])])];
      if (old.hidden) hit.hidden = true;
      continue;
    }
    out.push(old);
  }
  return out;
}

export function readCategories(): Category[] {
  try {
    const raw = JSON.parse(fs.readFileSync(CATEGORIES_PATH, "utf8"));
    if (Array.isArray(raw?.categories)) {
      if ((raw.version ?? 1) >= CATEGORIES_VERSION) return raw.categories;
      const upgraded = migrate(raw.categories);
      writeCategories(upgraded);
      return upgraded;
    }
  } catch { /* missing or corrupt: fall through to the seed */ }
  writeCategories(SEED);
  return SEED;
}

export function writeCategories(categories: Category[]) {
  // Un vault que no está en disco NO se materializa por leerlo.
  //
  // `readCategories()` siembra el archivo cuando falta, y esa siembra corre en
  // el render de la portada. Con un vault inexistente —el disco externo
  // desconectado, la carpeta que se movió— el `mkdirSync` recursivo creaba el
  // árbol entero: la app respondía "este vault está vacío" en vez de "no lo
  // encuentro", y dejaba una carpeta falsa donde antes no había nada. Peor si
  // la ruta era un punto de montaje: escribir ahí tapa el montaje.
  if (!vaultExists()) return;
  fs.mkdirSync(path.dirname(CATEGORIES_PATH), { recursive: true });
  fs.writeFileSync(
    CATEGORIES_PATH,
    JSON.stringify({ version: CATEGORIES_VERSION, categories }, null, 2),
    "utf8",
  );
}
