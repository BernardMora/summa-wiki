"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Node {
  name: string; rel: string; dir: boolean; id?: string; children?: Node[];
}

const TYPES = ["knowledge", "project", "area", "moc", "journal", "source", "connection", "system"];

/**
 * Filesystem view of the vault, Obsidian-sidebar style. Complements the
 * categorised view: categories answer "what is this about", the tree answers
 * "where does it live". New notes are created here, into the selected folder.
 */
export default function FileTree() {
  const [root, setRoot] = useState<Node[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set(["00-System", "01-Pillars", "02-Journal"]));
  const [selDir, setSelDir] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("knowledge");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function load() {
    const r = await fetch("/api/tree");
    setRoot((await r.json()).root ?? []);
  }
  useEffect(() => { load(); }, []);

  function toggle(rel: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(rel) ? next.delete(rel) : next.add(rel);
      return next;
    });
  }

  async function create() {
    setErr("");
    const r = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: selDir, title, type }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setCreating(false); setTitle("");
    await load();
    router.push(`/note/${encodeURIComponent(d.id)}`);
    router.refresh();
  }

  function render(nodes: Node[], depth = 0): React.ReactNode {
    return nodes.map((n) => {
      const pad = { paddingLeft: 4 + depth * 11 };
      if (n.dir) {
        const isOpen = open.has(n.rel);
        return (
          <div key={n.rel}>
            <div
              className={`row dir${selDir === n.rel ? " sel" : ""}`}
              style={pad}
              onClick={() => { toggle(n.rel); setSelDir(n.rel); }}
              title={n.rel}
            >
              <span className="caret">{isOpen ? "▾" : "▸"}</span>
              <span className="name">{n.name}</span>
            </div>
            {isOpen && n.children && render(n.children, depth + 1)}
          </div>
        );
      }
      const isNote = Boolean(n.id);
      return (
        <div
          key={n.rel}
          className={`row ${isNote ? "file" : "other"}`}
          style={pad}
          title={n.rel}
          onClick={() => { if (n.id) router.push(`/note/${encodeURIComponent(n.id)}`); }}
        >
          <span className="caret" />
          <span className="name">{n.name}</span>
        </div>
      );
    });
  }

  return (
    <div>
      <button className="newbtn" onClick={() => setCreating((v) => !v)}>
        + Nueva nota{selDir ? ` en /${selDir}` : " en la raíz"}
      </button>

      {creating && (
        <div className="newform">
          <input
            autoFocus
            placeholder="Título de la nota"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={create}>Crear</button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setCreating(false)}>Cancelar</button>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
            El nombre del archivo se genera en slug; el título va en el frontmatter.
          </div>
        </div>
      )}

      <div className="tree">{render(root)}</div>
    </div>
  );
}
