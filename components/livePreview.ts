import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, Facet, type EditorState } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType,
} from "@codemirror/view";

/**
 * Obsidian-style live preview. This is now the ONLY view of a note, so it has
 * to carry what a separate rendered view used to: images render inline, links
 * navigate, checkboxes toggle.
 *
 * Formatting applies while editing; raw markdown syntax is revealed only on the
 * line the cursor is on. Everything here is presentation — the document text is
 * only ever changed by explicit user action (ticking a checkbox), never by the
 * preview layer itself.
 */

/** href (as written in the doc) -> URL the app should navigate to or load. */
export const linkResolver = Facet.define<(href: string) => string | null, (href: string) => string | null>({
  combine: (v) => v[0] ?? (() => null),
});
export const navigate = Facet.define<(url: string) => void, (url: string) => void>({
  combine: (v) => v[0] ?? (() => {}),
});

const MARKS = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark",
  "QuoteMark", "LinkMark", "URL", "CodeInfo",
]);

const STYLED: Record<string, string> = {
  ATXHeading1: "cm-h1", ATXHeading2: "cm-h2", ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4", ATXHeading5: "cm-h4", ATXHeading6: "cm-h4",
  StrongEmphasis: "cm-strong", Emphasis: "cm-em", InlineCode: "cm-code",
  Strikethrough: "cm-strike", Link: "cm-link", Blockquote: "cm-quote",
  FencedCode: "cm-fence", CodeBlock: "cm-fence",
};

class ProvWidget extends WidgetType {
  constructor(private readonly label: string, private readonly kind: string) { super(); }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-prov cm-prov-${this.kind}`;
    s.textContent = this.label;
    return s;
  }
  eq(o: ProvWidget) { return o.label === this.label && o.kind === this.kind; }
  ignoreEvent() { return true; }
}

/** A real checkbox that rewrites the document when ticked. */
class CheckWidget extends WidgetType {
  constructor(private readonly checked: boolean, private readonly pos: number) { super(); }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-task";
    input.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("click", (e) => {
      e.preventDefault();
      // pos points at the character between the brackets.
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" },
      });
    });
    return input;
  }
  eq(o: CheckWidget) { return o.checked === this.checked && o.pos === this.pos; }
  ignoreEvent() { return false; }
}

/**
 * Renders a GFM table as a real table when the cursor is outside it.
 * Put the cursor inside and the pipe syntax comes back, so it stays editable.
 */
class TableWidget extends WidgetType {
  constructor(private readonly src: string) { super(); }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-tablewrap";
    const table = document.createElement("table");
    table.className = "cm-table";

    const rows = this.src.split("\n").filter((r) => r.trim());
    const cells = (row: string) =>
      row.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
    const isDelim = (row: string) => /^[\s|:-]+$/.test(row) && row.includes("-");

    let head = true;
    for (const row of rows) {
      if (isDelim(row)) { head = false; continue; }
      const tr = document.createElement("tr");
      for (const c of cells(row)) {
        const td = document.createElement(head ? "th" : "td");
        // Inline markdown inside cells: bold, italic, code.
        td.innerHTML = c
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
        tr.appendChild(td);
      }
      (head ? table.createTHead() : table).appendChild(tr);
    }
    wrap.appendChild(table);
    return wrap;
  }
  eq(o: TableWidget) { return o.src === this.src; }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(private readonly src: string, private readonly alt: string) { super(); }
  toDOM() {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-img";
    return img;
  }
  eq(o: ImageWidget) { return o.src === this.src; }
  ignoreEvent() { return true; }
}

const PROV_RE = /<!--\s*(\/?)(ai|human)\s*-->/g;
const TASK_RE = /^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\]/;
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const resolve = view.state.facet(linkResolver);

  const activeFrom = doc.lineAt(sel.from).from;
  const activeTo = doc.lineAt(sel.to).to;
  const isActive = (pos: number) => pos >= activeFrom && pos <= activeTo;

  interface Item { from: number; to: number; deco: Decoration }
  const items: Item[] = [];

  // Frontmatter: metadata, not prose. lezer-markdown does not parse it.
  if (doc.lines > 0 && doc.line(1).text.trim() === "---") {
    items.push({ from: doc.line(1).from, to: doc.line(1).from, deco: Decoration.line({ class: "cm-fm cm-fm-start" }) });
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-fm" }) });
      if (line.text.trim() === "---") break;
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        const cls = STYLED[node.name];
        if (cls) items.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: cls }) });
        if (node.name === "Table") return false;   // handled by tableField below
        if (MARKS.has(node.name) && !isActive(node.from) && node.to > node.from) {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
        }
      },
    });

    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);

      // Checkboxes: always interactive, even on the active line — ticking one
      // is a deliberate edit, not a formatting reveal.
      const m = TASK_RE.exec(line.text);
      if (m) {
        const [, indent, bullet, gap, state] = m;
        // Hide the list bullet: the checkbox already reads as a list item.
        // Indentation is preserved so nesting still shows.
        const bulletFrom = line.from + indent.length;
        const bulletTo = bulletFrom + bullet.length + gap.length;
        items.push({ from: bulletFrom, to: bulletTo, deco: Decoration.replace({}) });

        const boxStart = bulletTo;                     // at "["
        items.push({
          from: boxStart, to: boxStart + 3,
          deco: Decoration.replace({ widget: new CheckWidget(state.toLowerCase() === "x", boxStart + 1) }),
        });
        if (state.toLowerCase() === "x") {
          items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-task-done" }) });
        }
      }

      // Images render inline unless the cursor is on that line.
      for (const im of line.text.matchAll(IMG_RE)) {
        const s = line.from + im.index!;
        const e = s + im[0].length;
        if (isActive(s)) continue;
        const url = resolve(decodeURIComponent(im[2]));
        if (!url) continue;
        items.push({ from: s, to: e, deco: Decoration.replace({ widget: new ImageWidget(url, im[1]) }) });
      }

      // Provenance markers -> chips.
      for (const pm of line.text.matchAll(PROV_RE)) {
        const s = line.from + pm.index!;
        const e = s + pm[0].length;
        if (isActive(s)) continue;
        items.push({
          from: s, to: e,
          deco: Decoration.replace({
            widget: new ProvWidget(pm[1] === "/" ? `⟨/${pm[2]}⟩` : `⟨${pm[2]}⟩`, pm[2]),
          }),
        });
      }
    }
  }

  items.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const it of items) b.add(it.from, it.to, it.deco);
  return b.finish();
}

/**
 * Tables must live in a StateField, not the ViewPlugin: CodeMirror refuses
 * decorations that replace line breaks when they come from a plugin
 * ("Decorations that replace line breaks may not be specified via plugins").
 */
function buildTables(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const sel = state.selection.main;
  const rows: { from: number; to: number; deco: Decoration }[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const cursorInside = sel.from <= node.to && sel.to >= node.from;
      if (!cursorInside) {
        rows.push({
          from: node.from, to: node.to,
          deco: Decoration.replace({
            widget: new TableWidget(state.sliceDoc(node.from, node.to)),
            block: true,
          }),
        });
      }
      return false;
    },
  });

  rows.sort((a, b2) => a.from - b2.from);
  for (const r of rows) b.add(r.from, r.to, r.deco);
  return b.finish();
}

export const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildTables(tr.state);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Links must still navigate now that the editor is the only view.
 * Cmd/Ctrl+click follows a link; a plain click just places the cursor, so
 * editing link text stays possible.
 */
export const linkClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    for (const m of line.text.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (col >= m.index! && col <= m.index! + m[0].length) {
        const href = decodeURIComponent(m[2]);
        const url = view.state.facet(linkResolver)(href);
        if (url) { event.preventDefault(); view.state.facet(navigate)(url); return true; }
      }
    }
    return false;
  },
});

export const livePreviewTheme = EditorView.theme({
  "&": { fontSize: "14.2px", backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-content": {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    lineHeight: "1.6", padding: "12px 16px", caretColor: "var(--fg)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-selectionBackground": { background: "var(--sel)" },
  "&.cm-focused .cm-selectionBackground": { background: "var(--sel)" },
  ".cm-h1": { fontFamily: "Georgia, serif", fontSize: "1.85em", lineHeight: "1.25" },
  ".cm-h2": { fontFamily: "Georgia, serif", fontSize: "1.45em", lineHeight: "1.3" },
  ".cm-h3": { fontWeight: "700", fontSize: "1.15em" },
  ".cm-h4": { fontWeight: "700" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-code": {
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.92em",
    background: "var(--panel-grey)", padding: "1px 3px", borderRadius: "2px",
  },
  ".cm-fence": { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.9em" },
  ".cm-link": { color: "var(--link)", cursor: "pointer" },
  ".cm-quote": { color: "var(--muted)", fontStyle: "italic" },
  ".cm-task": { marginRight: "6px", verticalAlign: "middle", cursor: "pointer" },
  ".cm-task-done": { color: "var(--muted)", textDecoration: "line-through" },
  ".cm-img": { maxWidth: "100%", height: "auto", display: "block", margin: "6px 0", borderRadius: "3px" },
  ".cm-tablewrap": { overflowX: "auto", margin: "8px 0" },
  ".cm-table": { borderCollapse: "collapse", fontSize: "13px" },
  ".cm-table th, .cm-table td": {
    border: "1px solid var(--line-soft)", padding: "5px 9px", textAlign: "left",
  },
  ".cm-table th": { background: "var(--panel-grey)", fontWeight: "700" },
  ".cm-prov": {
    fontSize: "10px", padding: "1px 5px", borderRadius: "8px",
    fontFamily: "ui-monospace, Menlo, monospace", verticalAlign: "middle",
  },
  ".cm-prov-ai": { background: "var(--ai-bg)", color: "var(--ai-line)", border: "1px solid var(--ai-line)" },
  ".cm-prov-human": { background: "var(--human-bg)", color: "var(--human-line)", border: "1px solid var(--human-line)" },
  ".cm-fm": {
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11.5px",
    color: "var(--muted)", background: "var(--panel-grey)",
    borderLeft: "3px solid var(--line-soft)", paddingLeft: "8px",
  },
  ".cm-fm-start": { paddingTop: "4px" },
});
