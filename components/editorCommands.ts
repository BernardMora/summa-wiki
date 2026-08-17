import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Applies line-prefix changes and explicitly maps the selection through them.
 * CodeMirror's default association leaves a caret sitting before text inserted
 * at that exact position; toolbar formatting should put it after the marker.
 */
function dispatchMapped(view: EditorView, changes: ChangeSpec) {
  const before = view.state.selection.main;
  const set = view.state.changes(changes);
  view.dispatch({
    changes: set,
    selection: {
      anchor: set.mapPos(before.anchor, 1),
      head: set.mapPos(before.head, 1),
    },
  });
}

/** Commands shared by toolbar buttons and keyboard shortcuts. */
export function toggleWrap(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const n = mark.length;

  if (from === to) {
    view.dispatch({ changes: { from, insert: mark + mark }, selection: { anchor: from + n } });
    view.focus();
    return true;
  }

  const inner = doc.sliceString(from, to);
  if (inner.length >= n * 2 && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(n, -n);
    view.dispatch({ changes: { from, to, insert: bare }, selection: { anchor: from, head: from + bare.length } });
  } else {
    const before = doc.sliceString(Math.max(0, from - n), from);
    const after = doc.sliceString(to, Math.min(doc.length, to + n));
    if (before === mark && after === mark) {
      view.dispatch({
        changes: [{ from: to, to: to + n }, { from: from - n, to: from }],
        selection: { anchor: from - n, head: to - n },
      });
    } else {
      view.dispatch({
        changes: [{ from, insert: mark }, { from: to, insert: mark }],
        selection: { anchor: from + n, head: to + n },
      });
    }
  }
  view.focus();
  return true;
}

export function setLinePrefix(view: EditorView, prefix: string) {
  const sel = view.state.selection.main;
  const first = view.state.doc.lineAt(sel.from);
  const last = view.state.doc.lineAt(sel.to);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) lines.push(view.state.doc.line(n));
  const heading = /^#{1,6}\s+/;
  const quote = /^>\s+/;
  const changes = lines.map((line) => {
    const current = line.text;
    const matcher = prefix.startsWith("#") ? heading : prefix === "> " ? quote : null;
    if (matcher?.test(current)) {
      const existing = current.match(matcher)![0];
      return { from: line.from, to: line.from + existing.length, insert: existing === prefix ? "" : prefix };
    }
    return { from: line.from, insert: prefix };
  });
  dispatchMapped(view, changes);
  view.focus();
}

export function toggleList(view: EditorView, kind: "bullet" | "number" | "task") {
  const sel = view.state.selection.main;
  const first = view.state.doc.lineAt(sel.from);
  const last = view.state.doc.lineAt(sel.to);
  const list = /^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?/;
  const lines = [];
  for (let n = first.number; n <= last.number; n++) lines.push(view.state.doc.line(n));
  const allSame = lines.every((line, i) => {
    const expected = kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${i + 1}. `;
    return line.text.startsWith(expected);
  });
  dispatchMapped(view, lines.map((line, i) => {
    const old = line.text.match(list)?.[0] ?? "";
    const next = allSame ? "" : kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${i + 1}. `;
    return { from: line.from, to: line.from + old.length, insert: next };
  }));
  view.focus();
}

export function insertText(view: EditorView, text: string, cursorOffset = text.length) {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursorOffset } });
  view.focus();
}

export function toggleHtml(view: EditorView, open: string, close: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  if (from === to) {
    view.dispatch({ changes: { from, insert: open + close }, selection: { anchor: from + open.length } });
  } else if (doc.sliceString(from, to).startsWith(open) && doc.sliceString(from, to).endsWith(close)) {
    const inner = doc.sliceString(from + open.length, to - close.length);
    view.dispatch({ changes: { from, to, insert: inner }, selection: { anchor: from, head: from + inner.length } });
  } else if (doc.sliceString(Math.max(0, from - open.length), from) === open
      && doc.sliceString(to, Math.min(doc.length, to + close.length)) === close) {
    view.dispatch({
      changes: [{ from: to, to: to + close.length }, { from: from - open.length, to: from }],
      selection: { anchor: from - open.length, head: to - open.length },
    });
  } else {
    view.dispatch({
      changes: [{ from, insert: open }, { from: to, insert: close }],
      selection: { anchor: from + open.length, head: to + open.length },
    });
  }
  view.focus();
}

export function removeSemanticStyle(view: EditorView, kind: "text" | "highlight") {
  let { from, to } = view.state.selection.main;
  const source = view.state.doc.toString();
  const openRe = kind === "text"
    ? /<span class="summa-text-[a-z]+">/gi
    : /<mark class="summa-highlight-[a-z]+">/gi;
  const close = kind === "text" ? "</span>" : "</mark>";
  const selected = source.slice(from, to);
  const selectedClean = selected.replace(openRe, "").replace(new RegExp(close, "gi"), "");
  if (selectedClean !== selected) {
    view.dispatch({ changes: { from, to, insert: selectedClean }, selection: { anchor: from, head: from + selectedClean.length } });
    view.focus();
    return true;
  }

  let opening: RegExpExecArray | null = null;
  for (const match of source.slice(0, from).matchAll(openRe)) opening = match;
  if (!opening || opening.index == null) return false;
  const openFrom = opening.index, openTo = openFrom + opening[0].length;
  const closeFrom = source.indexOf(close, Math.max(to, openTo));
  if (closeFrom < to) return false;
  view.dispatch({
    changes: [{ from: closeFrom, to: closeFrom + close.length }, { from: openFrom, to: openTo }],
    selection: { anchor: from - opening[0].length, head: to - opening[0].length },
  });
  view.focus();
  return true;
}

export function setSemanticStyle(view: EditorView, kind: "text" | "highlight", color: string) {
  removeSemanticStyle(view, kind);
  if (color === "none") return;
  const tag = kind === "text" ? "span" : "mark";
  toggleHtml(view, `<${tag} class="summa-${kind}-${color}">`, `</${tag}>`);
}

export function indentLines(view: EditorView, outdent = false) {
  const sel = view.state.selection.main;
  const first = view.state.doc.lineAt(sel.from), last = view.state.doc.lineAt(sel.to);
  const changes = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = view.state.doc.line(n);
    const remove = outdent ? Math.min(2, line.text.match(/^\s*/)?.[0].length ?? 0) : 0;
    changes.push({ from: line.from, to: line.from + remove, insert: outdent ? "" : "  " });
  }
  dispatchMapped(view, changes);
  view.focus();
}

export function clearInlineFormatting(view: EditorView) {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const clean = view.state.sliceDoc(from, to)
    .replace(/<\/?(?:u|mark|span|sup|sub)(?:\s+[^>]*)?>/gi, "")
    .replace(/(\*\*|~~|`|\*)(.*?)\1/g, "$2");
  view.dispatch({ changes: { from, to, insert: clean }, selection: { anchor: from, head: from + clean.length } });
  view.focus();
}

export function insertTable(view: EditorView) {
  insertText(view, "\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n", 3);
}

export function selectionWrapped(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const doc = view.state.doc;
  return doc.sliceString(from, to).startsWith(mark) && doc.sliceString(from, to).endsWith(mark)
    || doc.sliceString(Math.max(0, from - mark.length), from) === mark
      && doc.sliceString(to, Math.min(doc.length, to + mark.length)) === mark;
}
