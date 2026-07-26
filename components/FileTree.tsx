"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Node { name: string; rel: string; dir: boolean; id?: string; children?: Node[]; }
interface Menu { x: number; y: number; node: Node; }

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
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await fetch("/api/tree");
    setRoot((await r.json()).root ?? []);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const close = () => setMenu(null);
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
          className={`row ${n.id ? "file" : "other"}`}
          style={pad}
          title={n.rel}
          onContextMenu={onCtx}
          onClick={() => { if (n.id) router.push(`/note/${encodeURIComponent(n.id)}`); }}
        >
          <span className="caret" />
          <span className="name">{n.name}</span>
        </div>
      );
    });
  }

  return (
    <div ref={boxRef}>
      <button
        className="newbtn"
        onClick={() => { setCreatingIn(selDir || ""); setDraft(""); setErr(""); }}
      >
        + Nueva nota{selDir ? ` en /${selDir}` : " en la raíz"}
      </button>

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
