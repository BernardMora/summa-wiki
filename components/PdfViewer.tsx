"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Sel { page: number; text: string; coords: string; }
interface Highlight {
  page: number; coords: number[]; color: string; text: string;
  noteId: string; noteTitle: string;
}

const COLORS = [
  { id: "yellow", css: "rgba(255, 214, 0, .45)" },
  { id: "red", css: "rgba(255, 90, 90, .40)" },
  { id: "blue", css: "rgba(80, 150, 255, .38)" },
  { id: "purple", css: "rgba(175, 120, 255, .40)" },
];

/**
 * PDF reader with page tracking and highlights.
 *
 * A highlight is not stored here: it is a link written into a note, in the
 * pdf-plus shape (spec section 6), and read back through /api/pdf-highlights.
 * That is what lets Obsidian and this app see each other's annotations.
 */
export default function PdfViewer({
  src, name, path, onQuote,
}: {
  src: string;
  name: string;
  /** Vault-relative path, used to build the link and fetch existing highlights. */
  path?: string;
  /** Present only when a note pane is open to receive the quote. */
  onQuote?: (md: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** Bumped on every render; stale runs bail out instead of appending pages. */
  const gen = useRef(0);
  const restored = useRef(false);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.25);
  const [err, setErr] = useState("");
  const [slow, setSlow] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [copied, setCopied] = useState("");
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // ------------------------------------------------------------------ render
  const render = useCallback(async () => {
    if (!host.current) return;
    // Switching zoom restarted render while the previous pass was still
    // appending, so pages from both runs interleaved — page 55 next to 191.
    const mine = ++gen.current;
    setErr(""); setSlow(false); setPages(0);
    host.current.innerHTML = "";
    const stall = setTimeout(() => { if (mine === gen.current) setSlow(true); }, 8000);
    try {
      const modUrl = "/pdf.min.mjs";
      const pdfjs: any = await import(/* webpackIgnore: true */ modUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({
        url: src, cMapUrl: "/pdf-cmaps/", cMapPacked: true, standardFontDataUrl: "/pdf-fonts/",
      }).promise;
      if (mine !== gen.current) return;
      setPages(doc.numPages);

      // Pages in one document can have different intrinsic sizes. Scale each
      // to the SAME rendered width so the column does not jump about.
      const first = await doc.getPage(1);
      const baseWidth = first.getViewport({ scale: 1 }).width;

      for (let p = 1; p <= doc.numPages; p++) {
        if (mine !== gen.current) return;
        const pg = await doc.getPage(p);
        const natural = pg.getViewport({ scale: 1 });
        const viewport = pg.getViewport({ scale: (baseWidth / natural.width) * scale });

        const wrap = document.createElement("div");
        wrap.className = "pdfpage";
        wrap.dataset.page = String(p);
        wrap.style.width = `${viewport.width}px`;
        wrap.style.height = `${viewport.height}px`;

        const canvas = document.createElement("canvas");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        wrap.appendChild(canvas);

        const layer = document.createElement("div");
        layer.className = "pdftext";
        wrap.appendChild(layer);
        host.current.appendChild(wrap);

        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pg.render({ canvasContext: ctx, viewport }).promise;
        if (mine !== gen.current) return;

        const content = await pg.getTextContent();
        content.items.forEach((it: any, i: number) => {
          if (!it.str) return;
          const tx = pdfjs.Util.transform(viewport.transform, it.transform);
          const span = document.createElement("span");
          span.textContent = it.str;
          span.dataset.idx = String(i);
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - Math.abs(tx[3] || 10)}px`;
          span.style.fontSize = `${Math.abs(tx[3] || 10)}px`;
          layer.appendChild(span);
        });
      }
      // Return to wherever this PDF was last left.
      if (!restored.current && path) {
        restored.current = true;
        const last = Number(localStorage.getItem(`wiki.pdfpage.${path}`));
        if (last > 1) {
          requestAnimationFrame(() => {
            host.current?.querySelector(`.pdfpage[data-page="${last}"]`)
              ?.scrollIntoView({ block: "start" });
          });
        }
      }
    } catch (e: any) {
      if (mine === gen.current) setErr(e?.message ?? "no se pudo abrir el PDF");
    } finally {
      clearTimeout(stall);
    }
  }, [src, scale, path]);

  useEffect(() => { render(); }, [render]);

  // ------------------------------------------------------- existing highlights
  const loadHighlights = useCallback(async () => {
    if (!path) return;
    const r = await fetch(`/api/pdf-highlights?p=${encodeURIComponent(path)}`);
    if (r.ok) setHighlights((await r.json()).highlights ?? []);
  }, [path]);
  useEffect(() => { loadHighlights(); }, [loadHighlights]);

  /**
   * Paint highlights using the stored character offsets, so only the selected
   * portion is marked. Previously whole text runs were coloured, which lit up
   * entire lines regardless of what was actually selected.
   */
  useEffect(() => {
    if (!host.current || pages === 0) return;
    // Reset: unwrap any marks from a previous pass.
    host.current.querySelectorAll<HTMLElement>(".pdftext mark.hl").forEach((mk) => {
      const parent = mk.parentElement;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mk.textContent ?? ""), mk);
      parent.normalize();
    });

    const paint = (span: HTMLElement, from: number, to: number, colour: string, h: Highlight) => {
      const text = span.textContent ?? "";
      const a = Math.max(0, Math.min(from, text.length));
      const b = Math.max(a, Math.min(to, text.length));
      if (a === b) return;
      const mk = document.createElement("mark");
      mk.className = "hl";
      mk.style.background = colour;
      mk.textContent = text.slice(a, b);
      mk.dataset.page = String(h.page);
      mk.dataset.coords = h.coords.join(",");
      mk.dataset.note = h.noteId;
      mk.title = "Clic para quitar el resaltado";
      span.textContent = "";
      if (a > 0) span.appendChild(document.createTextNode(text.slice(0, a)));
      span.appendChild(mk);
      if (b < text.length) span.appendChild(document.createTextNode(text.slice(b)));
    };

    for (const h of highlights) {
      const pageEl = host.current.querySelector(`.pdfpage[data-page="${h.page}"] .pdftext`);
      if (!pageEl) continue;
      const colour = COLORS.find((x) => x.id === h.color)?.css ?? COLORS[0].css;
      let [a, aOff, c, cOff] = h.coords;
      if (c < a || (c === a && cOff < aOff)) { [a, c] = [c, a]; [aOff, cOff] = [cOff, aOff]; }
      for (let i = a; i <= c; i++) {
        const span = pageEl.querySelector<HTMLElement>(`span[data-idx="${i}"]`);
        if (!span) continue;
        const len = (span.textContent ?? "").length;
        paint(span, i === a ? aOff : 0, i === c ? cOff : len, colour, h);
      }
    }
  }, [highlights, pages, scale]);

  /** Click a highlight to remove it, which deletes the quote from its note. */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onClick = async (e: MouseEvent) => {
      const mk = (e.target as HTMLElement).closest("mark.hl") as HTMLElement | null;
      if (!mk) return;
      e.preventDefault(); e.stopPropagation();
      if (!confirm("¿Quitar este resaltado? Se borra también la cita de la nota.")) return;
      const noteId = mk.dataset.note;
      if (noteId) {
        await fetch("/api/pdf-highlights", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteId, page: Number(mk.dataset.page), coords: mk.dataset.coords }),
        });
      }
      setHighlights((hs) => hs.filter(
        (h) => !(h.page === Number(mk.dataset.page) && h.coords.join(",") === mk.dataset.coords),
      ));
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  // ------------------------------------------------------------ page tracking
  useEffect(() => {
    if (pages === 0 || !scroller.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        // The page occupying most of the viewport is the one you are "on".
        let best: { p: number; r: number } | null = null;
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page);
          if (!best || e.intersectionRatio > best.r) best = { p, r: e.intersectionRatio };
        }
        if (best && best.r > 0) {
          setPage(best.p);
          setPageInput(String(best.p));
          if (path) localStorage.setItem(`wiki.pdfpage.${path}`, String(best.p));
        }
      },
      { root: scroller.current, threshold: [0.1, 0.35, 0.6, 0.9] },
    );
    host.current?.querySelectorAll(".pdfpage").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages, scale, path]);

  function goToPage(n: number) {
    const target = Math.min(Math.max(1, n), pages || 1);
    host.current?.querySelector(`.pdfpage[data-page="${target}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------------------------------------------------------------- selection
  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!text || !s || s.rangeCount === 0) { setSel(null); return; }
      const node = s.anchorNode?.parentElement?.closest(".pdfpage") as HTMLElement | null;
      if (!node) { setSel(null); return; }
      const a = (s.anchorNode?.parentElement as HTMLElement)?.dataset?.idx ?? "0";
      const b = (s.focusNode?.parentElement as HTMLElement)?.dataset?.idx ?? a;
      setSel({
        page: Number(node.dataset.page),
        text,
        coords: `${a},${s.anchorOffset},${b},${s.focusOffset}`,
      });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const quoteMarkdown = (s: Sel, colour: string) => {
    const href = path ?? src.replace(/^\/api\/asset\?p=/, "");
    return `> ${s.text}\n>\n> — [${name}, p.${s.page}](${encodeURI(href)}#page=${s.page}&selection=${s.coords}&color=${colour})\n`;
  };

  function highlight(colour: string) {
    if (!sel) return;
    const md = quoteMarkdown(sel, colour);
    if (onQuote) {
      onQuote(md);
      // Optimistic paint; the note save will make it permanent.
      const [a, b, c, d] = sel.coords.split(",").map(Number);
      setHighlights((h) => [...h, {
        page: sel.page, coords: [a, b, c, d], color: colour,
        text: sel.text, noteId: "", noteTitle: "",
      }]);
    } else {
      navigator.clipboard.writeText(md);
      setCopied("cita copiada");
      setTimeout(() => setCopied(""), 1600);
    }
    window.getSelection()?.removeAllRanges();
    setSel(null);
  }

  return (
    <div className="pdfwrap">
      <div className="pdfbar">
        <button onClick={() => setScale((v) => Math.max(0.5, +(v - 0.25).toFixed(2)))} title="Alejar">−</button>
        <span className="dim">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((v) => Math.min(3, +(v + 0.25).toFixed(2)))} title="Acercar">+</button>

        <span className="pdfpageno">
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") goToPage(Number(pageInput)); }}
            onBlur={() => goToPage(Number(pageInput))}
            aria-label="Página"
          />
          <span className="dim"> de {pages || "…"}</span>
        </span>

        <span className="pdfcolors">
          {COLORS.map((c) => (
            <button
              key={c.id}
              className="swatch"
              style={{ background: c.css }}
              disabled={!sel}
              title={sel ? `Resaltar en ${c.id}` : "Selecciona texto primero"}
              onClick={() => highlight(c.id)}
            />
          ))}
        </span>

        <span className="dim">{copied}</span>
        <a href={src} download className="dim" style={{ marginLeft: "auto" }}>Descargar</a>
      </div>

      <div
        className="pdfscroll"
        ref={scroller}
        onWheel={(e) => {
          // Trackpad pinch arrives as ctrl+wheel; without this only the % buttons zoom.
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setScale((v) => Math.min(3, Math.max(0.4, +(v * (e.deltaY < 0 ? 1.08 : 1 / 1.08)).toFixed(3))));
        }}
      >
        {err && <p className="warn">Error: {err}</p>}
        {!err && pages === 0 && !slow && <p className="dim">Cargando PDF…</p>}
        {!err && pages === 0 && slow && (
          <div style={{ border: "1px solid var(--link-red)", padding: 10, fontSize: 13 }}>
            <p className="warn" style={{ margin: "0 0 4px" }}>El visor no arrancó.</p>
            <a href={src} download>Descargar {name}</a>
          </div>
        )}
        <div ref={host} className="pdfpages" />
      </div>

      {sel && (
        <div className="pdfsel">
          <div className="pdfsel-q">“{sel.text.slice(0, 160)}{sel.text.length > 160 ? "…" : ""}”</div>
          <div className="dim" style={{ fontSize: 11 }}>p.{sel.page}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
            {COLORS.map((c) => (
              <button key={c.id} className="swatch" style={{ background: c.css }}
                      onClick={() => highlight(c.id)} title={`Resaltar en ${c.id}`} />
            ))}
            <button onClick={() => { navigator.clipboard.writeText(quoteMarkdown(sel, "yellow")); setCopied("copiado"); }}>
              Copiar cita
            </button>
            {onQuote && (
              <button className="primary" onClick={() => highlight("yellow")}>Añadir a la nota</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
