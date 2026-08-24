import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, Facet, type EditorState } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType,
} from "@codemirror/view";

/**
 * Obsidian-style live preview. This is now the ONLY view of a note, so it has
 * to carry what a separate rendered view used to: images render inline, links
 * navigate, checkboxes toggle.
 *
 * Formatting applies while editing; raw markdown syntax is revealed only on the
 * line the cursor is on. Everything here is presentation — the document text is
 * only ever changed by explicit user action (ticking a checkbox), never by the
 * preview layer itself.
 */

/** href (as written in the doc) -> URL the app should navigate to or load. */
export const linkResolver = Facet.define<(href: string) => string | null, (href: string) => string | null>({
  combine: (v) => v[0] ?? (() => null),
});
export const navigate = Facet.define<(url: string, text: string) => void, (url: string, text: string) => void>({
  combine: (v) => v[0] ?? (() => {}),
});
export const frontmatterVisible = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

export interface ImageLabels {
  selectPath: string;
  floatLeft: string;
  floatRight: string;
  fullWidth: string;
  plain: string;
  captionPlaceholder: string;
}

/**
 * The words the image widget puts on screen.
 *
 * They arrive through a facet rather than being written here because this
 * module is the editor's rendering layer, not a place that knows the user's
 * language — the same reason `linkResolver` is a facet. Before this, the one
 * string the widget had was hardcoded Spanish, which is exactly what stops
 * being harmless the moment there are six of them.
 */
export const imageLabels = Facet.define<ImageLabels, ImageLabels>({
  combine: (values) => values[0] ?? {
    selectPath: "Select the path",
    floatLeft: "Float left",
    floatRight: "Float right",
    fullWidth: "Full width",
    plain: "Plain image",
    captionPlaceholder: "Caption",
  },
});

const MARKS = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark",
  "QuoteMark", "LinkMark", "CodeInfo",
]);

const STYLED: Record<string, string> = {
  ATXHeading1: "cm-h1", ATXHeading2: "cm-h2", ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4", ATXHeading5: "cm-h4", ATXHeading6: "cm-h4",
  StrongEmphasis: "cm-strong", Emphasis: "cm-em", InlineCode: "cm-code",
  Strikethrough: "cm-strike", Link: "cm-link", Blockquote: "cm-quote",
  FencedCode: "cm-fence", CodeBlock: "cm-fence",
};

class ProvWidget extends WidgetType {
  constructor(private readonly label: string, private readonly kind: string) { super(); }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-prov cm-prov-${this.kind}`;
    s.textContent = this.label;
    return s;
  }
  eq(o: ProvWidget) { return o.label === this.label && o.kind === this.kind; }
  ignoreEvent() { return true; }
}

/** A real checkbox that rewrites the document when ticked. */
class CheckWidget extends WidgetType {
  constructor(private readonly checked: boolean, private readonly pos: number) { super(); }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-task";
    input.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("click", (e) => {
      e.preventDefault();
      // pos points at the character between the brackets.
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" },
      });
    });
    return input;
  }
  eq(o: CheckWidget) { return o.checked === this.checked && o.pos === this.pos; }
  ignoreEvent() { return false; }
}

/** Markdown `---` rendered visually. Raw source is available through M↓. */
class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly pos: number) { super(); }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-hrwrap";
    const rule = document.createElement("hr");
    wrap.appendChild(rule);
    return wrap;
  }
  eq(other: HorizontalRuleWidget) { return other.pos === this.pos; }
  ignoreEvent() { return false; }
}

/**
 * Visual GFM table editor. Cells edit in place; controls change its shape.
 * Markdown remains the source of truth and is rewritten on blur/change.
 */
class TableWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly from: number,
    private readonly to: number,
    private readonly original: string,
    private readonly widths: number[] = [],
    private readonly heights: number[] = [],
    private readonly hasSizing = false,
  ) { super(); }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-tablewrap";
    const table = document.createElement("table");
    table.className = "cm-table";
    table.style.width = "100%";
    table.style.tableLayout = "fixed";
    const makeEditable = (cell: HTMLTableCellElement) => {
      cell.contentEditable = "true";
      cell.spellcheck = true;
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          const all = [...table.querySelectorAll<HTMLTableCellElement>("th, td")];
          const index = all.indexOf(cell) + (event.shiftKey ? -1 : 1);
          all[Math.max(0, Math.min(all.length - 1, index))]?.focus();
        }
      });
    };

    const rows = this.src.split("\n").filter((r) => r.trim());
    const cells = (row: string) =>
      row.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
    const isDelim = (row: string) => /^[\s|:-]+$/.test(row) && row.includes("-");

    let head = true;
    for (const row of rows) {
      if (isDelim(row)) { head = false; continue; }
      const tr = document.createElement("tr");
      for (const c of cells(row)) {
        const td = document.createElement(head ? "th" : "td");
        makeEditable(td);
        td.textContent = c;
        tr.appendChild(td);
      }
      (head ? table.createTHead() : table).appendChild(tr);
    }
    const columnCount = table.rows[0]?.cells.length ?? 0;
    const colgroup = document.createElement("colgroup");
    const savedTotal = this.widths.reduce((sum, width) => sum + width, 0);
    for (let index = 0; index < columnCount; index++) {
      const col = document.createElement("col");
      col.style.width = savedTotal > 0 && this.widths[index]
        ? `${(100 * this.widths[index] / savedTotal).toFixed(4)}%`
        : `${100 / Math.max(1, columnCount)}%`;
      colgroup.appendChild(col);
    }
    table.prepend(colgroup);
    for (const [index, row] of [...table.rows].entries()) {
      if (this.heights[index]) row.style.height = `${Math.min(180, this.heights[index])}px`;
    }
    wrap.appendChild(table);
    let sized = this.hasSizing;
    const serialize = () => {
      if (view.state.sliceDoc(this.from, this.to) !== this.original) return;
      const matrix = [...table.rows].map((row) => [...row.cells].map((cell) =>
        (cell.textContent ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim()));
      if (!matrix.length) return;
      const width = Math.max(1, ...matrix.map((row) => row.length));
      for (const row of matrix) while (row.length < width) row.push("");
      const line = (row: string[]) => `| ${row.join(" | ")} |`;
      const markdown = [line(matrix[0]), line(Array(width).fill("---")), ...matrix.slice(1).map(line)].join("\n");
      const columnWidths = [...table.rows[0].cells].map((cell) => Math.round(cell.getBoundingClientRect().width));
      const rowHeights = [...table.rows].map((row) => Math.round(row.getBoundingClientRect().height));
      const metadata = sized ? `<!-- summa-table ${JSON.stringify({ widths: columnWidths, heights: rowHeights })} -->\n` : "";
      const output = metadata + markdown;
      if (output !== this.original) view.dispatch({ changes: { from: this.from, to: this.to, insert: output } });
    };
    const menu = document.createElement("div");
    menu.className = "cm-tablemenu";
    let targetRow = -1, targetColumn = -1;
    const selectCell = (cell: HTMLTableCellElement) => {
      targetRow = cell.parentElement instanceof HTMLTableRowElement ? cell.parentElement.rowIndex : -1;
      targetColumn = cell.cellIndex;
      table.querySelectorAll(".cm-table-active").forEach((node) => node.classList.remove("cm-table-active"));
      cell.parentElement?.classList.add("cm-table-active");
      cell.classList.add("cm-table-active");
      menu.classList.add("open");
      const cellBox = cell.getBoundingClientRect(), wrapBox = wrap.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(wrap.clientWidth - menu.offsetWidth - 8, cellBox.left - wrapBox.left + cellBox.width / 2 - menu.offsetWidth / 2))}px`;
      menu.style.top = `${Math.max(4, cellBox.top - wrapBox.top - menu.offsetHeight - 8)}px`;
    };
    const control = (label: string, title: string, action: () => void, danger = false) => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = label; button.title = title;
      button.setAttribute("aria-label", title);
      if (danger) button.className = "danger";
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => { action(); rebuildHandles(); serialize(); });
      menu.appendChild(button);
    };
    const separator = () => { const node = document.createElement("span"); node.className = "cm-tablemenu-separator"; menu.appendChild(node); };
    control("＋↧", "Insertar fila debajo", () => {
      const at = targetRow >= 0 ? targetRow + 1 : table.rows.length;
      const row = table.insertRow(at);
      const count = table.rows[0]?.cells.length ?? 2;
      for (let i = 0; i < count; i++) makeEditable(row.insertCell());
    });
    control("↑", "Mover fila hacia arriba", () => {
      const row = table.rows[targetRow];
      if (row && targetRow > 1) { row.parentElement?.insertBefore(row, table.rows[targetRow - 1]); targetRow--; }
    });
    control("↓", "Mover fila hacia abajo", () => {
      const row = table.rows[targetRow];
      const next = table.rows[targetRow + 1];
      if (row && next && targetRow > 0) { next.after(row); targetRow++; }
    });
    control("⌫", "Eliminar fila", () => { if (table.rows.length > 1 && targetRow > 0) table.deleteRow(targetRow); }, true);
    separator();
    control("＋↦", "Insertar columna a la derecha", () => {
      const currentCount = table.rows[0]?.cells.length ?? 0;
      if (table.getBoundingClientRect().width < (currentCount + 1) * 80) return;
      for (const [i, row] of [...table.rows].entries()) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        makeEditable(cell);
        const at = targetColumn >= 0 ? targetColumn + 1 : row.cells.length;
        row.insertBefore(cell, row.cells[at] ?? null);
      }
      const col = document.createElement("col");
      colgroup.insertBefore(col, colgroup.children[targetColumn + 1] ?? null);
      equalizeColumns(); targetColumn++;
    });
    control("←", "Mover columna a la izquierda", () => moveColumn(-1));
    control("→", "Mover columna a la derecha", () => moveColumn(1));
    control("⌫", "Eliminar columna", () => {
      if ((table.rows[0]?.cells.length ?? 0) <= 1 || targetColumn < 0) return;
      for (const row of [...table.rows]) row.deleteCell(targetColumn);
      colgroup.children[targetColumn]?.remove(); equalizeColumns();
    }, true);
    separator();
    control("⌧", "Vaciar celda", () => { const cell = table.rows[targetRow]?.cells[targetColumn]; if (cell) cell.textContent = ""; });
    wrap.appendChild(menu);

    function equalizeColumns() {
      const count = colgroup.children.length;
      for (const col of [...colgroup.children] as HTMLTableColElement[]) col.style.width = `${100 / count}%`;
      sized = true;
    }
    function moveColumn(direction: -1 | 1) {
      const destination = targetColumn + direction;
      const count = table.rows[0]?.cells.length ?? 0;
      if (targetColumn < 0 || destination < 0 || destination >= count) return;
      for (const row of [...table.rows]) {
        const moving = row.cells[targetColumn];
        if (direction < 0) row.insertBefore(moving, row.cells[destination]);
        else row.insertBefore(moving, row.cells[destination]?.nextSibling ?? null);
      }
      const movingCol = colgroup.children[targetColumn];
      if (direction < 0) colgroup.insertBefore(movingCol, colgroup.children[destination]);
      else colgroup.insertBefore(movingCol, colgroup.children[destination]?.nextSibling ?? null);
      targetColumn = destination;
    }
    function positionRowHandles() {
      const handles = [...wrap.querySelectorAll<HTMLElement>(".cm-rowresize")];
      for (const [index, row] of [...table.rows].entries()) {
        const handle = handles[index];
        if (handle) handle.style.top = `${table.offsetTop + row.offsetTop + row.getBoundingClientRect().height - 5}px`;
      }
    }
    function rebuildHandles() {
      wrap.querySelectorAll(".cm-colresize, .cm-rowresize").forEach((node) => node.remove());
      const header = table.rows[0];
      if (!header) return;
      for (const [column, cell] of [...header.cells].entries()) {
        if (column >= header.cells.length - 1) continue;
        const handle = document.createElement("span");
        handle.className = "cm-colresize";
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault(); event.stopPropagation();
          const startX = event.clientX;
          const leftStart = header.cells[column].getBoundingClientRect().width;
          const rightStart = header.cells[column + 1].getBoundingClientRect().width;
          const pairWidth = leftStart + rightStart;
          const tableWidth = table.getBoundingClientRect().width;
          handle.setPointerCapture(event.pointerId); wrap.classList.add("resizing");
          const move = (moveEvent: PointerEvent) => {
            const left = Math.max(80, Math.min(pairWidth - 80, leftStart + moveEvent.clientX - startX));
            (colgroup.children[column] as HTMLTableColElement).style.width = `${100 * left / tableWidth}%`;
            (colgroup.children[column + 1] as HTMLTableColElement).style.width = `${100 * (pairWidth - left) / tableWidth}%`;
          };
          const up = () => {
            sized = true; wrap.classList.remove("resizing");
            handle.removeEventListener("pointermove", move); serialize();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up, { once: true });
          handle.addEventListener("pointercancel", up, { once: true });
        });
        cell.appendChild(handle);
      }
      for (const row of [...table.rows]) {
        const handle = document.createElement("span");
        handle.className = "cm-rowresize";
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault(); event.stopPropagation();
          const startY = event.clientY, startHeight = row.getBoundingClientRect().height;
          handle.setPointerCapture(event.pointerId); wrap.classList.add("resizing");
          const move = (moveEvent: PointerEvent) => {
            row.style.height = `${Math.max(30, Math.min(180, startHeight + moveEvent.clientY - startY))}px`;
            positionRowHandles();
          };
          const up = () => {
            sized = true; wrap.classList.remove("resizing");
            handle.removeEventListener("pointermove", move); serialize();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up, { once: true });
          handle.addEventListener("pointercancel", up, { once: true });
        });
        wrap.appendChild(handle);
      }
      positionRowHandles();
    }
    requestAnimationFrame(rebuildHandles);
    table.addEventListener("focusin", (event) => {
      const cell = (event.target as HTMLElement).closest("th, td") as HTMLTableCellElement | null;
      if (cell) requestAnimationFrame(() => selectCell(cell));
    });
    table.addEventListener("contextmenu", (event) => {
      const cell = (event.target as HTMLElement).closest("th, td") as HTMLTableCellElement | null;
      if (!cell) return;
      event.preventDefault(); selectCell(cell);
    });
    wrap.addEventListener("focusout", (event) => {
      if (!wrap.contains(event.relatedTarget as Node | null)) {
        menu.classList.remove("open"); serialize();
      }
    });
    return wrap;
  }
  eq(o: TableWidget) { return o.original === this.original && o.from === this.from && o.to === this.to; }
  // All pointer, keyboard and selection events inside the visual editor belong
  // to its contenteditable cells, not to CodeMirror's document surface.
  ignoreEvent() { return true; }
}

/**
 * Formato de imagen tipo Wikipedia, escrito con markdown estándar.
 *
 * El pie de foto es el *title* de toda la vida — `![alt](ruta "El pie")` — y no
 * una sintaxis propia: así la nota se sigue viendo bien en Obsidian, en GitHub
 * y en cualquier renderizador, que es lo que exige la spec (§2). Una imagen con
 * pie se dibuja como miniatura flotada a la derecha, que es el comportamiento
 * por defecto de Wikipedia; una imagen sin pie se queda como estaba, en bloque
 * a ancho completo, para no cambiar lo ya escrito.
 *
 * Al principio del pie caben directivas entre corchetes para los casos que la
 * regla por defecto no cubre.
 */
const DIRECTIVE_RE = /^\s*\[(izq|left|ancho|wide|w=\d{2,4})\]\s*/i;

interface Thumb { caption: string; side: "right" | "left" | "none"; width?: number }

export function parseCaption(title: string | undefined): Thumb | null {
  if (title === undefined) return null;
  let rest = title;
  let side: Thumb["side"] = "right";
  let width: number | undefined;
  // Varias directivas seguidas: `[izq][w=220] Pie`.
  for (let m = DIRECTIVE_RE.exec(rest); m; m = DIRECTIVE_RE.exec(rest)) {
    const d = m[1].toLowerCase();
    if (d === "izq" || d === "left") side = "left";
    else if (d === "ancho" || d === "wide") side = "none";
    else width = Number(d.slice(2));
    rest = rest.slice(m[0].length);
  }
  return { caption: rest.trim(), side, width };
}

/**
 * Rewrites the title of one image in the document.
 *
 * Everything an image's layout is made of — which side it floats to, whether it
 * spans the column, how wide it is, what the caption says — lives in the title
 * string of `![alt](path "title")`. The widget covers that markdown completely,
 * and clicking it only ever selected the PATH, so once an image was in the note
 * there was no way to reach the one string that decides how it looks: pasting a
 * screenshot gave you a full-width block image and no way to make it anything
 * else (issue #12).
 *
 * The range is re-read from the document instead of trusted: a widget can
 * outlive an edit that moved it, and rewriting on a stale range would replace
 * whatever text happens to sit there now. If the slice is no longer an image,
 * nothing happens.
 */
function rewriteImage(
  view: EditorView,
  from: number,
  to: number,
  change: (thumb: Thumb | null) => Thumb | null,
): void {
  if (to > view.state.doc.length) return;
  const slice = view.state.sliceDoc(from, to);
  const m = new RegExp(`^${IMG_RE.source}$`).exec(slice);
  if (!m) return;

  const next = change(parseCaption(m[3]));
  let title = "";
  if (next) {
    const directives = [
      next.side === "left" ? "[izq]" : next.side === "none" ? "[ancho]" : "",
      next.width ? `[w=${next.width}]` : "",
    ].filter(Boolean).join("");
    // A quote inside the title would close it early and leave the rest of the
    // caption loose in the markdown.
    title = `${directives}${directives && next.caption ? " " : ""}${next.caption}`.replaceAll('"', "'");
  }
  /*
   * The quotes are written whenever there IS a thumbnail, even when the title
   * inside them is empty — the presence of a title is what makes an image a
   * thumbnail in the first place (see `parseCaption`).
   *
   * Right is the default side, so a right-floated thumbnail with no caption
   * yet has nothing to say: it serialised to no title at all, parsed back as a
   * plain block image, and the button did nothing at all when clicked. An
   * empty title is legal markdown and reads the same in every renderer.
   */
  const insert = `![${m[1]}](${m[2]}${next ? ` "${title}"` : ""})`;
  if (insert === slice) return;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    /** Range of the href inside the markdown, so a click can select it. */
    private readonly hrefFrom: number,
    private readonly hrefTo: number,
    /** null = imagen sin pie, que se dibuja como siempre. */
    private readonly thumb: Thumb | null,
    /** Range of the whole `![…](…)`, so its title can be rewritten. */
    private readonly from: number,
    private readonly to: number,
  ) { super(); }

  toDOM(view: EditorView) {
    const label = view.state.facet(imageLabels);
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-img";
    img.title = label.selectPath;
    const select = (e: Event) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.hrefFrom, head: this.hrefTo }, scrollIntoView: true });
      view.focus();
    };
    img.addEventListener("mousedown", select);

    const wrap = document.createElement("span");
    wrap.className = "cm-imgwrap";

    /*
     * The layout bar. Same shape as the table menu a few classes up, and for
     * the same reason: the markdown these buttons write is discoverable in the
     * formatting help, but nobody discovers a caption directive by guessing
     * that a quoted string after the path is where layout lives.
     */
    const bar = document.createElement("span");
    bar.className = "cm-imgbar";
    const side = this.thumb?.side ?? null;
    const button = (label: string, title: string, on: boolean, apply: (t: Thumb | null) => Thumb | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      if (on) b.className = "on";
      // mousedown, not click: CodeMirror moves the selection on mousedown, and
      // a caret landing inside the image range re-renders the widget out from
      // under the click that was about to fire.
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        rewriteImage(view, this.from, this.to, apply);
        view.focus();
      });
      bar.appendChild(b);
    };
    // A plain block image has no title at all; giving it one is what turns it
    // into a thumbnail, so each button has to be able to create the thumb.
    const asThumb = (s: Thumb["side"]) => (t: Thumb | null): Thumb =>
      ({ caption: t?.caption ?? "", width: t?.width, side: s });
    button("⇤", label.floatLeft, side === "left", asThumb("left"));
    button("⇥", label.floatRight, side === "right", asThumb("right"));
    button("⬍", label.fullWidth, side === "none", asThumb("none"));
    button("▢", label.plain, side === null, () => null);

    if (!this.thumb) {
      wrap.appendChild(img);
      wrap.appendChild(bar);
      return wrap;
    }

    const fig = document.createElement("figure");
    fig.className = `cm-thumb cm-thumb-${this.thumb.side}`;
    if (this.thumb.width) fig.style.width = `${this.thumb.width}px`;
    fig.appendChild(img);

    /*
     * The caption is edited in place, exactly like a table cell: the widget
     * that HIDES a piece of markdown owes the user a way to change it, and a
     * figcaption you can type into is the shortest one. It writes back on blur
     * and on Enter, never on every keystroke — a dispatch per character would
     * rebuild the widget and take the caret with it.
     */
    const cap = document.createElement("figcaption");
    cap.className = "cm-thumbcap";
    cap.contentEditable = "true";
    cap.spellcheck = false;
    cap.textContent = this.thumb.caption;
    if (!this.thumb.caption) cap.dataset.placeholder = label.captionPlaceholder;
    const commit = () => {
      const text = (cap.textContent ?? "").trim();
      if (text === this.thumb!.caption) return;
      rewriteImage(view, this.from, this.to, (t) => ({ ...(t ?? { side: "right" }), caption: text }));
    };
    /*
     * ⚠ The mousedown must not reach CodeMirror, and this is not a nicety.
     *
     * CodeMirror moves the document selection on mousedown anywhere in its
     * content. A selection change rebuilds this widget, and if anything the
     * widget renders depends on the selection, the rebuild swaps out the very
     * figcaption the browser was about to focus — the click lands, the caret
     * never arrives, and the next keystroke goes to the document. Keeping the
     * event here means `eq()` sees no change and CodeMirror reuses this node.
     */
    cap.addEventListener("mousedown", (e) => e.stopPropagation());
    cap.addEventListener("blur", commit);
    cap.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); cap.blur(); }
      if (e.key === "Escape") { cap.textContent = this.thumb!.caption; cap.blur(); }
      e.stopPropagation();
    });
    fig.appendChild(cap);
    fig.appendChild(bar);
    wrap.appendChild(fig);
    return wrap;
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.hrefFrom === this.hrefFrom && o.hrefTo === this.hrefTo
      && o.from === this.from && o.to === this.to
      && JSON.stringify(o.thumb) === JSON.stringify(this.thumb);
  }
  ignoreEvent() { return false; }
}

/** HTML5 video and iframe embeds stay visual while their one-line HTML remains portable. */
class VideoWidget extends WidgetType {
  constructor(private readonly kind: "video" | "iframe", private readonly src: string) { super(); }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-videowrap";
    if (this.kind === "video") {
      const video = document.createElement("video");
      video.src = this.src; video.controls = true; video.preload = "metadata";
      wrap.appendChild(video);
    } else {
      const frame = document.createElement("iframe");
      frame.src = this.src; frame.loading = "lazy"; frame.allowFullscreen = true;
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
      wrap.appendChild(frame);
    }
    return wrap;
  }
  eq(other: VideoWidget) { return other.kind === this.kind && other.src === this.src; }
  ignoreEvent() { return true; }
}

const PROV_RE = /<!--\s*(\/?)(ai|human)\s*-->/g;
const TASK_RE = /^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\]/;

/**
 * A list item, and how deeply it is nested.
 *
 * Markdown expresses nesting as leading whitespace, and whitespace in a
 * proportional font is nearly invisible: two spaces of indentation moved a
 * nested bullet about seven pixels, which is what "the dash does not indent"
 * meant (issues #14 and #15). The editor was showing the SOURCE of a list and
 * calling it a list.
 *
 * Depth is counted in units of two spaces, with a tab worth one unit, because
 * that is what `indentLines` in editorCommands.ts inserts and removes. Reading
 * the depth from something other than what the indent command writes would let
 * a Tab press change the text without changing what is on screen.
 */
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/;

/** A quoted line, including nested `> >`. */
const QUOTE_RE = /^[ \t]*((?:>[ \t]?)+)/;

/** How many nesting steps a run of leading whitespace is worth. */
function indentDepth(indent: string): number {
  let columns = 0;
  for (const ch of indent) columns += ch === "\t" ? 2 : 1;
  return Math.floor(columns / 2);
}
// El tercer grupo es el `title` de markdown, que aquí hace de pie de foto.
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const VIDEO_RE = /<(iframe|video)\b[^>]*\bsrc="([^"]+)"[^>]*><\/\1>/gi;
const INLINE_HTML_TAG_RE = /<(\/?)\s*(u|span|mark|sup|sub)(?:\s+class="(summa-(?:text|highlight)-[a-z]+)")?\s*>/gi;

function build(view: EditorView): { deco: DecorationSet; atomic: DecorationSet } {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const resolve = view.state.facet(linkResolver);
  const showFrontmatter = view.state.facet(frontmatterVisible);

  const activeFrom = doc.lineAt(sel.from).from;
  const activeTo = doc.lineAt(sel.to).to;
  const isActive = (pos: number) => pos >= activeFrom && pos <= activeTo;

  /**
   * Revelar la sintaxis del elemento bajo el cursor, no la de toda la línea.
   *
   * Con el criterio de línea, poner el caret en cualquier parte de una viñeta
   * con enlaces mostraba de golpe los `**`, los corchetes y las rutas
   * completas: la línea pasaba de ~20 a ~120 caracteres, reflowaba, y el caret
   * terminaba visualmente en otro lugar. De ahí la sensación de que moverse a
   * la izquierda mueve a la derecha, y de que la selección se comporta raro.
   */
  // `atomic` marca los rangos que se ocultan (Decoration.replace). Se exponen
  // aparte porque el cursor no debe poder entrar en ellos: al no ser atómicos,
  // moverse por una línea con enlaces recorría carácter a carácter el texto
  // invisible de "](../ruta/larga.md)" — el caret parecía no moverse y luego
  // saltaba, y la selección abarcaba cosas que no se ven.
  interface Item { from: number; to: number; deco: Decoration; atomic?: boolean }
  const items: Item[] = [];

  // Frontmatter is configuration, not prose. Track its exact range both to
  // hide it by default and to stop its `---` delimiters being rendered as HRs.
  let fmFrom = -1, fmTo = -1;
  if (doc.lines > 0 && doc.line(1).text.trim() === "---") {
    fmFrom = doc.line(1).from;
    for (let i = 2; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim() === "---") { fmTo = line.to; break; }
    }
    if (showFrontmatter) {
      items.push({ from: doc.line(1).from, to: doc.line(1).from, deco: Decoration.line({ class: "cm-fm cm-fm-start" }) });
      for (let i = 2; i <= doc.lines; i++) {
        const line = doc.line(i);
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-fm" }) });
        if (line.text.trim() === "---") break;
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        if (!showFrontmatter && fmFrom >= 0 && node.from >= fmFrom && node.to <= fmTo) return false;
        if (node.name === "HorizontalRule") {
          if (fmFrom >= 0 && node.from >= fmFrom && node.to <= fmTo) return false;
          items.push({
            from: node.from, to: node.to,
            deco: Decoration.replace({ widget: new HorizontalRuleWidget(node.from) }),
            atomic: true,
          });
          return false;
        }
        const cls = STYLED[node.name];
        if (cls) items.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: cls }) });
        if (node.name === "Table") return false;   // handled by tableField below
        // `URL` también es el nodo que Lezer asigna a una URL desnuda. Solo
        // debe ocultarse cuando es el destino de `[texto](url)`; dentro de un
        // párrafo o un `<autolink>` es el texto visible del enlace. Ocultarlo
        // siempre hacía que pegar `https://…` pareciera no haber hecho nada.
        const hiddenLinkDestination = node.name === "URL" && node.node.parent?.name === "Link";
        if ((MARKS.has(node.name) || hiddenLinkDestination) && node.to > node.from) {
          items.push({ from: node.from, to: node.to, deco: Decoration.replace({}), atomic: true });
        }
      },
    });

    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);
      if (!showFrontmatter && fmFrom >= 0 && line.from >= fmFrom && line.to <= fmTo) continue;

      const stack: { tag: string; contentFrom: number; cls: string }[] = [];
      for (const html of line.text.matchAll(INLINE_HTML_TAG_RE)) {
        const tag = html[2].toLowerCase();
        const start = line.from + html.index!, end = start + html[0].length;
        if (!html[1]) {
          const cls = tag === "u" ? "cm-underline" : tag === "sup" ? "cm-sup" : tag === "sub" ? "cm-sub"
            : tag === "mark" ? `cm-${html[3] ?? "summa-highlight-yellow"}` : html[3] ? `cm-${html[3]}` : "";
          if (!cls) continue;
          items.push({ from: start, to: end, deco: Decoration.replace({}), atomic: true });
          stack.push({ tag, contentFrom: end, cls });
        } else {
          let open = -1;
          for (let index = stack.length - 1; index >= 0; index--) {
            if (stack[index].tag === tag) { open = index; break; }
          }
          if (open >= 0) {
            const entry = stack[open]; stack.splice(open, 1);
            items.push({ from: start, to: end, deco: Decoration.replace({}), atomic: true });
            if (entry.contentFrom < start) items.push({ from: entry.contentFrom, to: start, deco: Decoration.mark({ class: entry.cls }) });
          }
        }
      }

      /*
       * Quotes and lists are BLOCK shapes, and a block shape is a property of
       * the line, not of a span inside it.
       *
       * Both were styled as marks only — a quote got italic grey text and a
       * list got nothing at all — so with their markers hidden a quote was
       * indistinguishable from emphasised prose (issue #11) and a list was
       * indistinguishable from lines that happen to start with a dash
       * (issues #14, #15). The rule that decides the shape is the same one the
       * markdown parser uses, so it is read off the line text rather than off
       * the syntax tree: `> ` and `- ` are exactly what the user typed.
       */
      const quoted = QUOTE_RE.exec(line.text);
      if (quoted) {
        // Nesting is the count of `>`, so `> > x` draws two bars.
        const depth = (quoted[1].match(/>/g) ?? []).length;
        items.push({
          from: line.from, to: line.from,
          deco: Decoration.line({ class: "cm-quoteline", attributes: { style: `--cm-depth:${depth}` } }),
        });
      }

      const listed = !quoted && LIST_RE.exec(line.text);
      if (listed) {
        const depth = indentDepth(listed[1]);
        /*
         * The literal indentation is hidden and replaced by padding on the
         * line. Keeping both would indent twice, and the padding is what makes
         * a nesting step visible: two spaces of a proportional font are not.
         *
         * Atomic, so one arrow press crosses it. A non-atomic invisible range
         * is the failure this file already documents twice — the caret appears
         * not to move, then jumps.
         */
        if (listed[1]) {
          items.push({
            from: line.from, to: line.from + listed[1].length,
            deco: Decoration.replace({}), atomic: true,
          });
        }
        items.push({
          from: line.from, to: line.from,
          // The hanging indent belongs to the line too: without it a bullet
          // that wraps puts its second line under the marker instead of under
          // the text, which reads as a new item.
          deco: Decoration.line({ class: "cm-listline", attributes: { style: `--cm-depth:${depth}` } }),
        });
      }

      // Checkboxes: always interactive, even on the active line — ticking one
      // is a deliberate edit, not a formatting reveal.
      const m = TASK_RE.exec(line.text);
      if (m) {
        const [, indent, bullet, gap, state] = m;
        // Hide the list bullet: the checkbox already reads as a list item.
        // Nesting is drawn by the `cm-listline` decoration above, which every
        // list line gets, tasks included.
        const bulletFrom = line.from + indent.length;
        const bulletTo = bulletFrom + bullet.length + gap.length;
        items.push({ from: bulletFrom, to: bulletTo, deco: Decoration.replace({}), atomic: true });

        const boxStart = bulletTo;                     // at "["
        items.push({
          from: boxStart, to: boxStart + 3,
          deco: Decoration.replace({ widget: new CheckWidget(state.toLowerCase() === "x", boxStart + 1) }),
        });
        if (state.toLowerCase() === "x") {
          items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: "cm-task-done" }) });
        }
      }

      // Images stay visual. M↓ exposes their source when it is needed.
      for (const im of line.text.matchAll(IMG_RE)) {
        const s = line.from + im.index!;
        const e = s + im[0].length;
        const url = resolve(decodeURIComponent(im[2]));
        if (!url) continue;
        const hrefFrom = s + im[0].lastIndexOf("(" + im[2]) + 1;
        items.push({
          from: s, to: e,
          deco: Decoration.replace({
            widget: new ImageWidget(url, im[1], hrefFrom, hrefFrom + im[2].length, parseCaption(im[3]), s, e),
          }),
        });
      }

      // Video/embed HTML is deliberately restricted to the two generated,
      // single-line forms. Arbitrary HTML is never mounted by the preview.
      for (const media of line.text.matchAll(VIDEO_RE)) {
        const s = line.from + media.index!, e = s + media[0].length;
        const raw = media[2];
        const src = /^https?:\/\//i.test(raw) ? raw : resolve(decodeURIComponent(raw));
        if (!src) continue;
        items.push({
          from: s, to: e,
          deco: Decoration.replace({ widget: new VideoWidget(media[1].toLowerCase() as "video" | "iframe", src) }),
          atomic: true,
        });
      }

      // Provenance markers -> chips.
      for (const pm of line.text.matchAll(PROV_RE)) {
        const s = line.from + pm.index!;
        const e = s + pm[0].length;
        if (isActive(s)) continue;
        items.push({
          from: s, to: e,
          deco: Decoration.replace({
            widget: new ProvWidget(pm[1] === "/" ? `⟨/${pm[2]}⟩` : `⟨${pm[2]}⟩`, pm[2]),
          }),
          atomic: true,
        });
      }
    }
  }

  /*
   * `RangeSetBuilder` no acepta simplemente orden por `from`/`to`: cuando dos
   * decoraciones empiezan en el mismo punto exige además el `startSide`
   * interno de cada Decoration. Esto ocurre con frecuencia al editar una
   * línea que combina Decoration.line, marks y replacements. Delegar el sort
   * a CodeMirror evita reproducir parcialmente ese comparador y cubre también
   * widgets con prioridades distintas.
   */
  return {
    deco: Decoration.set(items.map((it) => it.deco.range(it.from, it.to)), true),
    atomic: Decoration.set(items
      .filter((it) => it.atomic && it.to > it.from)
      .map((it) => it.deco.range(it.from, it.to)), true),
  };
}

/**
 * Tables must live in a StateField, not the ViewPlugin: CodeMirror refuses
 * decorations that replace line breaks when they come from a plugin
 * ("Decorations that replace line breaks may not be specified via plugins").
 */
function buildTables(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const rows: { from: number; to: number; deco: Decoration }[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      let from = node.from;
      let original = state.sliceDoc(node.from, node.to);
      let widths: number[] = [], heights: number[] = [], hasSizing = false;
      const line = state.doc.lineAt(node.from);
      if (line.number > 1) {
        const previous = state.doc.line(line.number - 1);
        const match = /^<!-- summa-table (\{.*\}) -->$/.exec(previous.text.trim());
        if (match) {
          try {
            const parsed = JSON.parse(match[1]) as { widths?: number[]; heights?: number[] };
            widths = parsed.widths?.filter((value) => Number.isFinite(value) && value >= 40) ?? [];
            heights = parsed.heights?.filter((value) => Number.isFinite(value) && value >= 20) ?? [];
            hasSizing = true; from = previous.from; original = state.sliceDoc(from, node.to);
          } catch { /* malformed presentation metadata: render natural size */ }
        }
      }
      rows.push({
        from, to: node.to,
        deco: Decoration.replace({
          widget: new TableWidget(state.sliceDoc(node.from, node.to), from, node.to, original, widths, heights, hasSizing),
          block: true,
        }),
      });
      return false;
    },
  });

  rows.sort((a, b2) => a.from - b2.from);
  for (const r of rows) b.add(r.from, r.to, r.deco);
  return b.finish();
}

function buildFrontmatter(state: EditorState): DecorationSet {
  if (state.facet(frontmatterVisible) || state.doc.lines < 2 || state.doc.line(1).text.trim() !== "---") {
    return Decoration.none;
  }
  for (let i = 2; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (line.text.trim() === "---") {
      return Decoration.set([
        Decoration.replace({ block: true }).range(state.doc.line(1).from, line.to),
      ]);
    }
  }
  return Decoration.none;
}

/** Multi-line replacement must come from a StateField, not a ViewPlugin. */
export const frontmatterField = StateField.define<DecorationSet>({
  create: buildFrontmatter,
  update(value, tr) {
    if (tr.docChanged || tr.startState.facet(frontmatterVisible) !== tr.state.facet(frontmatterVisible)) {
      return buildFrontmatter(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

export const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildTables(tr.state);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) { const r = build(view); this.decorations = r.deco; this.atomic = r.atomic; }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged
          || u.startState.facet(frontmatterVisible) !== u.state.facet(frontmatterVisible)) {
        const r = build(u.view);
        this.decorations = r.deco; this.atomic = r.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Sin esto el cursor se mete dentro de la sintaxis oculta.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
);

/**
 * Links must still navigate now that the editor is the only view.
 * Cmd/Ctrl+click follows a link; a plain click just places the cursor, so
 * editing link text stays possible.
 */
export const linkClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    for (const m of line.text.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (col >= m.index! && col <= m.index! + m[0].length) {
        const href = decodeURIComponent(m[2]);
        const url = view.state.facet(linkResolver)(href);
        if (url) { event.preventDefault(); view.state.facet(navigate)(url, m[1]); return true; }
      }
    }
    return false;
  },
});

export const livePreviewTheme = EditorView.theme({
  "&": { fontSize: "14.2px", backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-content": {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    boxSizing: "border-box", width: "100%", minWidth: "0",
    lineHeight: "1.6", padding: "4px 0 40px", caretColor: "var(--fg)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-selectionBackground": { background: "var(--sel)" },
  "&.cm-focused .cm-selectionBackground": { background: "var(--sel)" },
  ".cm-selectionLayer": { zIndex: "3", pointerEvents: "none" },
  ".cm-cursorLayer": { zIndex: "4", pointerEvents: "none" },
  ".cm-h1": { fontFamily: "Georgia, serif", fontSize: "1.85em", lineHeight: "1.25" },
  ".cm-h2": { fontFamily: "Georgia, serif", fontSize: "1.45em", lineHeight: "1.3" },
  ".cm-h3": { fontWeight: "700", fontSize: "1.15em" },
  ".cm-h4": { fontWeight: "700" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-underline": { textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-sup": { verticalAlign: "super", fontSize: ".75em" },
  ".cm-sub": { verticalAlign: "sub", fontSize: ".75em" },
  ".cm-summa-text-red": { color: "#c7463b" },
  ".cm-summa-text-orange": { color: "#c66a18" },
  ".cm-summa-text-green": { color: "#31834a" },
  ".cm-summa-text-blue": { color: "#3973c6" },
  ".cm-summa-text-purple": { color: "#8054b3" },
  ".cm-summa-text-muted": { color: "var(--muted)" },
  ".cm-summa-highlight-yellow": { backgroundColor: "#f7df72", color: "#29251a" },
  ".cm-summa-highlight-orange": { backgroundColor: "#f4bd83", color: "#322116" },
  ".cm-summa-highlight-green": { backgroundColor: "#9fd9ae", color: "#17331f" },
  ".cm-summa-highlight-blue": { backgroundColor: "#a9cef4", color: "#172b40" },
  ".cm-summa-highlight-purple": { backgroundColor: "#cfb5eb", color: "#2c1d3a" },
  ".cm-summa-highlight-gray": { backgroundColor: "var(--line-soft)" },
  ".cm-code": {
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.92em",
    background: "var(--panel-grey)", padding: "1px 3px", borderRadius: "2px",
  },
  ".cm-fence": { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.9em" },
  ".cm-link": { color: "var(--link)", cursor: "pointer" },
  ".cm-quote": { color: "var(--muted)", fontStyle: "italic" },
  /*
   * The quote bar, drawn on the LINE.
   *
   * `.cm-line` already carries `padding: 0 6px`, so the border sits at the very
   * left of the editor and the text is pushed clear of it. One bar per level of
   * `>`, which is why the padding is a multiple of the depth: nested quotes are
   * rare but they used to be invisible, exactly like the first level was.
   */
  ".cm-quoteline": {
    borderLeft: "3px solid var(--line)",
    paddingLeft: "calc(11px + var(--cm-depth, 1) * 9px)",
  },
  /*
   * A list line: one indentation step per nesting level, plus a hanging indent
   * so a wrapped item lines up under its own text and not under its marker.
   *
   * The literal leading whitespace is hidden by the decoration that adds this
   * class, so the padding here is the ONLY thing expressing nesting — change
   * one without the other and a nested item either loses its indentation or
   * gets it twice.
   */
  ".cm-listline": {
    paddingLeft: "calc(6px + var(--cm-depth, 0) * 1.6em + 1.5em)",
    textIndent: "-1.5em",
  },
  ".cm-task": { marginRight: "6px", verticalAlign: "middle", cursor: "pointer" },
  ".cm-task-done": { color: "var(--muted)", textDecoration: "line-through" },
  // Mismo motivo que .cm-tablewrap: el margen de un widget no entra en la altura
  // que mide CodeMirror.
  ".cm-img": { maxWidth: "100%", height: "auto", display: "block", padding: "6px 0", borderRadius: "3px" },
  /*
   * Miniatura tipo Wikipedia. El marco lo pone la <figure>, no la <img>, para
   * que el pie quede dentro del recuadro y a la misma anchura que la foto.
   *
   * Aquí sí hace falta margen —una imagen flotada pegada al texto es
   * ilegible—, y va en la figure, que está fuera del flujo: la advertencia de
   * arriba aplica a los widgets que CodeMirror mide para el mapa de alturas,
   * y un elemento flotado no aporta altura a la línea de todos modos.
   */
  ".cm-thumb": {
    boxSizing: "border-box", width: "300px", maxWidth: "46%",
    border: "1px solid var(--line-soft)", background: "var(--panel-grey)",
    padding: "4px", borderRadius: "2px", fontSize: "12.5px", lineHeight: "1.45",
  },
  ".cm-thumb .cm-img": { padding: "0", width: "100%", borderRadius: "0" },
  ".cm-thumbcap": { color: "var(--muted)", padding: "5px 3px 2px", outline: "none", cursor: "text" },
  // An empty caption has nothing to click on, and an image whose caption you
  // cannot see is an image whose caption you cannot start writing.
  ".cm-thumbcap:empty::before": { content: "attr(data-placeholder)", opacity: ".55" },
  /*
   * The wrapper exists to hang the layout bar off, and it has to be relative
   * for the absolute bar to land on the image — but it must not become a box of
   * its own: `display: contents` would drop it from the layout entirely and
   * take the positioning context with it, so it is inline-block for a plain
   * image and lets the floated figure keep its own geometry.
   */
  ".cm-imgwrap": { position: "relative", display: "inline-block", maxWidth: "100%" },
  ".cm-imgwrap .cm-thumb": { margin: "0" },
  ".cm-imgbar": {
    display: "none", position: "absolute", zIndex: "20", top: "8px", right: "8px",
    gap: "2px", padding: "3px", border: "1px solid var(--line)", background: "var(--bg)",
    boxShadow: "0 6px 22px rgba(0,0,0,.18)", borderRadius: "var(--control-radius)",
  },
  ".cm-imgwrap:hover .cm-imgbar": { display: "flex" },
  ".cm-imgbar button": {
    display: "grid", placeItems: "center", font: "inherit", fontSize: "13px", lineHeight: "1",
    width: "26px", height: "24px", padding: "0", border: "0", background: "transparent",
    color: "var(--fg)", cursor: "pointer", borderRadius: "var(--control-radius)",
  },
  ".cm-imgbar button:hover": { background: "var(--panel-grey)" },
  ".cm-imgbar button.on": { background: "color-mix(in srgb, var(--link) 16%, transparent)", color: "var(--link)" },
  ".cm-thumb-right": { float: "right", margin: "4px 0 8px 16px", clear: "right" },
  ".cm-thumb-left": { float: "left", margin: "4px 16px 8px 0", clear: "left" },
  // `[ancho]`: sin flotar, centrada y a todo lo ancho — para diagramas y
  // capturas donde envolver el texto alrededor no aporta nada.
  ".cm-thumb-none": { float: "none", width: "100%", maxWidth: "100%", margin: "0 auto" },
  ".cm-videowrap": { boxSizing: "border-box", width: "100%", maxWidth: "100%", aspectRatio: "16 / 9", padding: "6px 0" },
  ".cm-videowrap video, .cm-videowrap iframe": { display: "block", width: "100%", height: "100%", border: "1px solid var(--line-soft)", borderRadius: "var(--control-radius)", background: "#000" },
  // Padding, nunca margin. CodeMirror mide el widget con getBoundingClientRect,
  // que excluye los márgenes propios del nodo — pero el DOM sí los aplica al
  // colocar lo que viene después. Cada tabla dejaba al mapa de alturas 16px
  // corto; con dos tablas el desfase superaba el alto de una línea y posAtCoords
  // devolvía la línea equivocada: la flecha arriba saltaba decenas de renglones
  // y la selección abarcaba texto que no era el señalado.
  ".cm-tablewrap": { position: "relative", boxSizing: "border-box", width: "100%", maxWidth: "100%", overflow: "visible", padding: "8px 0" },
  ".cm-tablewrap.resizing": { cursor: "col-resize", userSelect: "none" },
  // Aísla el editor visual de `article table`, que usa display:block y
  // overflow:auto para tablas HTML renderizadas. Aquí rompería tanto el ancho
  // disponible como las mediciones durante el drag.
  ".cm-table": { display: "table", overflow: "visible", margin: "0", boxSizing: "border-box", borderCollapse: "collapse", fontSize: "13px", width: "100%", maxWidth: "100%", tableLayout: "fixed" },
  ".cm-table th, .cm-table td": {
    position: "relative", border: "1px solid var(--line-soft)", padding: "5px 9px", textAlign: "left",
  },
  ".cm-table th": { background: "var(--panel-grey)", fontWeight: "700" },
  ".cm-table tr.cm-table-active > td, .cm-table tr.cm-table-active > th": { background: "color-mix(in srgb, var(--link) 7%, var(--bg))" },
  ".cm-table td.cm-table-active, .cm-table th.cm-table-active": { boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--link) 65%, transparent)" },
  ".cm-table td[contenteditable], .cm-table th[contenteditable]": { minWidth: "80px", maxWidth: "100%", overflowWrap: "anywhere", outline: "none", cursor: "text", verticalAlign: "top" },
  ".cm-colresize": { position: "absolute", zIndex: "4", top: "0", right: "-5px", width: "10px", height: "100%", cursor: "col-resize", userSelect: "none", touchAction: "none" },
  ".cm-colresize:hover::after": { content: "''", position: "absolute", left: "4px", top: "0", bottom: "0", width: "2px", background: "var(--link)" },
  ".cm-rowresize": { position: "absolute", zIndex: "3", left: "0", width: "100%", height: "10px", cursor: "row-resize", userSelect: "none", touchAction: "none" },
  ".cm-rowresize:hover::after": { content: "''", position: "absolute", left: "0", right: "0", top: "4px", height: "2px", background: "var(--link)" },
  ".cm-tablemenu": { display: "none", position: "absolute", zIndex: "20", gridAutoFlow: "column", alignItems: "center", gap: "2px", padding: "5px", border: "1px solid var(--line)", background: "var(--bg)", boxShadow: "0 6px 22px rgba(0,0,0,.18)", borderRadius: "var(--control-radius)" },
  ".cm-tablemenu.open": { display: "grid" },
  ".cm-tablemenu button": { display: "grid", placeItems: "center", font: "inherit", fontSize: "14px", lineHeight: "1", width: "30px", height: "28px", padding: "0", border: "0", background: "transparent", color: "var(--fg)", cursor: "pointer", borderRadius: "var(--control-radius)" },
  ".cm-tablemenu button:hover": { background: "var(--panel-grey)" },
  ".cm-tablemenu button.danger": { color: "var(--danger, #c93650)" },
  ".cm-tablemenu-separator": { width: "1px", height: "20px", margin: "0 3px", background: "var(--line-soft)" },
  ".cm-hrwrap": { boxSizing: "border-box", display: "block", width: "100%", padding: "13px 0" },
  ".cm-hrwrap hr": { margin: "0", border: "0", borderTop: "1px solid var(--fg)", opacity: ".32", height: "0" },
  ".cm-prov": {
    fontSize: "10px", padding: "1px 5px", borderRadius: "8px",
    fontFamily: "ui-monospace, Menlo, monospace", verticalAlign: "middle",
  },
  ".cm-prov-ai": { background: "var(--ai-bg)", color: "var(--ai-line)", border: "1px solid var(--ai-line)" },
  ".cm-prov-human": { background: "var(--human-bg)", color: "var(--human-line)", border: "1px solid var(--human-line)" },
  ".cm-fm": {
    fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11.5px",
    color: "var(--muted)", background: "var(--panel-grey)",
    borderLeft: "3px solid var(--line-soft)", paddingLeft: "8px",
  },
  ".cm-fm-start": { paddingTop: "4px" },
});
