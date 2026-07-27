"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabs } from "./Tabs.tsx";

interface Node {
  id: string; title: string; type: string; bundle: string; pillar: string;
  words: number; degree: number; isIndex: boolean;
  x: number; y: number; vx: number; vy: number;
  /** Set once dragged: the node keeps the position it was dropped at. */
  pinned?: boolean;
}
interface Edge { s: string; t: string; }

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
  /** Simulation temperature. A ref so dragging can reheat it from outside. */
  const alpha = useRef(1);
  const DRAG_PX = 4;

  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ n: 0, e: 0 });
  const [bundle, setBundle] = useState("all");
  const [hideIndexes, setHideIndexes] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overNode, setOverNode] = useState(false);
  const [pinned, setPinned] = useState(0);
  const tabs = useTabs();

  // ---------------------------------------------------------------- data
  const load = useCallback(async () => {
    const r = await fetch("/api/graph");
    const d = await r.json();
    const keep = (d.nodes as Node[]).filter(
      (n) => (bundle === "all" || n.bundle === bundle) && (!hideIndexes || !n.isIndex),
    );
    const ids = new Set(keep.map((n) => n.id));
    const es = (d.edges as Edge[]).filter((e) => ids.has(e.s) && ids.has(e.t));

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
  }, [bundle, hideIndexes]);

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

      const hi = hover.current;
      const near = hi ? adj.current.get(hi.id)! : null;

      ctx.lineWidth = 0.7;
      for (const e of edges.current) {
        const a = byId.current.get(e.s)!, b = byId.current.get(e.t)!;
        const lit = hi && (e.s === hi.id || e.t === hi.id);
        ctx.strokeStyle = lit ? "#3366cc" : (css.getPropertyValue("--line-soft") || "#ccc");
        ctx.globalAlpha = hi ? (lit ? 0.9 : 0.12) : 0.42;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      ctx.globalAlpha = 1;
      for (const n of nodes.current) {
        const r = 3 + Math.min(9, Math.sqrt(n.degree) * 2);
        const dim = hi && n !== hi && !near!.has(n.id);
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fillStyle = COLOR[n.type] ?? "#888";
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n === hi) { ctx.strokeStyle = "#3366cc"; ctx.lineWidth = 2; ctx.stroke(); }
        else if (n.pinned) {
          ctx.strokeStyle = css.getPropertyValue("--muted") || "#666";
          ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // Only the hovered node is labelled. Drawing every hub's title turned the
      // canvas into overlapping text; on hover it reads cleanly and the dimming
      // of everything else already shows the neighbourhood.
      if (hi) {
        const r = 3 + Math.min(9, Math.sqrt(hi.degree) * 2);
        ctx.globalAlpha = 1;
        ctx.font = "600 12px -apple-system, system-ui, sans-serif";
        const text = hi.title;
        const tw = ctx.measureText(text).width;
        const bx = hi.x + r + 5, by = hi.y - 8;
        // Plate behind the text so it stays legible over edges and nodes.
        ctx.fillStyle = css.getPropertyValue("--bg") || "#fff";
        ctx.globalAlpha = 0.88;
        ctx.fillRect(bx - 4, by - 2, tw + 8, 18);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = css.getPropertyValue("--line-soft") || "#ccc";
        ctx.lineWidth = 1 / k;
        ctx.strokeRect(bx - 4, by - 2, tw + 8, 18);
        ctx.fillStyle = css.getPropertyValue("--fg") || "#222";
        ctx.fillText(text, bx, by + 11);
      }
      ctx.restore();
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [ready]);

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
        <select value={bundle} onChange={(e) => setBundle(e.target.value)}>
          <option value="all">Ambos bundles</option>
          <option value="personal">personal</option>
          <option value="veridia">veridia</option>
        </select>
        <label>
          <input type="checkbox" checked={hideIndexes} onChange={(e) => setHideIndexes(e.target.checked)} />
          {" "}ocultar índices
        </label>
        <button
          onClick={() => {
            for (const n of nodes.current) n.pinned = false;
            alpha.current = 0.5;                 // reheat so they settle again
            setPinned(0);
          }}
          disabled={!pinned}
          title="Los nodos que arrastras se quedan fijos; esto los suelta"
        >
          Soltar fijados{pinned ? ` (${pinned})` : ""}
        </button>
        <span className="dim">{stats.n} notas · {stats.e} enlaces</span>
        <span className="graphlegend">
          {Object.entries(COLOR).map(([t, c]) => (
            <span key={t}><i style={{ background: c }} />{t}</span>
          ))}
        </span>
      </div>

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
          setLabel(n ? n.title : null);
        }}
        onMouseUp={() => {
          if (drag.current.node?.pinned) setPinned(nodes.current.filter((n) => n.pinned).length);
          drag.current.node = null; drag.current.panning = false; setDragging(false);
        }}
        onMouseLeave={() => {
          drag.current.node = null; drag.current.panning = false; drag.current.moved = false;
          hover.current = null; setDragging(false); setOverNode(false); setLabel(null);
        }}
        onClick={(e) => {
          // A drag is not a click. Without this the node opened on release and
          // the canvas unmounted mid-drag.
          if (drag.current.moved) { drag.current.moved = false; return; }
          const n = pick(at(e));
          if (n) tabs?.open(n.id, n.title, e.metaKey || e.ctrlKey);
        }}
        onWheel={(e) => {
          const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
          view.current.k = Math.min(4, Math.max(0.2, view.current.k * f));
        }}
      />
      {label && <div className="graphtip">{label}</div>}
    </div>
  );
}
