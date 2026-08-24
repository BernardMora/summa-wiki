import type { WikiIndex, Note } from "../types.ts";
import { candidates, health, neighbourhood, search } from "../search.ts";

/**
 * Lo que el agente puede hacer con el wiki, declarado como herramientas MCP.
 *
 * ## Por qué esto existe teniendo ya un CLI
 *
 * El CLI solo ayuda si el agente sabe que existe: hay que anunciarlo en
 * `CLAUDE.md` y confiar en que lo lea. Es un problema de **descubrimiento**, y
 * una herramienta MCP no lo tiene — aparece en su lista de herramientas sola,
 * con su esquema, sin que nadie la presente.
 *
 * ## Dos familias, y la segunda es la que no tiene equivalente
 *
 * - **Datos.** `search`, `related`, `orphans`, `candidates`, `health`,
 *   `stats`. Es la superficie del CLI, pero descubrible. Se queda lo que el
 *   agente gastaría contexto real deduciendo; lo que `cat` y `ls` ya hacen
 *   —`show`, `tree`— se fue del CLI en esta misma fase y no vuelve aquí.
 *
 * - **Interfaz.** `open_note`, `open_graph`, `focus_graph`, `highlight_notes`.
 *   Esto cambia qué ES el agente: deja de ser un panel de chat que escribe
 *   archivos y pasa a usar la app como medio de salida. La respuesta a «qué
 *   une estos dos grupos» no es un párrafo, es el grafo enfocado ahí.
 *
 * ## El contrato de las herramientas de interfaz
 *
 * No devuelven datos: devuelven la confirmación de que la vista se pidió. La
 * petición viaja por el WebSocket del chat hasta TODOS los navegadores que
 * miran esa conversación (`AcpServerMessage`), así que en vista dividida o con
 * dos ventanas abiertas la vista cambia en las dos. Y se emiten aunque no haya
 * nadie escuchando: un agente no debe fallar porque la pestaña esté cerrada.
 */

/** Una acción sobre la interfaz, pedida por el agente. */
export type UiAction =
  | { kind: "open_note"; id: string; title: string; beside: boolean }
  | { kind: "open_graph" }
  | {
      kind: "focus_graph";
      /** Nota sobre la que centrar la cámara, si se pidió una. */
      id?: string;
      /** Filtros del panel del grafo. `null` desactiva el que estuviera puesto. */
      bundle?: string | null;
      category?: string | null;
      /** Ids a resaltar. Vacío borra el resaltado anterior. */
      highlight?: string[];
    };

export interface McpContext {
  index: () => WikiIndex;
  /** Emite una acción hacia los navegadores que miran esta conversación. */
  ui: (action: UiAction) => void;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  run: (args: Record<string, unknown>, ctx: McpContext) => McpToolResult;
}

const text = (value: string): McpToolResult => ({ content: [{ type: "text", text: value }] });
const fail = (value: string): McpToolResult => ({ content: [{ type: "text", text: value }], isError: true });

const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
const num = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/**
 * Un id completo, una ruta o un slug pelado.
 *
 * Es la misma tolerancia que tenía `resolve()` en el CLI, y hace falta más
 * aquí que allá: un agente cita la nota como la vio escrita en un enlace, que
 * casi nunca es el id.
 */
export function resolveNote(index: WikiIndex, query: string): Note | undefined {
  return index.notes.find((n) => n.id === query)
    ?? index.notes.find((n) => n.path === query)
    ?? index.notes.find((n) => n.slug === query)
    ?? index.notes.find((n) => n.slug === query.replace(/\.md$/, ""))
    ?? index.notes.find((n) => n.title.toLowerCase() === query.toLowerCase());
}

/**
 * Una nota en una línea, con su id delante.
 *
 * El id va PRIMERO y siempre, aunque abulte: es lo único que el agente puede
 * pasarle de vuelta a `open_note` o a `related`, y una lista de títulos
 * bonitos con la que no se puede hacer nada obliga a una segunda búsqueda por
 * cada elemento.
 */
const line = (n: Note) => `${n.id}\t${n.title}${n.type ? `  [${n.type}]` : ""}`;

export const MCP_TOOLS: McpTool[] = [
  {
    name: "search",
    title: "Search the wiki",
    description:
      "Ranked search over every note in the vault: title, slug, headings, tags and body. "
      + "Returns note ids that can be passed to `related`, `open_note` or `focus_graph`. "
      + "Prefer this over grep — it is scored, it knows the vault's structure, and it costs one call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text. May be empty when filtering only." },
        type: { type: "string", description: "moc | area | project | knowledge | journal | source | connection | system | person" },
        pillar: { type: "string", description: "consulting | study | finance | health | content | other" },
        author: { type: "string", description: "human | agent | mixed" },
        bundle: { type: "string" },
        tag: { type: "string" },
        since: { type: "string", description: "Only notes updated on or after this ISO date (YYYY-MM-DD)." },
        limit: { type: "number", description: "Default 15." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const hits = search(ctx.index(), str(args, "query") ?? "", {
        type: str(args, "type"), pillar: str(args, "pillar"), author: str(args, "author"),
        bundle: str(args, "bundle"), tag: str(args, "tag"), since: str(args, "since"),
        limit: num(args, "limit"),
      });
      if (!hits.length) return text("No matches.");
      return text(hits.map((h) => `${line(h.note)}\n\t${h.note.path}\n\t${h.why.join(", ")}`).join("\n\n"));
    },
  },

  {
    name: "related",
    title: "Graph neighbourhood of a note",
    description:
      "Notes reachable from a note within N link hops, following links in both directions. "
      + "This is the graph, not a similarity score: use it to answer what a note sits between, "
      + "or what would be orphaned if it were deleted.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Note id, path, slug or exact title." },
        depth: { type: "number", description: "Link hops. Default 1." },
      },
      required: ["note"],
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const index = ctx.index();
      const start = resolveNote(index, str(args, "note") ?? "");
      if (!start) return fail(`No note matches "${str(args, "note") ?? ""}".`);
      const depth = num(args, "depth") ?? 1;
      const near = neighbourhood(index, start.id, depth);
      if (!near.length) return text(`"${start.title}" has no linked neighbours within ${depth} hop(s).`);
      return text(`${near.length} note(s) within ${depth} hop(s) of "${start.title}":\n`
        + near.map(line).join("\n"));
    },
  },

  {
    name: "orphans",
    title: "Notes with no inbound links",
    description:
      "Every note nothing links to. These are the vault's dead ends: written once and "
      + "unreachable by navigation. Useful before proposing where a new note should be linked from.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (_args, ctx) => {
      const orphaned = ctx.index().notes.filter((n) => n.backlinks.length === 0);
      if (!orphaned.length) return text("No orphans: every note has at least one inbound link.");
      return text(`${orphaned.length} note(s) with no inbound links:\n` + orphaned.map(line).join("\n"));
    },
  },

  {
    name: "candidates",
    title: "Articles worth writing",
    description:
      "Suggests notes worth writing, derived from graph structure rather than content: tags "
      + "shared by several notes with no hub, pairs cited together but never linked, and "
      + "isolated notes sharing a pillar. Every suggestion carries the reason it was made.",
    inputSchema: {
      type: "object",
      properties: { min: { type: "number", description: "Minimum group size. Default 3." } },
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const found = candidates(ctx.index(), num(args, "min") ?? 3);
      if (!found.length) return text("No candidates at that threshold.");
      return text(found.map((c) =>
        `[${c.kind}] ${c.label}\n  ${c.why}\n` + c.notes.map((n) => `  - ${n.id}\t${n.title}`).join("\n"),
      ).join("\n\n"));
    },
  },

  {
    name: "health",
    title: "Validate the vault against its spec",
    description:
      "Runs the schema validation: missing or invalid frontmatter, broken links, non-slug "
      + "filenames, malformed provenance markers, and active notes that have gone stale. "
      + "Grouped by issue kind. Read `04-Sistema/Bernis-Wiki/schema-spec.md` before fixing any of it.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "Only this issue kind." },
        limit: { type: "number", description: "Issues shown per kind. Default 10." },
      },
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const index = ctx.index();
      const only = str(args, "kind");
      const limit = num(args, "limit") ?? 10;
      const issues = health(index).filter((i) => !only || i.kind === only);
      if (!issues.length) return text(only ? `No "${only}" issues.` : "No issues found.");
      const byKind = new Map<string, typeof issues>();
      for (const issue of issues) {
        if (!byKind.has(issue.kind)) byKind.set(issue.kind, []);
        byKind.get(issue.kind)!.push(issue);
      }
      const blocks = [...byKind.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([kind, list]) => `${kind} (${list.length})\n`
          + list.slice(0, limit).map((i) => `  ${i.note}${i.detail ? `  — ${i.detail}` : ""}`).join("\n")
          + (list.length > limit ? `\n  … ${list.length - limit} more` : ""));
      return text(`${issues.length} issue(s) across ${index.notes.length} notes\n\n${blocks.join("\n\n")}`);
    },
  },

  {
    name: "stats",
    title: "Index statistics",
    description:
      "Counts for the whole vault: notes, words, links, orphans, and the breakdown by type, "
      + "author and bundle. One call instead of counting files.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (_args, ctx) => text(JSON.stringify(ctx.index().stats, null, 2)),
  },

  // ------------------------------------------------------------------ interfaz

  {
    name: "open_note",
    title: "Open a note in the app",
    description:
      "Opens a note in the user's workspace, in front of them. Use it when the answer IS a "
      + "note: they asked where something is written, or you want them to read the thing you "
      + "found. Set `beside` to put it in a new column next to what they are already reading, "
      + "which is how you show two notes at once.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Note id, path, slug or exact title." },
        beside: { type: "boolean", description: "Open in a new column instead of the active pane." },
      },
      required: ["note"],
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const found = resolveNote(ctx.index(), str(args, "note") ?? "");
      if (!found) return fail(`No note matches "${str(args, "note") ?? ""}".`);
      ctx.ui({ kind: "open_note", id: found.id, title: found.title, beside: args.beside === true });
      return text(`Opened "${found.title}"${args.beside === true ? " beside the current note" : ""}.`);
    },
  },

  {
    name: "open_graph",
    title: "Open the graph view",
    description:
      "Opens the vault's link graph as a tab. Call it on its own to show the whole graph; "
      + "prefer `focus_graph` when you already know what the user should be looking at, since "
      + "that opens the view and aims it in one step.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (_args, ctx) => {
      ctx.ui({ kind: "open_graph" });
      return text("Opened the graph view.");
    },
  },

  {
    name: "focus_graph",
    title: "Aim the graph at an answer",
    description:
      "Opens the graph and points it at something: centres the camera on a note and pins its "
      + "neighbourhood, filters to a bundle or category, and/or highlights a set of notes. "
      + "This is how a structural answer gets SHOWN rather than described — "
      + "'these six notes bridge the two clusters' lands as six lit nodes, not a list. "
      + "Every argument is optional; pass `highlight: []` to clear a previous highlight.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Note to centre on and pin the neighbourhood of." },
        bundle: { type: "string", description: "Filter to one bundle. Pass \"all\" to clear." },
        category: { type: "string", description: "Filter to one category. Pass \"all\" to clear." },
        highlight: {
          type: "array",
          items: { type: "string" },
          description: "Note ids to light up. An empty array clears the highlight.",
        },
      },
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const index = ctx.index();
      const action: UiAction = { kind: "focus_graph" };
      const said: string[] = [];

      const wanted = str(args, "note");
      if (wanted) {
        const found = resolveNote(index, wanted);
        if (!found) return fail(`No note matches "${wanted}".`);
        action.id = found.id;
        said.push(`centred on "${found.title}"`);
      }

      const bundle = str(args, "bundle");
      if (bundle) { action.bundle = bundle; said.push(bundle === "all" ? "bundle filter cleared" : `bundle ${bundle}`); }

      const category = str(args, "category");
      if (category) { action.category = category; said.push(category === "all" ? "category filter cleared" : `category ${category}`); }

      if (Array.isArray(args.highlight)) {
        /*
         * Se resuelve cada id ANTES de mandarlo. Un id que el grafo no conoce
         * no dibuja nada y no avisa: el agente creería haber resaltado seis
         * notas y el usuario vería el grafo igual que antes. Aquí se le dice
         * cuáles no existían.
         */
        const asked = (args.highlight as unknown[]).filter((v): v is string => typeof v === "string");
        const resolved = asked.map((value) => ({ value, note: resolveNote(index, value) }));
        const missing = resolved.filter((r) => !r.note).map((r) => r.value);
        action.highlight = resolved.flatMap((r) => (r.note ? [r.note.id] : []));
        said.push(asked.length === 0 ? "highlight cleared" : `${action.highlight.length} note(s) highlighted`);
        if (missing.length) said.push(`not found: ${missing.join(", ")}`);
      }

      ctx.ui(action);
      return text(said.length ? `Graph: ${said.join("; ")}.` : "Opened the graph view.");
    },
  },
];

export const toolByName = (name: string) => MCP_TOOLS.find((tool) => tool.name === name);
