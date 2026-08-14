"use client";
import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  LanguageDescription, bracketMatching, foldGutter, foldKeymap,
  indentOnInput, syntaxHighlighting, defaultHighlightStyle,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

/**
 * Editor de código para cualquier archivo de texto del vault.
 *
 * Deliberadamente NO es el `Editor.tsx` de las notas. Aquel monta live
 * preview, marcadores de procedencia, subida de imágenes al pegar y el
 * disparador `[[` — todo eso es específico de escribir prosa en markdown y no
 * tiene sentido sobre un `.ts`. Lo que sí comparten es CodeMirror, así que la
 * duplicación real son unas veinte líneas de configuración.
 *
 * El modo del lenguaje se carga bajo demanda: `@codemirror/language-data`
 * declara ~150 lenguajes como imports dinámicos, así que el chunk de Rust solo
 * se descarga si alguna vez se abre un `.rs`.
 */

const langCompartment = new Compartment();
const themeCompartment = new Compartment();

function isDark(): boolean {
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** oneDark en oscuro; en claro basta el resaltado por defecto de CodeMirror. */
function themeExtensions(dark: boolean) {
  return dark ? [oneDark] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

export default function CodePane({
  filename, value, readOnly = false, onChange, onSave,
}: {
  /** Solo para elegir el modo; puede ser el nombre o la ruta completa. */
  filename: string;
  value: string;
  readOnly?: boolean;
  onChange?: (v: string) => void;
  onSave?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // El efecto de construcción corre una sola vez; los callbacks se leen por
  // referencia para no congelarse en los del primer render (mismo motivo que
  // en Editor.tsx).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!host.current || view.current) return;

    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          foldGutter(),
          drawSelection(),
          rectangularSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          EditorView.lineWrapping,
          // Antes que defaultKeymap: ⌘S es guardar, no el "save file" del
          // navegador ni nada que CodeMirror quiera reclamar.
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current?.(); return true; } },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
          langCompartment.of([]),
          themeCompartment.of(themeExtensions(isDark())),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;

    // El modo llega después del primer pintado: se prefiere ver el archivo sin
    // color de inmediato a esperar a que baje el chunk del lenguaje.
    const desc = LanguageDescription.matchFilename(languages, filename.split("/").pop() ?? filename);
    let alive = true;
    desc?.load().then((support) => {
      if (alive && view.current) {
        view.current.dispatch({ effects: langCompartment.reconfigure(support) });
      }
    }).catch(() => { /* lenguaje sin modo instalable: se queda en texto plano */ });

    // CodeMirror no lee variables CSS; hay que reconfigurarlo al cambiar el
    // tema, igual que xterm en TerminalPane.
    const repaint = () => {
      view.current?.dispatch({ effects: themeCompartment.reconfigure(themeExtensions(isDark())) });
    };
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", repaint);

    return () => {
      alive = false;
      mo.disconnect();
      mq.removeEventListener("change", repaint);
      v.destroy();
      view.current = null;
    };
  }, []);

  /**
   * Recarga externa (otro proceso tocó el archivo, o se resolvió un conflicto).
   * Se compara contra el documento actual para no pisar lo que se está
   * escribiendo ni mover el cursor en cada pulsación.
   */
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="codepane" ref={host} />;
}
