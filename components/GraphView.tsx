"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTabs } from "./Tabs.tsx";

interface Node {
  id: string; title: string; type: string; bundle: string; pillar: string;
  words: number; degree: number; isIndex: boolean;
  x: number; y: number; vx: number; vy: number;
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
  const drag = useRef<{ node: Node | null; panX: number; panY: number; panning: boolean }>({
    node: null, panX: 0, panY: 0, panning: false,
  });
  const hover = useRef<Node | null>(null);

  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ n: 0, e: 0 });
  const [bundle, setBundle] = useState("all");
  const [hideIndexes, setHideIndexes] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
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
    let alpha = 1;

    const step = () => {
      const ns = nodes.current;
      const es = edges.current;
      if (alpha > 0.005) {
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
          if (drag.current.node === n) { n.vx = 0; n.vy = 0; continue; }
          n.x += (n.vx *= 0.82) * alpha;
          n.y += (n.vy *= 0.82) * alpha;
        }
        alpha *= 0.995;
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
        // Label only the hubs, or the graph becomes unreadable.
        if (!dim && (n.degree >= 6 || n === hi) && k > 0.55) {
          ctx.globalAlpha = dim ? 0.2 : 0.85;
          ctx.fillStyle = css.getPropertyValue("--fg") || "#222";
          ctx.font = `${n === hi ? 12 : 10}px -apple-system, sans-serif`;
          ctx.fillText(n.title.slice(0, 26), n.x + r + 3, n.y + 3);
        }
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
        onMouseDown={(e) => {
          const n = pick(at(e));
          if (n) drag.current.node = n;
          else { drag.current.panning = true; drag.current.panX = e.clientX; drag.current.panY = e.clientY; }
        }}
        onMouseMove={(e) => {
          const p = at(e);
          if (drag.current.node) { drag.current.node.x = p.x; drag.current.node.y = p.y; return; }
          if (drag.current.panning) {
            view.current.x += e.clientX - drag.current.panX;
            view.current.y += e.clientY - drag.current.panY;
            drag.current.panX = e.clientX; drag.current.panY = e.clientY;
            return;
          }
          const n = pick(p);
          hover.current = n;
          setLabel(n ? n.title : null);
        }}
        onMouseUp={() => { drag.current.node = null; drag.current.panning = false; }}
        onMouseLeave={() => { drag.current.node = null; drag.current.panning = false; hover.current = null; setLabel(null); }}
        onClick={(e) => {
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
