import { getIndex } from "./server.ts";
import type { Note } from "@/src/types.ts";

/**
 * The identity map: the vault is organised by questions about Bernardo, not by
 * topic folders. This module is the single definition of that map so the
 * homepage and the sidebar cannot drift apart.
 *
 * `where` is a predicate over the vault-relative path rather than a folder
 * string, because three of the questions are interpretive — their content is
 * scattered by design and does not live under one directory.
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

const P = "personal:00-Bernardo";

export const CENTRE = `${P}/quien-es-bernardo.md`;

export const QUESTIONS: Question[] = [
  {
    id: "vivido",
    label: "¿Qué ha vivido?",
    hub: `${P}/que-ha-vivido.md`,
    blurb: "Infancia, formación, trabajo, y las personas que lo acompañaron.",
    lives: "00-Bernardo/biografia/",
    where: (p) => p.startsWith("00-Bernardo/biografia/"),
  },
  {
    id: "sabe",
    label: "¿Qué sabe?",
    hub: `${P}/que-sabe.md`,
    blurb: "El árbol de conocimiento: lo estudiado, lo leído, lo que quedó.",
    lives: "02-Saber/",
    where: (p) => p.startsWith("02-Saber/"),
  },
  {
    id: "hace",
    label: "¿Qué hace?",
    hub: `${P}/que-hace.md`,
    blurb: "En qué se le va el día y qué hábitos lo sostienen.",
    lives: "01-Hacer/",
    where: (p) => p.startsWith("01-Hacer/"),
  },
  {
    id: "piensa",
    label: "¿Cómo piensa?",
    hub: `${P}/marco-de-pensamiento.md`,
    blurb: "Filosofía dominante, fundamentos éticos, contexto e ideas clave.",
    lives: "artículos de posición, repartidos",
    where: (p) =>
      p === "00-Bernardo/marco-de-pensamiento.md" ||
      p === "00-Bernardo/metodo-de-reflexion-y-limpieza-mental.md" ||
      p === "00-Bernardo/articulos-de-sintesis.md" ||
      p.startsWith("02-Saber/filosofia/") ||
      p.startsWith("02-Saber/tecnologia/"),
  },
  {
    id: "porque",
    label: "¿Por qué hace lo que hace?",
    hub: `${P}/por-que-hace-lo-que-hace.md`,
    blurb: "Motivaciones declaradas y gustos revelados — y la distancia entre unas y otros.",
    lives: "00-Bernardo/ + el log de decisiones",
    where: (p) =>
      p === "00-Bernardo/obsesion.md" ||
      p === "00-Bernardo/por-que-hace-lo-que-hace.md" ||
      p === "03-Journal/decisions.md",
  },
];

export const PEOPLE = {
  label: "Personas",
  hub: `${P}/personas/personas.md`,
  blurb: "Atraviesan todas las preguntas, así que son entidades y no una rama.",
  where: (p: string) => p.startsWith("00-Bernardo/personas/"),
};

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
  const root = idx.bundles.find((b) => b.id === "personal")?.root ?? "";
  // `_index` notes are counted here on purpose: some branches — biografía is
  // the clearest case — legitimately hold their content in one.
  const notes = idx.notes.filter(
    (n) => !n.path.includes("/Templates/") && !n.path.startsWith("05-Projects/"),
  );

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

  return [...QUESTIONS.map(build), build({ ...PEOPLE, lives: "00-Bernardo/personas/" })];
}
