"use client";
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { livePreview, livePreviewTheme } from "./livePreview.ts";

/**
 * Live-preview markdown editor. Formatting renders as you type; raw syntax
 * appears only on the cursor's line. The document text is never rewritten by
 * the preview layer — what you save is exactly what you typed.
 */
export default function Editor({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current || view.current) return;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          livePreview,
          livePreviewTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current.focus();
    return () => { view.current?.destroy(); view.current = null; };
  }, []);

  return <div ref={host} />;
}
