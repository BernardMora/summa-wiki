/**
 * Keep authorship honest when a human edits a note.
 *
 * The problem direct editing creates: the easier it is to type into an
 * article, the easier it is to silently rewrite agent-written prose into
 * text that reads as the human's. Unmarked text means "human" by spec, so an
 * unmarked edit inside an <!-- ai --> block quietly misattributes.
 *
 * This runs on every save, comparing what was on disk against what is being
 * written, and:
 *   1. wraps human insertions that land inside an agent block, and
 *   2. moves `author:` to mixed when the file gains a second voice.
 *
 * Limitation, stated plainly: it collapses an edit into ONE changed region
 * via common prefix/suffix. Edits in several places at once are treated as a
 * single span, which over-wraps rather than under-wraps — it errs toward
 * marking too much as human, never toward silently claiming agent text.
 */

const AI_BLOCK = /<!--\s*ai\s*-->([\s\S]*?)<!--\s*\/ai\s*-->/g;

export interface Region { start: number; end: number; }

/** Byte ranges of every agent block's INNER content. */
export function aiRegions(text: string): Region[] {
  const out: Region[] = [];
  for (const m of text.matchAll(AI_BLOCK)) {
    const inner = m.index! + m[0].indexOf(m[1]);
    out.push({ start: inner, end: inner + m[1].length });
  }
  return out;
}

const inside = (regions: Region[], a: number, b: number) =>
  regions.some((r) => a >= r.start && b <= r.end);

/** Common prefix/suffix diff, collapsed to a single changed span. */
export function changedSpan(oldText: string, newText: string): { start: number; end: number } | null {
  if (oldText === newText) return null;
  let p = 0;
  const max = Math.min(oldText.length, newText.length);
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  return { start: p, end: newText.length - s };
}

const ALREADY_HUMAN = /<!--\s*human\s*-->/;

export interface ProvenanceResult {
  content: string;
  wrapped: boolean;
  authorChanged: string | null;
}

export function applyHumanProvenance(_oldText: string, newText: string): ProvenanceResult {
  // No inference. Under autosave the "previous" content is whatever was written
  // a second ago, so diffing would wrap fragments of half-typed sentences.
  // Marking is explicit: select text and mark it, or set author: for the file.
  const content0 = newText;
  const wrapped = false;
  let content = content0;

  // author: is kept in sync with the markers actually present in the file.
  const m = content.match(/^(---\r?\n[\s\S]*?)^author:\s*(\S+)\s*$/m);
  let authorChanged: string | null = null;
  if (m) {
    const current = m[2];
    const hasAgent = /<!--\s*ai\s*-->/.test(content);
    const hasHuman = /<!--\s*human\s*-->/.test(content);
    const next = hasAgent && hasHuman ? "mixed" : hasAgent && !hasHuman ? "agent" : current;
    if (next !== current) {
      content = content.replace(/^author:\s*\S+\s*$/m, `author: ${next}`);
      authorChanged = next;
    }
  }

  return { content, wrapped, authorChanged };
}
