"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EditorView } from "@codemirror/view";
import ArticlePane, { type Payload } from "./ArticlePane.tsx";
import PdfViewer from "./PdfViewer.tsx";
import { useTabs, isPdfId } from "./Tabs.tsx";

const MIN = 0.22, MAX = 0.78, KEY = "wiki.splitratio";

/**
 * Shell around one or two article panes. The split divider is draggable and
 * its ratio persists; each pane keeps its own tabs, scroll and autosave.
 */
export default function ArticleClient({ initial }: { initial: Payload }) {
  const params = useSearchParams();
  const splitId = params.get("split");
  const router = useRouter();
  const tabs = useTabs();
  const mainEditor = useRef<EditorView | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);

  useEffect(() => { tabs?.register(initial.id, initial.meta.title); }, [initial.id, initial.meta.title]);

  useEffect(() => {
    const v = Number(localStorage.getItem(KEY));
    if (v >= MIN && v <= MAX) setRatio(v);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return;
      setRatio(Math.min(MAX, Math.max(MIN, (e.clientX - box.left) / box.width)));
    };
    const up = () => {
      setDragging(false);
      document.body.classList.remove("resizing");
      setRatio((r) => { localStorage.setItem(KEY, String(r)); return r; });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging]);

  /** Quotes from a PDF land at the cursor of the main note. */
  const insertQuote = useCallback((md: string) => {
    const v = mainEditor.current;
    if (!v) return;
    const pos = v.state.doc.lineAt(v.state.selection.main.to).to;
    v.dispatch({ changes: { from: pos, insert: `\n\n${md}` }, selection: { anchor: pos + md.length + 2 } });
    v.focus();
  }, []);

  const closeSplit = () => router.push(`/note/${encodeURIComponent(initial.id)}`);

  if (!splitId) {
    return <ArticlePane initial={initial} onEditorReady={(v) => { mainEditor.current = v; }} />;
  }

  return (
    <div
      className="splitwrap"
      ref={wrap}
      style={{ gridTemplateColumns: `${ratio}fr 7px ${1 - ratio}fr` }}
    >
      <div className="splitcol">
        <ArticlePane initial={initial} showToc={false} onEditorReady={(v) => { mainEditor.current = v; }} />
      </div>

      <div
        className={`splitbar${dragging ? " dragging" : ""}`}
        onMouseDown={(e) => { e.preventDefault(); setDragging(true); document.body.classList.add("resizing"); }}
        onDoubleClick={() => { setRatio(0.5); localStorage.setItem(KEY, "0.5"); }}
        title="Arrastra para redimensionar · doble clic para 50/50"
      />

      <div className="splitcol">
        {isPdfId(splitId) ? (
          <section className="pane">
            <header className="panehead">
              <span className="panetitle"><span className="otab-kind">PDF</span>{splitId.slice(4).split("/").pop()}</span>
              <button style={{ marginLeft: "auto" }} onClick={closeSplit} title="Cerrar panel">×</button>
            </header>
            <div className="panebody">
              <PdfViewer
                src={`/api/asset?p=${encodeURIComponent(splitId.slice(4))}`}
                name={splitId.slice(4).split("/").pop() ?? "pdf"}
                onQuote={insertQuote}
              />
            </div>
          </section>
        ) : (
          <ArticlePane id={splitId} secondary onClose={closeSplit} />
        )}
      </div>
    </div>
  );
}
