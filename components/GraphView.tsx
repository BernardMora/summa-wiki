"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabs } from "./Tabs.tsx";
import { useT } from "./I18n";

interface Node {
  id: string; title: string; type: string; bundle: string; pillar: string;
  words: number; degree: number; isIndex: boolean; categories: string[];
  x: number; y: number; vx: number; vy: number;
  /** Set once dragged: the node keeps the position it was dropped at. */
  pinned?: boolean;
}
interface Edge { s: string; t: string; }
interface Category { id: string; label: string; total: number; }

const COLOR: Record<string, string> = {
  knowledge: "#3366cc", project: "#d97706", area: "#059669",
  moc: "#7c3aed", journal: "#64748b", source: "#be185d",
  connection: "#0891b2", system: "#94a3b8",
};

/**
 * Force-directed graph of the wiki, drawn on canvas.
 *
 * Written by hand rather than pulling in d3: the simulation is ~40 lines and
 * this keeps the project dependency-free, which matters because the CLI runs
 * the same code with node --experimental-strip-types and no install step.
 */
export default function GraphView() {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const nodes = useRef<Node[]>([]);
  const edges = useRef<Edge[]>([]);
  const byId = useRef(new Map<string, Node>());
  const adj = useRef(new Map<string, Set<string>>());
  const raf = useRef(0);
  const view = useRef({ x: 0, y: 0, k: 1 });
  /**
   * `moved` is what separates a drag from a click. Without it every drag also
   * fired onClick on release, which opened the note and tore the canvas down
   * before the drag was ever visible.
   */
  const drag = useRef<{
    node: Node | null; panX: number; panY: number; panning: boolean;
    downX: number; downY: number; moved: boolean;
  }>({ node: null, panX: 0, panY: 0, panning: false, downX: 0, downY: 0, moved: false });
  const hover = useRef<Node | null>(null);
  /**
   * Nodo enfocado. El clic dejó de abrir la nota: ahora fija el vecindario y
   * acerca la cámara, de modo que el grafo se puede recorrer saltando de un
   * nodo a otro. Abrir la nota pasó a ⌘clic y al botón del panel.
   */
  const focus = useRef<Node | null>(null);
  /** Destino de cámara al que se interpola; null cuando no hay animación. */
  const camera = useRef<{ x: number; y: number; k: number } | null>(null);
  /** Simulation temperature. A ref so dragging can reheat it from outside. */
  const alpha = useRef(1);
  const DRAG_PX = 4;

  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ n: 0, e: 0 });
  const [bundle, setBundle] = useState("all");
  /** Los bundles reales del vault. Estaban escritos a mano en el `<select>`. */
  const [bundles, setBundles] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const [hideIndexes, setHideIndexes] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overNode, setOverNode] = useState(false);
  const [pinned, setPinned] = useState(0);
  const [focused, setFocused] = useState<Node | null>(null);
  const tabs = useTabs();

  /**
   * Alto del lienzo: exactamente lo que queda de pantalla bajo su borde
   * superior.
   *
   * Antes era `calc(100vh - 230px)` en CSS, y esos 230 px eran una estimación
   * de lo que hay encima —masthead, título, la línea de ayuda, la barra de
   * controles—. Cuando la leyenda envuelve a dos renglones, o el masthead mide
   * otra cosa, la cuenta se queda corta: el lienzo sobresale, la página gana
   * scroll vertical, y lo primero que se pierde por abajo es el panel del nodo
   * enfocado —el que trae «Abrir nota»— porque va anclado al borde inferior del
   * lienzo. La función que uno acaba de invocar es justo la que desaparece.
   *
   * Medir no puede desviarse: `getBoundingClientRect().top` ya lleva dentro
   * todo lo que haya encima, mida lo que mida.
   */
  useEffect(() => {
    const fit = () => {
      const cv = canvas.current;
      if (!cv) return;
      const gap = 16;   // aire bajo el lienzo, para que no toque el borde
      const h = Math.max(320, window.innerHeight - cv.getBoundingClientRect().top - gap);
      // Solo si cambia de verdad: escribir el mismo valor dispara el
      // ResizeObserver del dibujo sin que nada se haya movido.
      if (Math.abs(parseFloat(cv.style.height || "0") - h) > 1) cv.style.height = `${h}px`;
    };
    // Diferido un frame: en el primer render la barra de controles todavía no
    // sabe si su leyenda cabe en un renglón o en dos.
    const id = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", fit); };
  }, []);

  // ---------------------------------------------------------------- data
  const load = useCallback(async () => {
    const r = await fetch("/api/graph");
    const d = await r.json();
    setBundles(d.bundles ?? []);
    setCategories(d.categories ?? []);
    setTypes(d.types ?? []);
    const keep = (d.nodes as Node[]).filter(
      (n) => (bundle === "all" || n.bundle === bundle)
        && (category === "all" || n.categories.includes(category))
        && !hiddenTypes.has(n.type)
        && (!hideIndexes || !n.isIndex),
    );
    const ids = new Set(keep.map((n) => n.id));
    const es = (d.edges as Edge[]).filter((e) => ids.has(e.s) && ids.has(e.t));

    // A filter can remove the focused or hovered node. Those refs belong to
    // the previous induced graph; retaining either leaves draw() asking the
    // new adjacency map for a node it cannot contain.
    focus.current = null;
    hover.current = null;
    camera.current = null;
    setFocused(null);
    setOverNode(false);

    const R = 320;
    keep.forEach((n, i) => {
      const a = (i / keep.length) * Math.PI * 2;
      n.x = Math.cos(a) * R + (Math.random() - 0.5) * 60;
      n.y = Math.sin(a) * R + (Math.random() - 0.5) * 60;
      n.vx = 0; n.vy = 0;
    });

    nodes.current = keep;
    edges.current = es;
    byId.current = new Map(keep.map((n) => [n.id, n]));
    adj.current = new Map(keep.map((n) => [n.id, new Set<string>()]));
    for (const e of es) {
      adj.current.get(e.s)!.add(e.t);
      adj.current.get(e.t)!.add(e.s);
    }
    setStats({ n: keep.length, e: es.length });
    setReady(true);
  }, [bundle, category, hiddenTypes, hideIndexes]);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------------- physics
  useEffect(() => {
    if (!ready) return;
    alpha.current = 1;

    const step = () => {
      const ns = nodes.current;
      const es = edges.current;
      if (alpha.current > 0.005) {
        // Repulsion. O(n^2) is fine at a few hundred nodes and avoids a quadtree.
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
            if (d2 > 90000) continue;                 // ignore distant pairs
            const f = 900 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
          }
        }
        // Springs.
        for (const e of es) {
          const a = byId.current.get(e.s)!, b = byId.current.get(e.t)!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = (d - 90) * 0.008;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        for (const n of ns) {
          n.vx -= n.x * 0.0016;                       // gentle pull to centre
          n.vy -= n.y * 0.0016;
          if (drag.current.node === n || n.pinned) { n.vx = 0; n.vy = 0; continue; }
          n.x += (n.vx *= 0.82) * alpha.current;
          n.y += (n.vy *= 0.82) * alpha.current;
        }
        alpha.current *= 0.995;
      }
      // Interpolación hacia el nodo enfocado. Saltar de golpe hace perder el
      // hilo de dónde estabas; el desplazamiento suave lo conserva.
      const cam = camera.current;
      if (cam) {
        const v = view.current;
        v.x += (cam.x - v.x) * 0.18;
        v.y += (cam.y - v.y) * 0.18;
        v.k += (cam.k - v.k) * 0.18;
        if (Math.abs(cam.x - v.x) < 0.5 && Math.abs(cam.y - v.y) < 0.5 && Math.abs(cam.k - v.k) < 0.005) {
          v.x = cam.x; v.y = cam.y; v.k = cam.k;
          camera.current = null;
        }
      }
      draw();
      raf.current = requestAnimationFrame(step);
    };

    const draw = () => {
      const cv = canvas.current;
      if (!cv) return;
      const ctx = cv.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const css = getComputedStyle(document.body);
      ctx.fillStyle = css.getPropertyValue("--bg") || "#fff";
      ctx.fillRect(0, 0, w, h);

      const { x: tx, y: ty, k } = view.current;
      ctx.save();
      ctx.translate(w / 2 + tx, h / 2 + ty);
      ctx.scale(k, k);

      // El foco manda sobre el hover: fijado el vecindario, pasar el ratón por
      // encima solo etiqueta, no reordena lo que está resaltado.
      const fo = focus.current;
      const hi = hover.current;
      const anchor = fo ?? hi;
      // During a filter transition the animation frame may still carry an
      // anchor from the previous graph. Missing adjacency means "no active
      // anchor", not a fatal rendering error.
      const near = anchor ? (adj.current.get(anchor.id) ?? null) : null;

      ctx.lineWidth = 0.7;
      for (const e of edges.current) {
        const a = byId.current.get(e.s)!, b = byId.current.get(e.t)!;
        const lit = anchor && (e.s === anchor.id || e.t === anchor.id);
        ctx.strokeStyle = lit ? (css.getPropertyValue("--link") || "#3366cc") : (css.getPropertyValue("--line-soft") || "#ccc");
        ctx.globalAlpha = anchor ? (lit ? 0.9 : 0.1) : 0.42;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      ctx.globalAlpha = 1;
      for (const n of nodes.current) {
        const r = 3 + Math.min(9, Math.sqrt(n.degree) * 2);
        const dim = Boolean(anchor && near && n !== anchor && !near.has(n.id));
        ctx.globalAlpha = dim ? 0.14 : 1;
        ctx.fillStyle = COLOR[n.type] ?? "#888";
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n === fo) {
          // El enfocado lleva un anillo doble para distinguirlo de sus vecinos.
          ctx.strokeStyle = css.getPropertyValue("--link") || "#3366cc"; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = css.getPropertyValue("--link") || "#3366cc"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (n === hi) { ctx.strokeStyle = css.getPropertyValue("--link") || "#3366cc"; ctx.lineWidth = 2; ctx.stroke(); }
        else if (n.pinned) {
          ctx.strokeStyle = css.getPropertyValue("--muted") || "#666";
          ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // Only the hovered node is labelled. Drawing every hub's title turned the
      // canvas into overlapping text; on hover it reads cleanly and the dimming
      // of everything else already shows the neighbourhood.
      type Rect = { x: number; y: number; w: number; h: number };
      const hits = (a: Rect, b: Rect) =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

      /**
       * Dibuja la etiqueta evitando `avoid`. Con dos nodos cercanos —el
       * enfocado y uno al que se le pasa por encima— las dos placas caían en el
       * mismo sitio y el texto quedaba ilegible, así que se prueban cuatro
       * posiciones alrededor del nodo antes de rendirse.
       */
      const label = (n: Node, strong: boolean, avoid?: Rect): Rect => {
        const r = 3 + Math.min(9, Math.sqrt(n.degree) * 2);
        ctx.font = `${strong ? 700 : 600} 12px ${css.getPropertyValue("--font-ui") || "system-ui, sans-serif"}`;
        const text = n.title;
        const tw = ctx.measureText(text).width;
        const w = tw + 8, h = 18;
        const spots: Rect[] = [
          { x: n.x + r + 1, y: n.y - 10, w, h },          // derecha
          { x: n.x - r - 1 - w, y: n.y - 10, w, h },      // izquierda
          { x: n.x - w / 2, y: n.y + r + 4, w, h },       // abajo
          { x: n.x - w / 2, y: n.y - r - 4 - h, w, h },   // arriba
        ];
        const box = spots.find((s) => !avoid || !hits(s, avoid)) ?? spots[0];

        // Placa detrás del texto para que se lea sobre aristas y nodos.
        ctx.fillStyle = css.getPropertyValue("--bg") || "#fff";
        ctx.globalAlpha = 0.94;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = strong ? (css.getPropertyValue("--link") || "#3366cc") : (css.getPropertyValue("--line-soft") || "#ccc");
        ctx.lineWidth = (strong ? 1.5 : 1) / k;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = css.getPropertyValue("--fg") || "#222";
        ctx.fillText(text, box.x + 4, box.y + 13);
        return box;
      };
      // El enfocado se etiqueta siempre y se coloca primero, porque es el ancla
      // de la exploración; el que se pasa por encima cede el sitio.
      const anchorBox = fo ? label(fo, true) : undefined;
      if (hi && hi !== fo) label(hi, false, anchorBox);
      ctx.restore();
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [ready]);

  /** Centra un nodo y acerca; null sale del modo exploración. */
  const focusNode = useCallback((n: Node | null) => {
    focus.current = n;
    setFocused(n);
    if (!n) { camera.current = null; return; }
    // Con vecindarios grandes conviene alejarse un poco, o no cabe.
    const deg = adj.current.get(n.id)?.size ?? 0;
    const k = Math.max(0.7, Math.min(1.9, 1.9 - deg * 0.045));
    camera.current = { k, x: -n.x * k, y: -n.y * k };
    alpha.current = Math.max(alpha.current, 0.05);   // repintar mientras viaja
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") focusNode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusNode]);

  // ---------------------------------------------------------------- input
  const at = (ev: React.MouseEvent) => {
    const cv = canvas.current!;
    const rect = cv.getBoundingClientRect();
    const { x: tx, y: ty, k } = view.current;
    return {
      x: (ev.clientX - rect.left - rect.width / 2 - tx) / k,
      y: (ev.clientY - rect.top - rect.height / 2 - ty) / k,
    };
  };
  const pick = (p: { x: number; y: number }) => {
    let best: Node | null = null, bd = 14 * 14;
    for (const n of nodes.current) {
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  return (
    <div className="graphwrap">
      <div className="graphbar">
        <label className="graphfilter">
          <span>{t("graph.category")}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">{t("graph.allCategories")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.total})</option>)}
          </select>
        </label>
        <label className="graphfilter">
          <span>{t("graph.origin")}</span>
          <select value={bundle} onChange={(e) => setBundle(e.target.value)}>
            <option value="all">{t("graph.wholeWiki")}</option>
            {bundles.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={hideIndexes} onChange={(e) => setHideIndexes(e.target.checked)} />
          {" "}{t("graph.hideIndexes")}
        </label>
        <button
          onClick={() => {
            for (const n of nodes.current) n.pinned = false;
            alpha.current = 0.5;                 // reheat so they settle again
            setPinned(0);
          }}
          disabled={!pinned}
          title={t("graph.releasePinned")}
        >
          Soltar fijados{pinned ? ` (${pinned})` : ""}
        </button>
        <span className="dim">{stats.n} notas · {stats.e} enlaces</span>
        <span className="graphlegend">
          {types.map((type) => (
            <button key={type} type="button" className={hiddenTypes.has(type) ? "off" : ""}
              aria-pressed={!hiddenTypes.has(type)} onClick={() => setHiddenTypes((current) => {
                const next = new Set(current);
                if (next.has(type)) next.delete(type); else next.add(type);
                return next;
              })}>
              <i style={{ background: COLOR[type] ?? "#888" }} />{type}
            </button>
          ))}
        </span>
      </div>

      {focused && (
        <div className="gfocus">
          <div>
            <strong>{focused.title}</strong>
            <span className="dim">
              {" "}· {adj.current.get(focused.id)?.size ?? 0} conexiones · {focused.type}
            </span>
          </div>
          <div className="gfocusbtns">
            <button onClick={() => tabs?.open(focused.id, focused.title, true)}>{t("graph.openNote")}</button>
            <button onClick={() => focusNode(null)}>{t("graph.exit")}</button>
          </div>
        </div>
      )}

      <canvas
        ref={canvas}
        className="graphcanvas"
        style={{ cursor: dragging ? "grabbing" : overNode ? "grab" : "default" }}
        onMouseDown={(e) => {
          const d = drag.current;
          d.downX = e.clientX; d.downY = e.clientY; d.moved = false;
          const n = pick(at(e));
          if (n) { d.node = n; setDragging(true); }
          else { d.panning = true; d.panX = e.clientX; d.panY = e.clientY; }
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          const p = at(e);
          if ((d.node || d.panning) && !d.moved &&
              Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > DRAG_PX) {
            d.moved = true;
          }
          if (d.node) {
            d.node.x = p.x; d.node.y = p.y;
            d.node.vx = 0; d.node.vy = 0;
            // Pin it. Without this the reheated springs pull the node back and
            // it is no longer under the cursor when you let go.
            d.node.pinned = true;
            // Reheat so neighbours follow instead of the graph sitting frozen.
            alpha.current = Math.max(alpha.current, 0.12);
            return;
          }
          if (d.panning) {
            view.current.x += e.clientX - d.panX;
            view.current.y += e.clientY - d.panY;
            d.panX = e.clientX; d.panY = e.clientY;
            return;
          }
          const n = pick(p);
          hover.current = n;
          setOverNode(Boolean(n));
        }}
        onMouseUp={() => {
          if (drag.current.node?.pinned) setPinned(nodes.current.filter((n) => n.pinned).length);
          drag.current.node = null; drag.current.panning = false; setDragging(false);
        }}
        onMouseLeave={() => {
          drag.current.node = null; drag.current.panning = false; drag.current.moved = false;
          hover.current = null; setDragging(false); setOverNode(false);
        }}
        onClick={(e) => {
          // A drag is not a click. Without this the node opened on release and
          // the canvas unmounted mid-drag.
          if (drag.current.moved) { drag.current.moved = false; return; }
          const n = pick(at(e));
          // ⌘clic sigue abriendo la nota; el clic simple explora.
          if (n && (e.metaKey || e.ctrlKey)) { tabs?.open(n.id, n.title, true); return; }
          focusNode(n);                       // clic en vacío sale del modo
        }}
        onWheel={(e) => {
          // Convención de macOS: el pellizco del trackpad llega como `wheel`
          // con ctrlKey, y el desplazamiento de dos dedos como wheel normal.
          // Antes todo hacía zoom, así que desplazarse acercaba sin querer.
          camera.current = null;                 // cualquier gesto cancela el viaje
          if (e.ctrlKey) {
            const b = canvas.current!.getBoundingClientRect();
            const mx = e.clientX - b.left - b.width / 2;
            const my = e.clientY - b.top - b.height / 2;
            const v = view.current;
            const k = Math.min(4, Math.max(0.15, v.k * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
            // Se acerca hacia el puntero, no hacia el centro.
            v.x = mx - (mx - v.x) * (k / v.k);
            v.y = my - (my - v.y) * (k / v.k);
            v.k = k;
          } else {
            view.current.x -= e.deltaX;
            view.current.y -= e.deltaY;
          }
        }}
      />
    </div>
  );
}
