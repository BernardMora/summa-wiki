/**
 * Coincidencia por subsecuencia, como la del quick-switcher de Obsidian:
 * "prehis" encuentra "notas-los-origenes…prehistoria".
 *
 * Vive aquí porque lo usan el buscador rápido (⌘O) y el selector de enlaces
 * de la escritura; tenerlo duplicado garantizaba que se separaran.
 */
export const normalize = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface FuzzyHit { score: number; hits: number[] }

export function fuzzy(hay: string, needle: string): FuzzyHit | null {
  if (!needle) return { score: 0, hits: [] };
  const h = normalize(hay), n = normalize(needle);
  const hits: number[] = [];
  let hi = 0, score = 0, streak = 0;

  for (const ch of n) {
    let found = -1;
    for (let i = hi; i < h.length; i++) if (h[i] === ch) { found = i; break; }
    if (found < 0) return null;
    // Caracteres consecutivos e inicios de palabra son lo que la gente busca.
    if (found === hi && hits.length) { streak++; score += 8 + streak * 2; }
    else { streak = 0; score += 1; }
    if (found === 0 || /[\s\-_/.]/.test(h[found - 1] ?? "")) score += 10;
    hits.push(found);
    hi = found + 1;
  }
  return { score: score - (h.length - n.length) * 0.05, hits };
}

/** Resalta en negritas los caracteres que hicieron match. */
export function markHits(text: string, hits: number[]) {
  if (!hits.length) return [{ t: text, on: false }];
  const set = new Set(hits);
  const out: { t: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const on = set.has(i);
    if (out.length && out[out.length - 1].on === on) out[out.length - 1].t += text[i];
    else out.push({ t: text[i], on });
  }
  return out;
}
