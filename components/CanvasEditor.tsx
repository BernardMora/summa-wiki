"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Editor de archivos `.canvas` (Obsidian Canvas).
 *
 * Las aristas se dibujan en un SVG y los nodos son divs encima: así la edición
 * de texto es un `textarea` nativo, con su cursor y su selección, en vez de
 * reimplementar edición sobre un canvas 2D.
 */

export type Side = "top" | "right" | "bottom" | "left";
export interface CNode {
  id: string; type: string; text?: string;
  x: number; y: number; width: number; height: number; color?: string;
}
export interface CEdge {
  id: string; fromNode: string; fromSide: Side; toNode: string; toSide: Side;
  fromEnd?: "none" | "arrow"; toEnd?: "none" | "arrow"; color?: string; label?: string;
}

/** Paleta de Obsidian: los archivos guardan "1".."6", no colores literales. */
const PALETTE: Record<string, string> = {
  "1": "#e05252", "2": "#e0a152", "3": "#e0d152",
  "4": "#52e07a", "5": "#52c2e0", "6": "#a752e0",
};
const colorOf = (c?: string) => (c ? PALETTE[c] ?? c : "var(--line)");
const uid = () => Math.random().toString(16).slice(2, 18).padEnd(16, "0");

const anchor = (n: CNode, s: Side) =>
  s === "top" ? { x: n.x + n.width / 2, y: n.y }
  : s === "bottom" ? { x: n.x + n.width / 2, y: n.y + n.height }
  : s === "left" ? { x: n.x, y: n.y + n.height / 2 }
  : { x: n.x + n.width, y: n.y + n.height / 2 };

/** Curva con salida perpendicular al lado, como la de Obsidian. */
function edgePath(a: { x: number; y: number }, sa: Side, b: { x: number; y: number }, sb: Side) {
  const d = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const off = (s: Side) => (s === "left" ? [-d, 0] : s === "right" ? [d, 0] : s === "top" ? [0, -d] : [0, d]);
  const [ax, ay] = off(sa), [bx, by] = off(sb);
  return `M ${a.x} ${a.y} C ${a.x + ax} ${a.y + ay}, ${b.x + bx} ${b.y + by}, ${b.x} ${b.y}`;
}

type Drag =
  | { kind: "node"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string; ox: number; oy: number; w: number; h: number }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "link"; from: string; side: Side; x: number; y: number };

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const AUTOSAVE_MS = 800;

export default function CanvasEditor({ path: filePath }: { path: string }) {
  const [nodes, setNodes] = useState<CNode[]>([]);
  const [edges, setEdges] = useState<CEdge[]>([]);
  const [sel, setSel] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const drag = useRef<Drag | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const mtime = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // ------------------------------------------------------------------ carga
  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await fetch(`/api/canvas?p=${encodeURIComponent(filePath)}`, { cache: "no-store" });
      if (!r.ok) { setErr("no se pudo abrir el canvas"); return; }
      const d = await r.json();
      if (dead) return;
      setNodes(d.nodes); setEdges(d.edges); mtime.current = d.mtimeMs;
      // Encuadrar el contenido: los canvas de Obsidian usan coordenadas negativas.
      if (d.nodes.length && wrap.current) {
        const xs = d.nodes.map((n: CNode) => n.x), ys = d.nodes.map((n: CNode) => n.y);
        const x2 = Math.max(...d.nodes.map((n: CNode) => n.x + n.width));
        const y2 = Math.max(...d.nodes.map((n: CNode) => n.y + n.height));
        const b = wrap.current.getBoundingClientRect();
        const k = Math.min(1, (b.width - 80) / Math.max(1, x2 - Math.min(...xs)),
                              (b.height - 80) / Math.max(1, y2 - Math.min(...ys)));
        setView({ k, x: 40 - Math.min(...xs) * k, y: 40 - Math.min(...ys) * k });
      }
      setReady(true);
    })();
    return () => { dead = true; };
  }, [filePath]);

  // --------------------------------------------------------------- guardado
  const save = useCallback(async (ns: CNode[], es: CEdge[]) => {
    setStatus("guardando…");
    const r = await fetch("/api/canvas", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: filePath, nodes: ns, edges: es, mtimeMs: mtime.current }),
    });
    if (r.status === 409) { setStatus("cambió en disco — recarga"); return; }
    if (!r.ok) { setStatus("error al guardar"); return; }
    mtime.current = (await r.json()).mtimeMs;
    dirty.current = false;
    setStatus("guardado");
    setTimeout(() => setStatus((s) => (s === "guardado" ? "" : s)), 1200);
  }, [filePath]);

  const touch = useCallback((ns: CNode[], es: CEdge[]) => {
    dirty.current = true;
    setStatus("sin guardar");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(ns, es), AUTOSAVE_MS);
  }, [save]);

  const commit = useCallback((ns: CNode[], es: CEdge[]) => {
    setNodes(ns); setEdges(es); touch(ns, es);
  }, [touch]);

  // Vaciar el autosave pendiente al desmontar, no descartarlo.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // ------------------------------------------------------------- operaciones
  const patchNode = (id: string, p: Partial<CNode>) =>
    commit(nodes.map((n) => (n.id === id ? { ...n, ...p } : n)), edges);

  const addNode = (x: number, y: number) => {
    const n: CNode = { id: uid(), type: "text", text: "Nuevo nodo", x: Math.round(x), y: Math.round(y), width: 250, height: 120 };
    commit([...nodes, n], edges);
    setSel({ kind: "node", id: n.id });
    setEditing(n.id);
  };

  const removeSelection = () => {
    if (!sel) return;
    if (sel.kind === "node") {
      // Una arista sin sus dos nodos deja el archivo inconsistente.
      commit(nodes.filter((n) => n.id !== sel.id),
             edges.filter((e) => e.fromNode !== sel.id && e.toNode !== sel.id));
    } else {
      commit(nodes, edges.filter((e) => e.id !== sel.id));
    }
    setSel(null);
  };

  /** Rota entre: flecha al destino, al origen, a ambos, a ninguno. */
  const cycleArrows = (e: CEdge) => {
    const to = e.toEnd !== "none", from = e.fromEnd === "arrow";
    const next: Partial<CEdge> =
      to && !from ? { toEnd: "none", fromEnd: "arrow" }
      : !to && from ? { toEnd: "arrow", fromEnd: "arrow" }
      : to && from ? { toEnd: "none", fromEnd: "none" }
      : { toEnd: "arrow", fromEnd: "none" };
    commit(nodes, edges.map((x) => (x.id === e.id ? { ...x, ...next } : x)));
  };

  const setColor = (c?: string) => {
    if (!sel) return;
    if (sel.kind === "node") commit(nodes.map((n) => (n.id === sel.id ? { ...n, color: c } : n)), edges);
    else commit(nodes, edges.map((e) => (e.id === sel.id ? { ...e, color: c } : e)));
  };

  // ------------------------------------------------------------------ input
  const toWorld = (cx: number, cy: number) => {
    const b = wrap.current!.getBoundingClientRect();
    return { x: (cx - b.left - view.x) / view.k, y: (cy - b.top - view.y) / view.k };
  };

  useEffect(() => {
    if (!drag.current && !ready) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.kind === "pan") {
        setView((v) => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
      } else if (d.kind === "node") {
        const p = toWorld(e.clientX, e.clientY);
        setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: Math.round(p.x - d.dx), y: Math.round(p.y - d.dy) } : n)));
      } else if (d.kind === "resize") {
        const p = toWorld(e.clientX, e.clientY);
        setNodes((ns) => ns.map((n) => (n.id === d.id
          ? { ...n, width: Math.max(80, Math.round(d.w + p.x - d.ox)), height: Math.max(50, Math.round(d.h + p.y - d.oy)) }
          : n)));
      } else if (d.kind === "link") {
        const p = toWorld(e.clientX, e.clientY);
        drag.current = { ...d, x: p.x, y: p.y };
        setView((v) => ({ ...v }));            // repintar la línea guía
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.kind === "node" || d.kind === "resize") { touch(nodes, edges); }
      if (d.kind === "link") {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]");
        const target = el?.getAttribute("data-node");
        if (target && target !== d.from) {
          const a = byId.get(d.from)!, b = byId.get(target)!;
          // Lado de llegada = el que queda enfrente, para que la curva no cruce.
          const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
          const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
          const toSide: Side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "left" : "right") : (dy > 0 ? "top" : "bottom");
          commit(nodes, [...edges, { id: uid(), fromNode: d.from, fromSide: d.side, toNode: target, toSide, toEnd: "arrow" }]);
        }
      }
      document.body.classList.remove("canvas-dragging");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [ready, nodes, edges, byId, view, touch, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeSelection(); }
      if (e.key === "Escape") setSel(null);
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(nodes, edges); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (err) return <p className="warn" style={{ padding: 16 }}>{err}</p>;

  const link = drag.current?.kind === "link" ? drag.current : null;

  return (
    <div className="cvwrap">
      <div className="cvbar">
        <button onClick={() => { const b = wrap.current!.getBoundingClientRect();
          addNode((b.width / 2 - view.x) / view.k - 125, (b.height / 2 - view.y) / view.k - 60); }}>
          + Nodo
        </button>
        <button onClick={removeSelection} disabled={!sel}>Eliminar</button>
        <button
          onClick={() => { const e = edges.find((x) => x.id === sel?.id); if (e) cycleArrows(e); }}
          disabled={sel?.kind !== "edge"}
          title="Rota entre flecha al destino, al origen, ambas o ninguna"
        >Dirección</button>
        <span className="cvcolors">
          {["", "1", "2", "3", "4", "5", "6"].map((c) => (
            <button key={c || "none"} className="cvcolor" disabled={!sel}
              style={{ background: c ? PALETTE[c] : "transparent", borderColor: c ? PALETTE[c] : "var(--line)" }}
              title={c ? `Color ${c}` : "Sin color"}
              onClick={() => setColor(c || undefined)} />
          ))}
        </span>
        <span className="dim">{nodes.length} nodos · {edges.length} conexiones</span>
        <span className="dim" style={{ marginLeft: "auto" }}>{status}</span>
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>+</button>
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.15, v.k / 1.2) }))}>−</button>
      </div>

      <div
        className="cvstage"
        ref={wrap}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("cvsvg")) return;
          setSel(null); setEditing(null);
          drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("cvsvg")) return;
          const p = toWorld(e.clientX, e.clientY);
          addNode(p.x - 125, p.y - 60);
        }}
        onWheel={(e) => {
          const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          const b = wrap.current!.getBoundingClientRect();
          const mx = e.clientX - b.left, my = e.clientY - b.top;
          setView((v) => {
            const k = Math.min(2.5, Math.max(0.15, v.k * f));
            return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
          });
        }}
      >
        <div className="cvlayer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="cvsvg" overflow="visible">
            <defs>
              <marker id="cvarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
              </marker>
              <marker id="cvarrowsel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--link)" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = byId.get(e.fromNode), b = byId.get(e.toNode);
              if (!a || !b) return null;                 // arista colgante
              const on = sel?.kind === "edge" && sel.id === e.id;
              const d = edgePath(anchor(a, e.fromSide), e.fromSide, anchor(b, e.toSide), e.toSide);
              return (
                <g key={e.id}>
                  <path d={d} className="cvedgehit"
                    onPointerDown={(ev) => { ev.stopPropagation(); setSel({ kind: "edge", id: e.id }); }} />
                  <path
                    d={d} fill="none"
                    stroke={on ? "var(--link)" : colorOf(e.color)}
                    strokeWidth={on ? 3 : 2}
                    markerEnd={e.toEnd !== "none" ? `url(#${on ? "cvarrowsel" : "cvarrow"})` : undefined}
                    markerStart={e.fromEnd === "arrow" ? `url(#${on ? "cvarrowsel" : "cvarrow"})` : undefined}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {link && byId.get(link.from) && (
              <path
                d={edgePath(anchor(byId.get(link.from)!, link.side), link.side, { x: link.x, y: link.y }, "left")}
                fill="none" stroke="var(--link)" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none"
              />
            )}
          </svg>

          {nodes.map((n) => {
            const on = sel?.kind === "node" && sel.id === n.id;
            return (
              <div
                key={n.id}
                data-node={n.id}
                className={`cvnode${on ? " on" : ""}`}
                style={{
                  left: n.x, top: n.y, width: n.width, height: n.height,
                  borderColor: on ? "var(--link)" : colorOf(n.color),
                  boxShadow: n.color ? `inset 4px 0 0 ${colorOf(n.color)}` : undefined,
                }}
                onPointerDown={(e) => {
                  if (editing === n.id) return;
                  e.stopPropagation();
                  setSel({ kind: "node", id: n.id });
                  const p = toWorld(e.clientX, e.clientY);
                  drag.current = { kind: "node", id: n.id, dx: p.x - n.x, dy: p.y - n.y };
                  document.body.classList.add("canvas-dragging");
                }}
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(n.id); }}
              >
                {editing === n.id ? (
                  <textarea
                    autoFocus
                    className="cvtext"
                    defaultValue={n.text ?? ""}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => { setEditing(null); patchNode(n.id, { text: e.target.value }); }}
                    onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }}
                  />
                ) : (
                  <div className="cvtext read">{n.text}</div>
                )}

                {on && !editing && SIDES.map((s) => {
                  const a = anchor({ ...n, x: 0, y: 0 }, s);
                  return (
                    <span
                      key={s}
                      className="cvport"
                      style={{ left: a.x, top: a.y }}
                      title="Arrastra a otro nodo para conectar"
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        const p = toWorld(ev.clientX, ev.clientY);
                        drag.current = { kind: "link", from: n.id, side: s, x: p.x, y: p.y };
                      }}
                    />
                  );
                })}

                {on && !editing && (
                  <span
                    className="cvresize"
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      const p = toWorld(ev.clientX, ev.clientY);
                      drag.current = { kind: "resize", id: n.id, ox: p.x, oy: p.y, w: n.width, h: n.height };
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="cvhelp dim">
        doble clic en vacío crea un nodo · doble clic en un nodo edita su texto ·
        arrastra desde un punto del borde para conectar · Supr elimina lo seleccionado ·
        rueda para zoom
      </p>
    </div>
  );
}
