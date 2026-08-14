import { getIndex } from "./server.ts";
import { ARCH, PRIMARY_BUNDLE } from "@/src/config.ts";
import { underAny, containsAny } from "@/src/architecture.ts";
import type { Note } from "@/src/types.ts";

/**
 * ¿Esta ruta es un artículo? Plantillas y codebases no lo son.
 *
 * Vive aquí y no en `nav.ts` porque lo usan los dos: los conteos por pregunta
 * y el archivado por categoría parten del mismo universo, y solo después
 * `nav.ts` le quita además lo cronológico.
 */
export const isArticle = (p: string) =>
  !containsAny(p, ARCH.articles.notArticles.contains) &&
  !underAny(p, ARCH.articles.notArticles.paths);

/**
 * The identity map: the vault is organised by questions, not by topic folders.
 * This module is the single definition of that map so the homepage and the
 * sidebar cannot drift apart.
 *
 * Desde la Fase 12 el mapa no se declara aquí: se lee de la arquitectura
 * (`src/architecture.ts`). Lo que antes era un predicado JS por pregunta ahora
 * es una lista de rutas, porque los cinco predicados resultaron ser todos
 * disyunciones de "ruta exacta" y "empieza con" — exactamente la regla que ya
 * usaban las categorías.
 */
export interface Question {
  id: string;
  label: string;
  /** Note id of the hub article. */
  hub: string;
  blurb: string;
  /** Where its supporting content lives, in prose, for the reader. */
  lives: string;
  where: (p: string) => boolean;
}

/**
 * Ruta del vault a id de nota. Los hubs viven en el bundle primario, cuya raíz
 * ES el vault, así que su ruta relativa al bundle y al vault coinciden.
 */
const idOf = (p: string) => `${PRIMARY_BUNDLE}:${p}`;

export const CENTRE = idOf(ARCH.centre);

export const QUESTIONS: Question[] = ARCH.hubs.map((h) => ({
  id: h.id,
  label: h.label,
  hub: idOf(h.hub),
  blurb: h.blurb,
  lives: h.lives,
  where: (p: string) => underAny(p, h.paths),
}));

/**
 * The núcleo: the centre plus the five questions. Six articles that are not
 * subject matter but the frame the subject matter hangs on, so they are shown
 * apart — above the categories, in their own colour — and never filed into an
 * ordinary category, where they would read as one shelf among twenty.
 */
export const CORE: string[] = [CENTRE, ...QUESTIONS.map((q) => q.hub)];
const CORE_SET = new Set(CORE);
export const isCore = (id: string) => CORE_SET.has(id);

/** Vault-relative path, derived from the bundle roots rather than hardcoded. */
export function vaultPath(n: Note, root: string): string {
  return (n.abs && root && n.abs.startsWith(root + "/") ? n.abs.slice(root.length + 1) : n.path)
    .normalize("NFC");
}

export interface Branch {
  label: string; hub: string; blurb: string; lives: string;
  count: number; words: number; sample: { id: string; title: string }[];
}

/** Counts and a few real articles per question, computed from the index. */
export function identityBranches(sample = 4): Branch[] {
  const idx = getIndex();
  const root = idx.bundles.find((b) => b.id === PRIMARY_BUNDLE)?.root ?? "";
  // `_index` notes are counted here on purpose: some branches — biografía is
  // the clearest case — legitimately hold their content in one.
  // Solo `notArticles`: las notas diarias SÍ cuentan para su pregunta. Son
  // contenido real; lo que no hacen es archivarse por tema (ver `lib/nav.ts`).
  const notes = idx.notes.filter((n) => isArticle(n.path));

  const build = (q: { label: string; hub: string; blurb: string; lives?: string; where: (p: string) => boolean }): Branch => {
    const hit = notes.filter((n) => q.where(vaultPath(n, root)) && n.id !== q.hub);
    return {
      label: q.label, hub: q.hub, blurb: q.blurb, lives: q.lives ?? "",
      count: hit.length,
      words: hit.reduce((a, b) => a + b.words, 0),
      // Best-connected first: the sample should be worth clicking.
      sample: [...hit]
        .sort((a, b) => b.backlinks.length - a.backlinks.length || b.words - a.words)
        .slice(0, sample)
        .map((n) => ({ id: n.id, title: n.title })),
    };
  };

  return QUESTIONS.map(build);
}
