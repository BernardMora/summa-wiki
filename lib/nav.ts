import { getIndex } from "./server.ts";
import { readCategories, norm, type Category } from "./categories.ts";
import { isCore, isArticle, vaultPath } from "./identity.ts";
import { ARCH, PRIMARY_BUNDLE } from "@/src/config.ts";
import { underAny } from "@/src/architecture.ts";
import type { Note } from "@/src/types.ts";

export interface NavItem { id: string; title: string; pinned?: boolean; rank?: number; }
export interface NavGroup {
  id: string; label: string; blurb?: string;
  items: NavItem[]; total: number; hidden?: boolean;
}

/**
 * What can carry a category at all. Dailies are excluded on purpose: they are
 * a chronological log, one file per day, and shelving them by topic would bury
 * every real article under a wall of dates. They stay reachable through the
 * journal and the file tree.
 */
function isCatalogable(n: Note, root: string): boolean {
  const p = vaultPath(n, root);
  return (
    n.slug !== "_index" &&
    isArticle(p) &&
    !underAny(p, ARCH.articles.neverCategorised) &&
    // El nombre ISO es la convención de nota diaria de la spec §3, no una
    // decisión de arquitectura: vale para cualquier vault.
    !/^\d{4}-\d{2}-\d{2}$/.test(n.slug) &&
    !isCore(n.id)
  );
}

/** Does a note satisfy any of a category's rules? Pins are handled separately. */
function matches(c: Category, n: Note, p: string): boolean {
  if (c.pillar && n.pillar === c.pillar) return true;
  if (c.bundle && n.bundle === c.bundle) return true;
  if (c.types?.includes(n.type)) return true;
  if (c.paths?.some((prefix) => p === prefix || p.startsWith(prefix))) return true;
  if (c.tags?.length) {
    const want = new Set(c.tags.map(norm));
    // `pillar/content` and similar are namespaced tags; match on the leaf too.
    if (n.tags.some((t) => want.has(norm(t)) || want.has(norm(t.split(/[\\/]/).pop() ?? "")))) return true;
  }
  return false;
}

/**
 * The categories one note belongs to, for the article header. Recomputing the
 * rules for a single note is cheaper than building every group and searching
 * them, and it keeps the article page independent of the sidebar's limits.
 */
export function categoriesOf(id: string): { id: string; label: string }[] {
  const idx = getIndex();
  const root = idx.bundles.find((b) => b.id === PRIMARY_BUNDLE)?.root ?? "";
  const n = idx.notes.find((x) => x.id === id);
  if (!n || !isCatalogable(n, root)) return [];
  const p = vaultPath(n, root);
  return readCategories()
    .filter((c) => !c.exclude?.includes(id) && (c.notes.includes(id) || matches(c, n, p)))
    .map((c) => ({ id: c.id, label: c.label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/**
 * Every category with the notes it holds. A note may land in several — that is
 * the point, and why nothing here "claims" a note away from the next category.
 * `limit` caps the items returned per group; `total` always reports the truth.
 */
export function navGroups(limit = 10): NavGroup[] {
  const idx = getIndex();
  const root = idx.bundles.find((b) => b.id === PRIMARY_BUNDLE)?.root ?? "";
  const cats = readCategories();
  const notes = idx.notes.filter((n) => isCatalogable(n, root));
  const matched = new Set<string>();

  const groups: NavGroup[] = cats.map((c) => {
    const pins = new Set(c.notes);
    const skip = new Set(c.exclude ?? []);
    const items: NavItem[] = [];

    for (const n of notes) {
      if (skip.has(n.id)) continue;
      const pinned = pins.has(n.id);
      if (!pinned && !matches(c, n, vaultPath(n, root))) continue;
      items.push({ id: n.id, title: n.title, pinned: pinned || undefined, rank: n.backlinks.length });
      matched.add(n.id);
    }
    items.sort((a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      (b.rank ?? 0) - (a.rank ?? 0) ||
      a.title.localeCompare(b.title, "es"));

    return {
      id: c.id, label: c.label, blurb: c.blurb,
      total: items.length, items: items.slice(0, limit), hidden: c.hidden,
    };
  });

  const rest = notes.filter((n) => !matched.has(n.id));
  if (rest.length) {
    groups.push({
      id: "__uncategorised",
      label: "Sin categoría",
      blurb: "Todavía sin regla que las recoja — candidatas a categoría nueva.",
      total: rest.length,
      items: rest
        .sort((a, b) => b.backlinks.length - a.backlinks.length || a.title.localeCompare(b.title, "es"))
        .slice(0, limit)
        .map((n) => ({ id: n.id, title: n.title })),
    });
  }

  // Alphabetical everywhere, with the catch-all last: it is a to-do list, not
  // a category, and sorting it under S would hide that.
  return groups.sort((a, b) =>
    Number(a.id === "__uncategorised") - Number(b.id === "__uncategorised") ||
    a.label.localeCompare(b.label, "es"));
}
