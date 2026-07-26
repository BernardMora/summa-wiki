import { getIndex } from "./server.ts";

export interface NavItem { id: string; title: string; }
export interface NavGroup { label: string; items: NavItem[]; total: number; }

const PILLAR_LABEL: Record<string, string> = {
  consulting: "Veridia", content: "Contenido", study: "Estudio",
  finance: "Finanzas", health: "Salud", other: "Otros",
};

/** Sidebar categories. Pillar is the primary axis; everything else lands in Sistema/Journal. */
export function navGroups(limit = 10): NavGroup[] {
  const idx = getIndex();
  const buckets = new Map<string, NavItem[]>();

  for (const n of idx.notes) {
    if (n.slug === "_index") continue;
    if (n.path.includes("/Templates/")) continue;  // scaffolding, not articles
    let key: string;
    if (n.pillar && PILLAR_LABEL[n.pillar]) key = PILLAR_LABEL[n.pillar];
    else if (n.path.startsWith("02-Journal")) key = "Journal";
    else if (n.bundle === "veridia") key = "Veridia";
    else key = "Sistema";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ id: n.id, title: n.title });
  }

  const order = ["Veridia", "Contenido", "Estudio", "Journal", "Finanzas", "Salud", "Otros", "Sistema"];
  return [...buckets.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([label, items]) => ({
      label,
      total: items.length,
      items: items.sort((a, b) => a.title.localeCompare(b.title, "es")).slice(0, limit),
    }));
}
