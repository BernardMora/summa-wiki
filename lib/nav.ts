import { getIndex } from "./server.ts";
import { readCategories } from "./categories.ts";

export interface NavItem { id: string; title: string; pinned?: boolean; rank?: number; }
export interface NavGroup { id: string; label: string; items: NavItem[]; total: number; hidden?: boolean; }

/**
 * Sidebar categories. Each is a user-owned group that may auto-include a
 * pillar and always includes whatever has been pinned to it. Anything not
 * captured by a category falls into "Sin categoría" so nothing disappears.
 */
export function navGroups(limit = 10): NavGroup[] {
  const idx = getIndex();
  const cats = readCategories();
  const notes = idx.notes.filter((n) => n.slug !== "_index" && !n.path.includes("/Templates/"));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const claimed = new Set<string>();

  const groups: NavGroup[] = cats.map((c) => {
    const items: NavItem[] = [];
    for (const nid of c.notes) {
      const n = byId.get(nid);
      if (n && !items.some((i) => i.id === nid)) { items.push({ id: n.id, title: n.title, pinned: true, rank: n.backlinks.length }); claimed.add(nid); }
    }
    if (c.pillar) {
      for (const n of notes) {
        if (n.pillar === c.pillar && !items.some((i) => i.id === n.id)) {
          items.push({ id: n.id, title: n.title, rank: n.backlinks.length });
          claimed.add(n.id);
        }
      }
    }
    items.sort((a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      (b.rank ?? 0) - (a.rank ?? 0) ||
      a.title.localeCompare(b.title, "es"));
    return { id: c.id, label: c.label, total: items.length, items: items.slice(0, limit), hidden: c.hidden };
  });

  const rest = notes.filter((n) => !claimed.has(n.id));
  if (rest.length) {
    groups.push({
      id: "__uncategorised",
      label: "Sin categoría",
      total: rest.length,
      items: rest.sort((a, b) => b.backlinks.length - a.backlinks.length || a.title.localeCompare(b.title, "es"))
        .slice(0, limit).map((n) => ({ id: n.id, title: n.title })),
    });
  }
  return groups.filter((g) => g.total > 0 || g.id !== "__uncategorised");
}
