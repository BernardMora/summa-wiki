"use client";
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, tableField, livePreviewTheme, linkClick, linkResolver, navigate } from "./livePreview.ts";

/** Wrap the current selection in provenance markers. Explicit, user-driven. */
export function markSelection(view: EditorView, kind: "human" | "ai") {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  const text = view.state.sliceDoc(from, to);
  if (/<!--\s*\/?(ai|human)\s*-->/.test(text)) return false;   // already marked
  view.dispatch({
    changes: { from, to, insert: `<!-- ${kind} -->${text}<!-- /${kind} -->` },
    selection: { anchor: from, head: from + text.length + kind.length * 2 + 22 },
  });
  return true;
}

/** Remove provenance markers touching the current selection. */
export function unmarkSelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const start = Math.max(0, from - 400);
  const slice = doc.slice(start, Math.min(doc.length, to + 400));
  const re = /<!--\s*(ai|human)\s*-->([\s\S]*?)<!--\s*\/\1\s*-->/g;
  for (const m of slice.matchAll(re)) {
    const s = start + m.index!;
    const e = s + m[0].length;
    if (from >= s && to <= e) {
      view.dispatch({ changes: { from: s, to: e, insert: m[2] } });
      return true;
    }
  }
  return false;
}

export default function Editor({
  value, onChange, resolve, onNavigate, onReady,
}: {
  value: string;
  onChange: (v: string) => void;
  resolve: (href: string) => string | null;
  onNavigate: (url: string) => void;
  onReady?: (view: EditorView) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current || view.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),   // GFM: task lists, tables, strikethrough
          livePreview,
          tableField,
          livePreviewTheme,
          linkClick,
          linkResolver.of(resolve),
          navigate.of(onNavigate),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    onReady?.(v);
    return () => { v.destroy(); view.current = null; };
  }, []);

  return <div ref={host} />;
}
