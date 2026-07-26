import { Marked } from "marked";
import path from "node:path";

/**
 * Render a note body to HTML, with two wiki-specific transforms:
 *
 *  1. Provenance markers become styled spans. The <!-- ai --> comment is the
 *     STORAGE format; the colour is the presentation. Nesting is one level
 *     deep by spec, so a human span inside an agent block renders distinctly.
 *  2. Relative links and assets are rewritten to app routes, since the note
 *     lives outside the web root.
 */

export interface RenderCtx {
  /** Note id, e.g. "personal:02-Journal/Notes/abstraccion.md". */
  id: string;
  /** Path of the note's directory relative to the vault. */
  dirFromVault: string;
  /** Map of vault-relative note path -> note id, for link resolution. */
  pathToId: Map<string, string>;
}

const AI_OPEN = /<!--\s*ai\s*-->/g;
const AI_CLOSE = /<!--\s*\/ai\s*-->/g;
const HU_OPEN = /<!--\s*human\s*-->/g;
const HU_CLOSE = /<!--\s*\/human\s*-->/g;

export function markProvenance(md: string): string {
  return md
    .replace(AI_OPEN, '\n<div class="prov prov-ai" data-author="agent">\n')
    .replace(AI_CLOSE, "\n</div>\n")
    .replace(HU_OPEN, '<span class="prov prov-human" data-author="human">')
    .replace(HU_CLOSE, "</span>");
}

export function renderNote(body: string, ctx: RenderCtx, title?: string): string {
  const marked = new Marked({ gfm: true, breaks: false, async: false });

  // Most notes open with "# Same Title" as the frontmatter title. The page
  // already renders the title as its heading, so drop the duplicate.
  let src = body;
  if (title) {
    src = src.replace(/^\s*#\s+(.+?)\s*$/m, (m, h) => {
      const norm = (x: string) => x.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
      return norm(h) === norm(title) ? "" : m;
    });
  }

  const html = marked.parse(markProvenance(src)) as string;

  return html.replace(/(href|src)="([^"]+)"/g, (whole, attr: string, url: string) => {
    if (/^(https?:|mailto:|#|\/)/.test(url)) return whole;

    if (url.startsWith("aios://")) {
      // A link into a bundle the reader may not have. Never a broken link.
      const rest = url.slice("aios://".length);
      const bundle = rest.slice(0, rest.indexOf("/"));
      return `${attr}="#" class="xbundle" data-bundle="${bundle}" title="Referencia a ${bundle}"`;
    }

    const decoded = decodeURIComponent(url);
    const joined = path.posix.normalize(path.posix.join(ctx.dirFromVault, decoded));

    if (/\.md$/i.test(decoded)) {
      const target = ctx.pathToId.get(joined);
      return target
        ? `${attr}="/note/${encodeURIComponent(target)}"`
        : `${attr}="#" class="broken" title="No resuelve: ${decoded}"`;
    }
    // PDFs open in the reader; other assets stream from the asset route.
    if (/\.pdf$/i.test(decoded)) return `${attr}="/pdf?p=${encodeURIComponent(joined)}"`;
    return `${attr}="/api/asset?p=${encodeURIComponent(joined)}"`;
  });
}
