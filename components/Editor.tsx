"use client";
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview, tableField, livePreviewTheme, linkClick, linkResolver, navigate } from "./livePreview.ts";

/**
 * Envuelve o desenvuelve la selección con un marcador de énfasis.
 *
 * Si ya está envuelta se quita, para que ⌘B alterne en vez de acumular
 * asteriscos. Sin selección inserta el par y deja el cursor en medio, que es
 * lo que se espera al empezar a escribir en negritas.
 */
function toggleWrap(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const n = mark.length;

  if (from === to) {
    view.dispatch({
      changes: { from, insert: mark + mark },
      selection: { anchor: from + n },
    });
    return true;
  }

  const inner = doc.sliceString(from, to);
  // Envuelta por dentro: **texto** seleccionado con los asteriscos incluidos.
  if (inner.length >= n * 2 && inner.startsWith(mark) && inner.endsWith(mark)) {
    const bare = inner.slice(n, -n);
    view.dispatch({
      changes: { from, to, insert: bare },
      selection: { anchor: from, head: from + bare.length },
    });
    return true;
  }
  // Envuelta por fuera: los asteriscos quedaron justo afuera de la selección.
  const before = doc.sliceString(Math.max(0, from - n), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + n));
  if (before === mark && after === mark) {
    view.dispatch({
      changes: [{ from: to, to: to + n }, { from: from - n, to: from }],
      selection: { anchor: from - n, head: to - n },
    });
    return true;
  }

  view.dispatch({
    changes: [{ from, insert: mark }, { from: to, insert: mark }],
    selection: { anchor: from + n, head: to + n },
  });
  return true;
}

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

/**
 * Número de serie del marcador. Al soltar varias imágenes de golpe hay varias
 * subidas en vuelo a la vez, y con un texto fijo todas buscarían el mismo
 * marcador — la primera en terminar se comería el sitio de las demás.
 */
let uploadSeq = 0;

/**
 * Deja un marcador donde va la imagen y lo sustituye por el enlace real cuando
 * termina la subida. Así una subida lenta no congela el editor ni pierde el
 * punto donde se soltó: mientras tanto se puede seguir escribiendo.
 *
 * Devuelve el marcador para que quien inserta varias sepa cuánto avanzar.
 */
function placeImage(
  view: EditorView,
  file: File,
  from: number,
  to: number,
  upload: (f: File) => Promise<string | null>,
  onChange: (v: string) => void,
): string {
  const token = `![subiendo ${++uploadSeq}…]()`;
  view.dispatch({ changes: { from, to, insert: token } });
  upload(file).then((href) => {
    const doc = view.state.doc.toString();
    const i = doc.indexOf(token);
    // El marcador puede haber desaparecido: deshacer, o recargar la nota
    // mientras subía. Sin esta salida se escribiría el enlace en otro sitio.
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
  return token;
}

const imagesIn = (dt: DataTransfer | null) =>
  [...(dt?.files ?? [])].filter((f) => f.type.startsWith("image/"));

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
  // Misma razón: `onPasteImage` se declara en línea en ArticlePane y encierra
  // el id de la nota, así que congelarlo subiría al archivo equivocado.
  const onImageRef = useRef(onPasteImage);
  onImageRef.current = onPasteImage;

  useEffect(() => {
    if (!host.current || view.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          // Antes que defaultKeymap: en macOS ⌘I ya está tomado por otras cosas.
          keymap.of([
            { key: "Mod-b", preventDefault: true, run: (v) => toggleWrap(v, "**") },
            { key: "Mod-i", preventDefault: true, run: (v) => toggleWrap(v, "*") },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),   // GFM: task lists, tables, strikethrough
          livePreview,
          tableField,
          livePreviewTheme,
          linkClick,
          linkResolver.of(resolve),
          navigate.of(onNavigate),
          EditorView.lineWrapping,
          // Pegar una imagen dentro de la nota, Obsidian-style. Arrastrarla
          // desde el Finder se engancha más abajo, sobre un área mayor.
          EditorView.domEventHandlers({
            paste(event, view) {
              const items = event.clipboardData?.items;
              const upload = onImageRef.current;
              if (!items || !upload) return false;
              for (const it of items) {
                if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
                const file = it.getAsFile();
                if (!file) continue;
                event.preventDefault();
                const at = view.state.selection.main;
                placeImage(view, file, at.from, at.to, upload, onChange);
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

    /*
     * Arrastrar desde el Finder se escucha sobre el panel entero, no sobre el
     * editor.
     *
     * `.cm-editor` lleva `height: auto`, así que su caja mide exactamente lo
     * que ocupa el texto — y CodeMirror engancha los `domEventHandlers` en
     * `contentDOM`, más pequeño todavía. El <article> tampoco basta: termina
     * donde termina el texto. En una nota corta eso deja la mayor parte de lo
     * que se ve del panel fuera de la zona que escucha, que es justo donde uno
     * suelta la imagen — se soltaba "dentro de la nota" y no pasaba nada.
     *
     * `.panescroll` es el área visible del panel, y hay una por panel, así que
     * en vista dividida cada nota sigue recibiendo lo suyo.
     */
    const zone: HTMLElement =
      host.current.closest(".panescroll") ?? host.current.closest("article") ?? v.dom;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

    // dragenter y dragover, los dos cancelados: Chrome se conforma con
    // dragover, pero la especificación pide ambos y sin dragenter Safari no
    // llega a tratar el elemento como destino válido.
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      zone.classList.add("dropping");
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    // dragleave salta también al pasar de un hijo a otro; solo cuenta el que
    // sale de verdad del área.
    const onLeave = (e: DragEvent) => {
      if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove("dropping");
    };
    const onDrop = (e: DragEvent) => {
      zone.classList.remove("dropping");
      if (!hasFiles(e)) return;   // arrastre de texto: eso ya lo hace CodeMirror
      // Se corta el default aunque no haya ninguna imagen: soltar un .pdf o un
      // .zip navegaría fuera de la app, llevándose lo que no se haya guardado.
      e.preventDefault();
      const files = imagesIn(e.dataTransfer);
      const upload = onImageRef.current;
      if (!files.length || !upload) return;

      // Donde se soltó, no donde estaba el cursor. El `false` devuelve la
      // posición más cercana en vez de null, que es lo que permite soltar en
      // el espacio en blanco de debajo del texto.
      let at = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
      for (const [i, file] of files.entries()) {
        // Cada imagen en su propio párrafo; pegadas, markdown las deja en la
        // misma línea.
        if (i > 0) {
          v.dispatch({ changes: { from: at, insert: "\n\n" } });
          at += 2;
        }
        at += placeImage(v, file, at, at, upload, onChange).length;
      }
      v.focus();
    };

    zone.addEventListener("dragenter", onEnter);
    zone.addEventListener("dragover", onOver);
    zone.addEventListener("dragleave", onLeave);
    zone.addEventListener("drop", onDrop);

    return () => {
      zone.removeEventListener("dragenter", onEnter);
      zone.removeEventListener("dragover", onOver);
      zone.removeEventListener("dragleave", onLeave);
      zone.removeEventListener("drop", onDrop);
      zone.classList.remove("dropping");
      v.destroy();
      view.current = null;
    };
  }, []);

  return <div ref={host} />;
}
