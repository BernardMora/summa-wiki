"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./Tabs.tsx";
import { REVEAL_EVENT } from "./Crumb.tsx";

interface Node { name: string; rel: string; dir: boolean; id?: string; children?: Node[]; }
interface Menu { x: number; y: number; node: Node; }
interface Cat { id: string; label: string; }

const TYPES = ["knowledge", "project", "area", "moc", "journal", "source", "connection", "system"];

/**
 * Filesystem view of the vault, Obsidian-sidebar style. Right-click gives
 * folder actions (new note / rename / delete) and file actions (rename /
 * delete). Categories answer "what is this about"; this answers "where does
 * it live".
 */
export default function FileTree() {
  const [root, setRoot] = useState<Node[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set(["00-System", "01-Pillars", "02-Journal"]));
  const [selDir, setSelDir] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Node | null>(null);
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("knowledge");
  const [err, setErr] = useState("");
  const [cats, setCats] = useState<Cat[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const router = useRouter();
  const tabs = useTabs();
  const boxRef = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await fetch("/api/tree");
    setRoot((await r.json()).root ?? []);
  }

  /** Walk the tree for a note id, returning the folders that contain it. */
  function ancestorsOf(nodes: Node[], id: string, trail: string[] = []): string[] | null {
    for (const n of nodes) {
      if (!n.dir && n.id === id) return trail;
      if (n.dir && n.children) {
        const hit = ancestorsOf(n.children, id, [...trail, n.rel]);
        if (hit) return hit;
      }
    }
    return null;
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then((d) => setCats(d.categories ?? []));
  }, []);

  // Breadcrumb click: expand every folder along the path and select the last.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const rel = (e as CustomEvent<string>).detail;
      if (!rel) return;
      const segs = rel.split("/");
      const trail = segs.map((_, i) => segs.slice(0, i + 1).join("/"));
      setOpen((p) => { const n = new Set(p); trail.forEach((t) => n.add(t)); return n; });
      setSelDir(rel);
      requestAnimationFrame(() => {
        boxRef.current?.querySelector(".row.sel")?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };
    window.addEventListener(REVEAL_EVENT, onReveal as EventListener);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal as EventListener);
  }, []);

  // Reveal whichever note is open: expand its folders so the highlight is
  // actually visible rather than buried in a collapsed branch.
  const activeId = tabs?.activeId ?? null;
  useEffect(() => {
    if (!activeId || root.length === 0) return;
    const trail = ancestorsOf(root, activeId);
    if (trail?.length) setOpen((p) => { const n = new Set(p); trail.forEach((t) => n.add(t)); return n; });
  }, [activeId, root]);

  useEffect(() => {
    const close = () => { setMenu(null); setPinOpen(false); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, []);

  function toggle(rel: string) {
    setOpen((p) => { const n = new Set(p); n.has(rel) ? n.delete(rel) : n.add(rel); return n; });
  }

  async function createNote(folder: string) {
    setErr("");
    const r = await fetch("/api/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, title: draft, type }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setCreatingIn(null); setDraft(""); await load();
    router.push(`/note/${encodeURIComponent(d.id)}`); router.refresh();
  }

  async function doRename(node: Node) {
    setErr("");
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", rel: node.rel, name: draft }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setRenaming(null); setDraft(""); await load(); router.refresh();
  }

  async function doDelete(node: Node, confirmed = false) {
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", rel: node.rel, confirm: confirmed }),
    });
    const d = await r.json();
    if (r.status === 409 && d.error === "not-empty") {
      if (window.confirm(`«${node.name}» contiene ${d.count} elemento(s). ¿Borrar todo?`)) {
        return doDelete(node, true);
      }
      return;
    }
    if (!r.ok) { alert(d.error ?? "error al borrar"); return; }
    await load(); router.refresh();
  }

  function askDelete(node: Node) {
    const what = node.dir ? "la carpeta" : "la nota";
    if (window.confirm(`¿Borrar ${what} «${node.name}»? Esto no se puede deshacer desde la app.`)) {
      doDelete(node);
    }
  }

  function render(nodes: Node[], depth = 0): React.ReactNode {
    return nodes.map((n) => {
      const pad = { paddingLeft: 4 + depth * 11 };
      const onCtx = (e: React.MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, node: n });
      };

      if (renaming?.rel === n.rel) {
        return (
          <div key={n.rel} style={pad}>
            <input
              autoFocus className="inlineedit" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doRename(n);
                if (e.key === "Escape") setRenaming(null);
              }}
            />
            {err && <div className="err">{err}</div>}
          </div>
        );
      }

      if (n.dir) {
        const isOpen = open.has(n.rel);
        return (
          <div key={n.rel}>
            <div
              className={`row dir${selDir === n.rel ? " sel" : ""}`}
              style={pad}
              onClick={() => { toggle(n.rel); setSelDir(n.rel); }}
              onContextMenu={onCtx}
              title={n.rel}
            >
              <span className="caret">{isOpen ? "▾" : "▸"}</span>
              <span className="name">{n.name}</span>
            </div>

            {creatingIn === n.rel && (
              <div className="newform" style={{ marginLeft: 4 + depth * 11 }}>
                <input
                  autoFocus placeholder="Título de la nota" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createNote(n.rel);
                    if (e.key === "Escape") setCreatingIn(null);
                  }}
                />
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => createNote(n.rel)}>Crear</button>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => setCreatingIn(null)}>Cancelar</button>
                </div>
                {err && <div className="err">{err}</div>}
              </div>
            )}

            {isOpen && n.children && render(n.children, depth + 1)}
          </div>
        );
      }

      return (
        <div
          key={n.rel}
          className={`row ${n.id ? "file" : "other"}${n.id && n.id === activeId ? " current" : ""}`}
          style={pad}
          title={n.rel}
          onContextMenu={onCtx}
          onClick={(e) => { if (n.id) tabs?.open(n.id, n.name.replace(/\.md$/, ""), e.metaKey || e.ctrlKey); }}
          onDoubleClick={(e) => { if (n.id) { e.preventDefault(); tabs?.open(n.id, n.name.replace(/\.md$/, ""), true); } }}
          onAuxClick={(e) => { if (e.button === 1 && n.id) { e.preventDefault(); tabs?.open(n.id, n.name.replace(/\.md$/, ""), true); } }}
        >
          <span className="caret" />
          <span className="name">{n.name}</span>
        </div>
      );
    });
  }

  return (
    <div ref={boxRef}>
      <div className="treehint">Clic derecho para crear, renombrar o borrar</div>

      {creatingIn === "" && (
        <div className="newform">
          <input
            autoFocus placeholder="Título de la nota" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createNote(""); if (e.key === "Escape") setCreatingIn(null); }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => createNote("")}>Crear</button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setCreatingIn(null)}>Cancelar</button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      )}

      <div className="tree">{render(root)}</div>

      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{menu.node.name}</div>
          {menu.node.dir && (
            <button onClick={() => {
              setCreatingIn(menu.node.rel); setSelDir(menu.node.rel);
              setOpen((p) => new Set(p).add(menu.node.rel));
              setDraft(""); setErr(""); setMenu(null);
            }}>Nueva nota aquí</button>
          )}
          {!menu.node.dir && menu.node.id && (
            <div className="ctxsub">
              <button onClick={() => setPinOpen((v) => !v)}>Fijar en ▸</button>
              {pinOpen && (
                <div className="ctxsubmenu">
                  {cats.length === 0 && <div className="ctxhead">Sin categorías</div>}
                  {cats.map((c) => (
                    <button
                      key={c.id}
                      onClick={async () => {
                        await fetch("/api/categories", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "pin", id: c.id, noteId: menu.node.id }),
                        });
                        setMenu(null); setPinOpen(false); router.refresh();
                      }}
                    >{c.label}</button>
                  ))}
                  <button
                    className="danger"
                    onClick={async () => {
                      await Promise.all(cats.map((c) => fetch("/api/categories", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "unpin", id: c.id, noteId: menu.node.id }),
                      })));
                      setMenu(null); setPinOpen(false); router.refresh();
                    }}
                  >Quitar de todas</button>
                </div>
              )}
            </div>
          )}
          <button onClick={() => {
            setRenaming(menu.node);
            setDraft(menu.node.dir ? menu.node.name : menu.node.name.replace(/\.md$/, ""));
            setErr(""); setMenu(null);
          }}>Renombrar</button>
          <button className="danger" onClick={() => { const n = menu.node; setMenu(null); askDelete(n); }}>
            Borrar
          </button>
        </div>
      )}
    </div>
  );
}
