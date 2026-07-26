"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Sel {
  page: number;
  text: string;
  /** pdf-plus style selection coordinates: beginIndex,beginOffset,endIndex,endOffset */
  coords: string;
}

/**
 * PDF reader with highlight capture.
 *
 * Highlights are emitted in the shape pdf-plus already uses, so Obsidian and
 * this app read each other's annotations instead of maintaining two parallel
 * sets over the same document (spec section 6):
 *
 *   [file, p.3](path/to/file.pdf#page=3&selection=1,0,1,42&color=yellow)
 *
 * The text layer is rendered so real text selection works; scanned PDFs with
 * no text layer will render but cannot be highlighted.
 */
export default function PdfViewer({
  src, name, onQuote,
}: { src: string; name: string; onQuote?: (md: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [copied, setCopied] = useState("");
  const [slow, setSlow] = useState(false);

  const render = useCallback(async () => {
    if (!host.current) return;
    setErr(""); setRendered(0); setSlow(false);
    // Surface a stall instead of sitting on an empty page forever: pdfjs can
    // hang rather than reject if its worker never comes up.
    const stall = setTimeout(() => setSlow(true), 8000);
    host.current.innerHTML = "";
    try {
      // pdfjs must NOT go through webpack. Bundling it produced
      // "Object.defineProperty called on non-object" with both the modern and
      // the legacy builds. webpackIgnore leaves the specifier alone so the
      // browser loads the file natively as an ES module from /public.
      const modUrl = "/pdf.min.mjs";
      const pdfjs: any = await import(/* webpackIgnore: true */ modUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({
        url: src,
        // Fonts and cmaps ship with the package; without these, PDFs with
        // embedded CJK or unusual encodings render blank.
        cMapUrl: "/pdf-cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdf-fonts/",
      }).promise;
      setPages(doc.numPages);

      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale });

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
        layer.style.width = `${viewport.width}px`;
        layer.style.height = `${viewport.height}px`;
        wrap.appendChild(layer);

        host.current.appendChild(wrap);

        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        const content = await page.getTextContent();
        // Position each text run over the canvas so selection maps to real text.
        content.items.forEach((it: any, i: number) => {
          if (!it.str) return;
          const tx = pdfjs.Util.transform(viewport.transform, it.transform);
          const span = document.createElement("span");
          span.textContent = it.str;
          span.dataset.idx = String(i);
          span.style.left = `${tx[4]}px`;
          span.style.top = `${tx[5] - Math.abs(tx[3] || 10)}px`;
          span.style.fontSize = `${Math.abs(tx[3] || 10)}px`;
          span.style.transform = `scaleX(${(it.width * scale) / Math.max(1, it.str.length * Math.abs(tx[3]) * 0.5)})`;
          layer.appendChild(span);
        });

        setRendered(p);
      }
    } catch (e: any) {
      setErr(e?.message ?? "no se pudo abrir el PDF");
    } finally {
      clearTimeout(stall);
    }
  }, [src, scale]);

  useEffect(() => { render(); }, [render]);

  // Capture a selection and turn it into pdf-plus coordinates.
  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!text || !s || s.rangeCount === 0) { setSel(null); return; }
      const node = s.anchorNode?.parentElement?.closest(".pdfpage") as HTMLElement | null;
      if (!node) { setSel(null); return; }
      const page = Number(node.dataset.page);
      const a = (s.anchorNode?.parentElement as HTMLElement)?.dataset?.idx ?? "0";
      const b = (s.focusNode?.parentElement as HTMLElement)?.dataset?.idx ?? a;
      setSel({
        page,
        text,
        coords: `${a},${s.anchorOffset},${b},${s.focusOffset}`,
      });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  function quoteMarkdown(s: Sel) {
    const href = `${src.replace(/^\/api\/asset\?p=/, "")}#page=${s.page}&selection=${s.coords}&color=yellow`;
    return `> ${s.text}\n>\n> — [${name}, p.${s.page}](${href})\n`;
  }

  return (
    <div className="pdfwrap">
      <div className="pdfbar">
        <button onClick={() => setScale((v) => Math.max(0.5, +(v - 0.25).toFixed(2)))}>−</button>
        <span className="dim">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((v) => Math.min(3, +(v + 0.25).toFixed(2)))}>+</button>
        <span className="dim">{rendered}/{pages || "…"} páginas</span>
        <a href={src} download className="dim" style={{ marginLeft: "auto" }}>Descargar</a>
      </div>

      <div className="pdfscroll">
      {err && <p className="warn">Error: {err}</p>}
      {!err && pages === 0 && !slow && <p className="dim">Cargando PDF…</p>}
      {!err && pages === 0 && slow && (
        <div style={{ border: "1px solid var(--link-red)", padding: 10, fontSize: 13 }}>
          <p className="warn" style={{ margin: "0 0 4px" }}>El visor no arrancó.</p>
          <p className="dim" style={{ margin: "0 0 8px" }}>
            Suele ser el worker de PDF.js. El archivo sigue disponible:
          </p>
          <a href={src} download>Descargar {name}</a>
        </div>
      )}
      <div ref={host} className="pdfpages" />
      </div>

      {sel && (
        <div className="pdfsel">
          <div className="pdfsel-q">“{sel.text.slice(0, 180)}{sel.text.length > 180 ? "…" : ""}”</div>
          <div className="dim" style={{ fontSize: 11 }}>p.{sel.page} · selection={sel.coords}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              onClick={() => {
                navigator.clipboard.writeText(quoteMarkdown(sel));
                setCopied("copiado"); setTimeout(() => setCopied(""), 1500);
              }}
            >Copiar cita</button>
            {onQuote && (
              <button className="primary" onClick={() => onQuote(quoteMarkdown(sel))}>
                Añadir a la nota
              </button>
            )}
            <span className="dim">{copied}</span>
          </div>
        </div>
      )}
    </div>
  );
}
