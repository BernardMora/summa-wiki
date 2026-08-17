"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

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
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** Bumped on every render; stale runs bail out instead of appending pages. */
  const gen = useRef(0);
  /** Page to land on after a render: survives zoom changes and remounts. */
  const wantPage = useRef(1);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** True while a render is settling; the tracker must not clobber the target. */
  const restoring = useRef(false);
  const docRef = useRef<any>(null);
  const [drawn, setDrawn] = useState(0);
  const [pages, setPages] = useState(0);
  const pagesRef = useRef(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.25);
  const [err, setErr] = useState("");
  const [slow, setSlow] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [copied, setCopied] = useState("");
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // ------------------------------------------------------------------ render
  /**
   * Placeholders first, pixels later.
   *
   * Rendering all 250 pages before restoring the scroll position meant you sat
   * on page 1 for as long as that took, and any scroll in the meantime
   * overwrote the target. Now every page gets a correctly sized placeholder
   * immediately, so the target page exists within milliseconds and can be
   * scrolled to; canvases are drawn only for pages near the viewport.
   */
  const render = useCallback(async () => {
    if (!host.current) return;
    const mine = ++gen.current;
    setErr(""); setSlow(false); setPages(0); pagesRef.current = 0;
    host.current.innerHTML = "";
    const stall = setTimeout(() => { if (mine === gen.current) setSlow(true); }, 8000);

    restoring.current = true;

    // Resolve the destination here rather than in a separate effect. A seed
    // effect raced the render — and when this file was restructured it was
    // dropped entirely, which is why reopening always landed on page 1.
    let target = wantPage.current;
    if (target <= 1 && path) {
      const cached = Number(localStorage.getItem(`wiki.pdfpage.${path}`));
      if (cached > 1) target = cached;
      try {
        const r = await fetch(`/api/pdf-state?p=${encodeURIComponent(path)}`);
        if (r.ok) {
          const n = Number((await r.json())?.page);
          if (n > 1) target = n;          // the vault wins over the local cache
        }
      } catch { /* offline or first run: keep whatever we have */ }
      if (mine !== gen.current) return;
      if (target > 1) { wantPage.current = target; setPage(target); setPageInput(String(target)); }
    }

    try {
      const modUrl = "/pdf.min.mjs";
      const pdfjs: any = await import(/* webpackIgnore: true */ modUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({
        url: src, cMapUrl: "/pdf-cmaps/", cMapPacked: true, standardFontDataUrl: "/pdf-fonts/",
      }).promise;
      if (mine !== gen.current) return;
      docRef.current = doc;
      setPages(doc.numPages); pagesRef.current = doc.numPages;

      // One page decides the size for all, so every page renders the same width.
      const first = await doc.getPage(1);
      const natural = first.getViewport({ scale: 1 });
      const width = natural.width * scale;
      const height = natural.height * scale;
      if (mine !== gen.current) return;

      const frag = document.createDocumentFragment();
      for (let p = 1; p <= doc.numPages; p++) {
        const wrap = document.createElement("div");
        wrap.className = "pdfpage";
        wrap.dataset.page = String(p);
        wrap.dataset.state = "pending";
        wrap.style.width = `${width}px`;
        wrap.style.height = `${height}px`;
        frag.appendChild(wrap);
      }
      host.current.appendChild(frag);

      // The destination exists now, so land on it before drawing anything.
      if (target > 1) {
        host.current.querySelector(`.pdfpage[data-page="${target}"]`)
          ?.scrollIntoView({ block: "start" });
      }
      requestAnimationFrame(() => { restoring.current = false; });

      drawNearby(mine);
    } catch (e: any) {
      if (mine === gen.current) setErr(e?.message ?? t("pdf.openFailed"));
    } finally {
      clearTimeout(stall);
      // Always release the tracker. If the document never resolves, leaving
      // this set would freeze the page counter for good.
      if (mine === gen.current) restoring.current = false;
    }
  }, [src, scale, path]);

  /** Draw canvases for pages in or near the viewport; skip the rest. */
  const drawNearby = useCallback(async (mine: number) => {
    const sc = scroller.current, hostEl = host.current, doc = docRef.current;
    if (!sc || !hostEl || !doc) return;
    const modUrl = "/pdf.min.mjs";
    const pdfjs: any = await import(/* webpackIgnore: true */ modUrl);
    const box = sc.getBoundingClientRect();
    const margin = box.height * 1.5;

    const wraps = [...hostEl.querySelectorAll<HTMLElement>('.pdfpage[data-state="pending"]')];
    for (const wrap of wraps) {
      if (mine !== gen.current) return;
      const r = wrap.getBoundingClientRect();
      if (r.bottom < box.top - margin || r.top > box.bottom + margin) continue;
      wrap.dataset.state = "drawing";

      const p = Number(wrap.dataset.page);
      const pg = await doc.getPage(p);
      if (mine !== gen.current) return;
      const nat = pg.getViewport({ scale: 1 });
      const viewport = pg.getViewport({ scale: (parseFloat(wrap.style.width) / nat.width) });

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
      // Capa de enlaces. Se construye a mano en vez de usar AnnotationLayer de
      // pdf.js porque el módulo se carga con webpackIgnore desde /public y
      // arrastrar su CSS por esa vía es más frágil que dibujar cuatro anclas.
      try {
        const anns = await pg.getAnnotations({ intent: "display" });
        if (mine !== gen.current) return;
        const links = document.createElement("div");
        links.className = "pdflinks";
        for (const a of anns as any[]) {
          if (a.subtype !== "Link") continue;
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
          const el = document.createElement(a.url ? "a" : "button");
          el.className = "pdflink";
          el.style.left = `${Math.min(x1, x2)}px`;
          el.style.top = `${Math.min(y1, y2)}px`;
          el.style.width = `${Math.abs(x2 - x1)}px`;
          el.style.height = `${Math.abs(y2 - y1)}px`;
          if (a.url) {
            const link = el as HTMLAnchorElement;
            link.href = a.url;
            link.target = "_blank";
            // El PDF es contenido de terceros: nunca se le da acceso a opener.
            link.rel = "noopener noreferrer";
            link.title = a.url;
          } else if (a.dest) {
            // Destino interno: se salta a su página dentro del propio visor.
            el.title = t("pdf.goToSection");
            el.addEventListener("click", async (ev) => {
              ev.preventDefault();
              try {
                const d = typeof a.dest === "string" ? await doc.getDestination(a.dest) : a.dest;
                const idx = await doc.getPageIndex(d[0]);
                goToPage(idx + 1);
              } catch { /* destino ilegible */ }
            });
          } else continue;
          links.appendChild(el);
        }
        if (links.childElementCount) wrap.appendChild(links);
      } catch { /* PDF sin anotaciones legibles */ }

      wrap.dataset.state = "done";
      setDrawn((n) => n + 1);
    }
  }, []);

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
      mk.title = t("pdf.clickToUnhighlight");
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
  }, [highlights, pages, scale, drawn]);

  /** Click a highlight to remove it, which deletes the quote from its note. */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onClick = async (e: MouseEvent) => {
      const mk = (e.target as HTMLElement).closest("mark.hl") as HTMLElement | null;
      if (!mk) return;
      e.preventDefault(); e.stopPropagation();
      if (!confirm(t("pdf.confirmUnhighlight"))) return;
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
  /**
   * Which page you are on, read from the scroll position.
   *
   * This used to use an IntersectionObserver attached in an effect keyed on
   * `pages`. That effect ran the moment the page count was known, which is
   * BEFORE the page elements are appended — so it observed nothing and the
   * counter sat at 1 forever, which in turn made every zoom restore to 1.
   * Reading positions on scroll has no attach-timing problem.
   */
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const els = host.current?.querySelectorAll<HTMLElement>(".pdfpage");
      if (!els || els.length === 0) return;
      const anchor = sc.getBoundingClientRect().top + 60;   // just below the toolbar
      let current = 1;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top <= anchor) current = Number(el.dataset.page);
        else break;                                          // pages are in order
      }
      if (restoring.current) return;
      drawNearby(gen.current);
      if (current !== wantPage.current) {
        wantPage.current = current;
        setPage(current);
        setPageInput(String(current));
        if (path) {
          localStorage.setItem(`wiki.pdfpage.${path}`, String(current));
          clearTimeout(saveTimer.current);
          // Debounced so scrolling does not hammer the disk.
          saveTimer.current = setTimeout(() => {
            fetch("/api/pdf-state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ p: path, page: current }),
            }).catch(() => {});
          }, 1200);
        }
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    sc.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { sc.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [pages, scale, path, drawNearby]);

  function goToPage(n: number) {
    // Se lee por referencia: drawNearby es un useCallback con deps vacías, y su
    // closure capturó el render inicial, donde `pages` todavía era 0 — los
    // enlaces internos habrían saltado siempre a la página 1.
    const total = pagesRef.current || pages || 1;
    const target = Math.min(Math.max(1, n), total);
    wantPage.current = target;
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
      setCopied(t("pdf.quoteCopied"));
      setTimeout(() => setCopied(""), 1600);
    }
    window.getSelection()?.removeAllRanges();
    setSel(null);
  }

  return (
    <div className="pdfwrap">
      <div className="pdfbar">
        <button onClick={() => setScale((v) => Math.max(0.5, +(v - 0.25).toFixed(2)))} title={t("pdf.zoomOut")}>−</button>
        <span className="dim">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((v) => Math.min(3, +(v + 0.25).toFixed(2)))} title={t("pdf.zoomIn")}>+</button>

        <span className="pdfpageno">
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") goToPage(Number(pageInput)); }}
            onBlur={() => goToPage(Number(pageInput))}
            aria-label={t("pdf.page")}
          />
          <span className="dim"> {t("pdf.ofPages", { n: pages || "…" })}</span>
        </span>

        <span className="pdfcolors">
          {COLORS.map((c) => (
            <button
              key={c.id}
              className="swatch"
              style={{ background: c.css }}
              disabled={!sel}
              title={sel ? `Resaltar en ${c.id}` : t("pdf.selectTextFirst")}
              onClick={() => highlight(c.id)}
            />
          ))}
        </span>

        <span className="dim">{copied}</span>
        <a href={src} download className="dim" style={{ marginLeft: "auto" }}>{t("chrome.download")}</a>
      </div>

      <div
        className="pdfscroll"
        ref={scroller}
        onWheel={(e) => {
          // Trackpad pinch arrives as ctrl+wheel. ZoomGuard blocks it page-wide
          // and lets it through here, so this is the only place it zooms.
          if (!e.ctrlKey) return;
          e.preventDefault();
          setScale((v) => Math.min(3, Math.max(0.4, +(v * (e.deltaY < 0 ? 1.08 : 1 / 1.08)).toFixed(3))));
        }}
      >
        {err && <p className="warn">Error: {err}</p>}
        {!err && pages === 0 && !slow && <p className="dim">{t("pdf.loading")}</p>}
        {!err && pages === 0 && slow && (
          <div style={{ border: "1px solid var(--link-red)", padding: 10, fontSize: 13 }}>
            <p className="warn" style={{ margin: "0 0 4px" }}>{t("pdf.viewerFailed")}</p>
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
              <button className="primary" onClick={() => highlight("yellow")}>{t("pdf.addToNote")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
