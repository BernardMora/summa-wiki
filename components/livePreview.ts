import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType,
} from "@codemirror/view";

/**
 * Obsidian-style live preview.
 *
 * Formatting is applied while editing, and the raw markdown syntax is only
 * revealed on the line the cursor is on. So `**bold**` reads as bold until you
 * click into it, at which point the asterisks reappear and can be edited.
 *
 * Everything here is presentation only — the document text is never altered,
 * which matters because the provenance markers and the file on disk must stay
 * byte-exact.
 */

/** Syntax marker nodes that get hidden when the cursor is elsewhere. */
const MARKS = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark",
  "QuoteMark", "LinkMark", "URL", "CodeInfo",
]);

/** Nodes whose whole range gets a style class. */
const STYLED: Record<string, string> = {
  ATXHeading1: "cm-h1", ATXHeading2: "cm-h2", ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4", ATXHeading5: "cm-h4", ATXHeading6: "cm-h4",
  StrongEmphasis: "cm-strong", Emphasis: "cm-em", InlineCode: "cm-code",
  Strikethrough: "cm-strike", Link: "cm-link", Blockquote: "cm-quote",
  FencedCode: "cm-fence", CodeBlock: "cm-fence",
};

/** The provenance comments render as coloured chips rather than raw HTML. */
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

const PROV_RE = /<!--\s*(\/?)(ai|human)\s*-->/g;

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  const doc = view.state.doc;

  // A line is "active" when the cursor or selection touches it; active lines
  // show their raw syntax so it stays editable.
  const activeFrom = doc.lineAt(sel.from).from;
  const activeTo = doc.lineAt(sel.to).to;
  const isActive = (pos: number) => pos >= activeFrom && pos <= activeTo;

  interface Item { from: number; to: number; deco: Decoration }
  const items: Item[] = [];

  // YAML frontmatter is metadata, not prose. lezer-markdown does not parse it,
  // so mark it by hand: dim every line from the opening --- to the closing one.
  if (doc.line(1).text.trim() === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim() === "---") {
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-fm cm-fm-end" }) });
        break;
      }
      items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-fm" }) });
    }
    items.push({ from: doc.line(1).from, to: doc.line(1).from, deco: Decoration.line({ class: "cm-fm cm-fm-start" }) });
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        const cls = STYLED[node.name];
        if (cls) {
          items.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: cls }) });
        }
        if (MARKS.has(node.name) && !isActive(node.from) && node.to > node.from) {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
        }
      },
    });

    // Provenance markers -> chips, unless the cursor is on that line.
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(PROV_RE)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (isActive(start)) continue;
      const closing = m[1] === "/";
      items.push({
        from: start, to: end,
        deco: Decoration.replace({
          widget: new ProvWidget(closing ? "⟨/" + m[2] + "⟩" : "⟨" + m[2] + "⟩", m[2]),
        }),
      });
    }
  }

  // RangeSetBuilder demands sorted input; mark decorations must precede
  // replacements at the same position.
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const it of items) b.add(it.from, it.to, it.deco);
  return b.finish();
}

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

/** Visual styling so the editor reads like the rendered article. */
export const livePreviewTheme = EditorView.theme({
  "&": { fontSize: "14.2px" },
  ".cm-content": {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    lineHeight: "1.6",
    padding: "10px 14px",
  },
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
  ".cm-link": { color: "var(--link)" },
  ".cm-quote": { color: "var(--muted)", fontStyle: "italic" },
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
  ".cm-fm-end": { paddingBottom: "4px", marginBottom: "10px" },
});
