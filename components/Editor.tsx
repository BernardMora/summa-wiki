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
  value, onChange, resolve, onNavigate, onReady, onPasteImage, onLinkQuery,
}: {
  value: string;
  onChange: (v: string) => void;
  resolve: (href: string) => string | null;
  onNavigate: (url: string, text: string) => void;
  onReady?: (view: EditorView) => void;
  /** Uploads a pasted image and returns the href to link, or null on failure. */
  onPasteImage?: (file: File) => Promise<string | null>;
  /**
   * Se avisa mientras se escribe `[[algo`, para ofrecer un buscador de notas.
   * `null` cuando el patrón deja de estar bajo el cursor.
   */
  onLinkQuery?: (q: { query: string; from: number; to: number; x: number; y: number } | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // El efecto que construye CodeMirror corre una sola vez, así que el callback
  // se lee por referencia para no quedar congelado en el del primer render.
  const onLinkQueryRef = useRef(onLinkQuery);
  onLinkQueryRef.current = onLinkQuery;

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
          // Paste an image straight into the note, Obsidian-style.
          EditorView.domEventHandlers({
            paste(event, view) {
              const items = event.clipboardData?.items;
              if (!items || !onPasteImage) return false;
              for (const it of items) {
                if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
                const file = it.getAsFile();
                if (!file) continue;
                event.preventDefault();
                const at = view.state.selection.main;
                // Placeholder first, so a slow upload does not look frozen.
                const token = `![subiendo…]()`;
                view.dispatch({ changes: { from: at.from, to: at.to, insert: token } });
                onPasteImage(file).then((href) => {
                  const doc = view.state.doc.toString();
                  const i = doc.indexOf(token);
                  if (i < 0) return;
                  const alt = href ? href.split("/").pop()!.replace(/\.[^.]+$/, "") : "";
                  view.dispatch({
                    changes: {
                      from: i, to: i + token.length,
                      insert: href ? `![${alt}](${encodeURI(href)})` : "",
                    },
                  });
                  onChange(view.state.doc.toString());
                });
                return true;
              }
              return false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
            if (!u.docChanged && !u.selectionSet) return;
            // Disparador `[[`: se busca hacia atrás desde el cursor, dentro de
            // la misma línea. Insertar la ruta completa a mano es justo lo que
            // esto evita — el enlace resultante es markdown estándar, no un
            // wikilink, porque es lo que exige la spec.
            const cb = onLinkQueryRef.current;
            if (!cb) return;
            const sel = u.state.selection.main;
            if (!sel.empty) return cb(null);
            const line = u.state.doc.lineAt(sel.head);
            const before = line.text.slice(0, sel.head - line.from);
            const m = /\[\[([^\[\]]*)$/.exec(before);
            if (!m) return cb(null);
            const coords = u.view.coordsAtPos(sel.head);
            cb({
              query: m[1],
              from: line.from + m.index,
              to: sel.head,
              x: coords?.left ?? 0,
              y: coords?.bottom ?? 0,
            });
          }),
        ],
      }),
    });
    view.current = v;
    onReady?.(v);
    return () => { v.destroy(); view.current = null; };
  }, []);

  return <div ref={host} />;
}
