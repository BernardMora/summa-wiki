"use client";
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, tableField, livePreviewTheme, linkClick, linkResolver, navigate } from "./livePreview.ts";

/**
 * Envuelve la selección en marcadores de procedencia. Explícito, lo pide el usuario.
 *
 * Antes fallaba en silencio de dos maneras. Si la selección contenía algún
 * marcador previo devolvía `false` sin decir nada, que es lo que pasaba al
 * seleccionar mucho texto: te tragabas un bloque ya marcado y el botón parecía
 * muerto. Y al abarcar varias líneas insertaba los marcadores en línea, lo que
 * los metía dentro de un encabezado y rompía el markdown.
 */
export function markSelection(view: EditorView, kind: "human" | "ai") {
  let { from, to } = view.state.selection.main;
  if (from === to) return false;

  const doc = view.state.doc;
  const a = doc.lineAt(from), b = doc.lineAt(to);
  const multi = a.number !== b.number;
  // Abarcando varias líneas se expande a líneas completas: si no, el marcador
  // quedaría a media línea de un encabezado o de una viñeta.
  if (multi) { from = a.from; to = b.to; }

  // Re-marcar reemplaza: se quitan los marcadores que hubiera dentro en vez de
  // rechazar la operación.
  const text = doc.sliceString(from, to).replace(/[ \t]*<!--\s*\/?(ai|human)\s*-->[ \t]*\n?/g, "");
  const insert = multi
    ? `<!-- ${kind} -->\n${text}\n<!-- /${kind} -->`
    : `<!-- ${kind} -->${text}<!-- /${kind} -->`;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from, head: from + insert.length },
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
  value, onChange, resolve, onNavigate, onReady, onPasteImage, onLinkQuery, onSelectionChange,
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
  /** Se avisa en cada cambio de selección, venga del ratón o del teclado. */
  onSelectionChange?: (hasSelection: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // El efecto que construye CodeMirror corre una sola vez, así que el callback
  // se lee por referencia para no quedar congelado en el del primer render.
  const onLinkQueryRef = useRef(onLinkQuery);
  onLinkQueryRef.current = onLinkQuery;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;

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
            if (u.selectionSet || u.docChanged) {
              const s = u.state.selection.main;
              onSelRef.current?.(s.from !== s.to);
            }
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
