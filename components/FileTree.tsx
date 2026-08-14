"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTabs } from "./Tabs.tsx";
import { REVEAL_EVENT } from "./Crumb.tsx";
import { FileIcon, FolderIcon } from "./FileIcon.tsx";

/** Sangría por nivel, en px. Es también la separación entre guías. */
const STEP = 11;

interface Node { name: string; rel: string; dir: boolean; id?: string; ext?: string; children?: Node[]; }
interface Menu { x: number; y: number; node: Node; }
interface Cat { id: string; label: string; }

const TYPES = ["knowledge", "project", "area", "moc", "journal", "source", "connection", "system"];
const OPEN_KEY = "wiki.tree.open";

/**
 * Filesystem view of the vault, Obsidian-sidebar style. Right-click gives
 * folder actions (new note / rename / delete) and file actions (rename /
 * delete). Categories answer "what is this about"; this answers "where does
 * it live".
 */
export default function FileTree() {
  const [root, setRoot] = useState<Node[]>([]);
  /**
   * Carpetas abiertas, recordadas entre sesiones.
   *
   * El valor por defecto eran `00-System`, `01-Pillars` y `02-Journal`, que
   * dejaron de existir con la reorganización de julio: el árbol abría con todo
   * colapsado. Ahora se guarda lo que el usuario deje abierto y solo se usa un
   * valor inicial la primera vez — y ese valor lo pone la arquitectura, no el
   * código, porque `00-Bernardo` no existe en el vault de nadie más.
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openLoaded, setOpenLoaded] = useState(false);
  /**
   * ¿Había preferencia guardada? Distinto de "está vacía": quien colapsa todo
   * a propósito guarda `[]`, y sin esta marca el default de la arquitectura se
   * le volvería a abrir en cada recarga, deshaciéndole el trabajo.
   */
  const stored = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) { stored.current = true; setOpen(new Set(JSON.parse(raw) as string[])); }
    } catch { /* preferencia corrupta: se ignora y se reescribe */ }
    setOpenLoaded(true);
  }, []);

  useEffect(() => {
    // No escribir antes de leer, o el primer render borraría lo guardado.
    if (!openLoaded) return;
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* sin cuota */ }
  }, [open, openLoaded]);
  const [selDir, setSelDir] = useState("");
  /** Carpetas que contienen la nota abierta: su guía va resaltada, como en VS Code. */
  const [activeTrail, setActiveTrail] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [mkdirIn, setMkdirIn] = useState<string | null>(null);
  const [dragRel, setDragRel] = useState<string | null>(null);
  const [overDir, setOverDir] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState<Node | null>(null);
  const [deleting, setDeleting] = useState<{ node: Node; notEmptyCount?: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("knowledge");
  const [err, setErr] = useState("");
  const [cats, setCats] = useState<Cat[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [vault, setVault] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const tabs = useTabs();
  const boxRef = useRef<HTMLDivElement>(null);

  async function load(hidden = showHidden) {
    const r = await fetch(`/api/tree${hidden ? "?hidden=1" : ""}`);
    const d = await r.json();
    setRoot(d.root ?? []);
    setVault(d.vault ?? "");
    setLinks(d.links ?? {});
    // Solo en el primer arranque de verdad: si hubo preferencia guardada,
    // manda ella, aunque esté vacía.
    if (!stored.current) setOpen(new Set(d.defaultOpen ?? []));
  }

  /**
   * Las tres rutas de un nodo.
   *
   * `abs` es la ruta dentro del vault; `real` solo difiere cuando el nodo cuelga
   * de una carpeta montada por symlink — hoy el bundle de Veridia, que vive en
   * Drive. Ahí «ruta absoluta» es ambiguo, así que se ofrecen las dos en vez de
   * elegir en silencio: la del vault sirve para el terminal y para esta app, la
   * real es la que ven Finder y Drive.
   */
  function pathsOf(n: Node): { rel: string; abs: string; real: string } {
    const abs = vault ? `${vault}/${n.rel}` : n.rel;
    let real = abs;
    for (const [mount, target] of Object.entries(links)) {
      if (n.rel === mount || n.rel.startsWith(`${mount}/`)) {
        real = target + n.rel.slice(mount.length);
        break;
      }
    }
    return { rel: n.rel, abs, real };
  }

  /** Copia y confirma en el propio botón; sin toast, el menú ya está bajo el ratón. */
  async function copy(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Sin permiso de portapapeles (o contexto no seguro): el textarea oculto
      // sigue funcionando en todos los navegadores.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* nada más que intentar */ }
      ta.remove();
    }
    setCopied(tag);
    setTimeout(() => { setCopied(null); setMenu(null); }, 700);
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
  useEffect(() => { load(showHidden); }, [showHidden]);
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
    setActiveTrail(new Set(trail ?? []));
  }, [activeId, root]);

  /**
   * Refresco automático: el servidor vigila el vault y avisa por SSE.
   *
   * Hasta ahora el árbol solo se releía tras una acción propia (crear, mover,
   * borrar), así que un archivo creado desde Obsidian, desde la terminal
   * integrada o por un agente no aparecía hasta recargar la página — con la
   * app de escritorio abierta todo el día, eso significa un árbol
   * permanentemente desfasado.
   *
   * `load` se lee por referencia dentro del handler para que el EventSource se
   * abra una sola vez en la vida del componente: incluirlo en las dependencias
   * reconectaría en cada render.
   */
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource("/api/watch");
    es.addEventListener("change", () => {
      // El servidor ya agrupa a 250 ms; este segundo margen absorbe la ráfaga
      // de un `git checkout` o de un guardado masivo sin encadenar fetches.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 200);
    });
    // Sin onerror el navegador reconecta solo, que es lo que se quiere; solo
    // se silencia el ruido en consola cuando el servidor se reinicia.
    es.onerror = () => { /* EventSource reintenta por su cuenta */ };
    return () => { if (timer) clearTimeout(timer); es.close(); };
  }, []);

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

  async function createFolder(parent: string) {
    setErr("");
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mkdir", rel: parent, name: draft }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setMkdirIn(null); setDraft("");
    // Se abre la carpeta padre y la nueva, o se crea a ciegas.
    setOpen((prev) => { const n = new Set(prev); n.add(parent); n.add(d.rel); return n; });
    await load();
  }

  /** Mueve `rel` dentro de la carpeta `dest` y repunta los enlaces del vault. */
  async function moveTo(rel: string, dest: string) {
    setErr("");
    if (rel === dest || dest.startsWith(rel + "/")) return;
    if (rel.split("/").slice(0, -1).join("/") === dest) return;   // ya está ahí
    setMoving(true);
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", rel, name: dest }),
    });
    const d = await r.json();
    setMoving(false);
    if (!r.ok) { setErr(d.error ?? "no se pudo mover"); return; }
    setOpen((p) => { const n = new Set(p); n.add(dest); return n; });
    await load();
    router.refresh();
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
    setErr("");
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", rel: node.rel, confirm: confirmed }),
    });
    const d = await r.json();
    if (r.status === 409 && d.error === "not-empty") {
      setDeleting({ node, notEmptyCount: d.count });
      return;
    }
    if (!r.ok) { setErr(d.error ?? "error al borrar"); return; }
    setDeleting(null);
    await load(); router.refresh();
  }

  function askDelete(node: Node) {
    setDeleting({ node });
  }

  /** Notes and PDFs both open as tabs; other assets stream from the API. */
  function openFile(n: Node, newTab: boolean) {
    /*
     * Solo las notas pierden la extensión en la pestaña: ahí el nombre hace de
     * título. Todo lo demás la conserva, como en VS Code — y como en la fila
     * del árbol. El `|| n.name` es la red de seguridad para los ocultos:
     * quitarle `.md` a un archivo llamado `.md` dejaría la pestaña sin
     * etiqueta.
     */
    const label = n.id ? (n.name.replace(/\.md$/i, "") || n.name) : n.name;
    if (n.id) { tabs?.open(n.id, label, newTab); return; }
    if (n.ext === "canvas") { tabs?.open(`canvas:${n.rel}`, label, newTab); return; }
    if (n.ext === "pdf") { tabs?.open(`pdf:${n.rel}`, label, newTab); return; }
    if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(n.ext ?? "")) {
      tabs?.open(`img:${n.rel}`, label, newTab); return;
    }
    // Antes se abría /api/asset en una pestaña del navegador, que en la
    // práctica descargaba el archivo sin avisar. Ahora se abre una ficha
    // dentro de la app con el botón de descarga explícito.
    tabs?.open(`raw:${n.rel}`, label, newTab);
  }

  /**
   * `trail` son las carpetas ancestro de estos nodos, de la raíz hacia abajo.
   * Se usa para dibujar una guía por nivel: cada fila pinta una línea vertical
   * en la columna de cada ancestro, y como las filas van pegadas sin hueco,
   * esas líneas se leen como un único trazo continuo que abarca exactamente el
   * contenido de la carpeta — que es como lo hace VS Code.
   *
   * Se dibujan dentro de la fila y no como `border-left` de un contenedor
   * anidado porque la fila tiene que seguir ocupando todo el ancho de la barra
   * lateral: el resaltado al pasar el ratón llega hasta el borde, y un
   * contenedor con margen izquierdo lo recortaría.
   */
  function render(nodes: Node[], depth = 0, trail: string[] = []): React.ReactNode {
    return nodes.map((n) => {
      const pad = { paddingLeft: 4 + depth * STEP };
      const guides = trail.map((anc, i) => (
        <span
          key={anc}
          className={`guide${activeTrail.has(anc) ? " on" : ""}`}
          style={{ left: 4 + i * STEP + 5 }}
          aria-hidden
        />
      ));
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
              className={`row dir${selDir === n.rel ? " sel" : ""}${overDir === n.rel ? " dropinto" : ""}`}
              style={pad}
              draggable
              onDragStart={(e) => { e.stopPropagation(); setDragRel(n.rel); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDragRel(null); setOverDir(null); }}
              onDragOver={(e) => {
                if (dragRel && (dragRel === n.rel || n.rel.startsWith(dragRel + "/"))) return;
                e.preventDefault(); e.dataTransfer.dropEffect = dragRel ? "move" : "copy";
                if (overDir !== n.rel) setOverDir(n.rel);
              }}
              onDragLeave={() => setOverDir((d) => (d === n.rel ? null : d))}
              onDrop={async (e) => {
                e.preventDefault(); e.stopPropagation();
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                  setOverDir(null); setDragRel(null);
                  for (let i = 0; i < files.length; i++) {
                    const fd = new FormData();
                    fd.append("rel", n.rel);
                    fd.append("file", files[i]);
                    await fetch("/api/fs/upload", { method: "POST", body: fd });
                  }
                  await load();
                  return;
                }
                const src = dragRel ?? e.dataTransfer.getData("text/plain");
                setOverDir(null); setDragRel(null);
                if (src) moveTo(src, n.rel);
              }}
              onClick={() => { toggle(n.rel); setSelDir(n.rel); }}
              onContextMenu={onCtx}
              title={n.rel}
            >
              {guides}
              <span className="caret">{isOpen ? "▾" : "▸"}</span>
              <FolderIcon open={isOpen} />
              <span className="name">{n.name}</span>
            </div>

            {mkdirIn === n.rel && (
              <div className="newform" style={pad}>
                <input
                  autoFocus placeholder="Nombre de la carpeta" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFolder(n.rel);
                    if (e.key === "Escape") { setMkdirIn(null); setDraft(""); }
                  }}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => createFolder(n.rel)}>Crear</button>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => { setMkdirIn(null); setDraft(""); }}>Cancelar</button>
                </div>
                {err && <div className="err">{err}</div>}
              </div>
            )}

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

            {isOpen && n.children && render(n.children, depth + 1, [...trail, n.rel])}
          </div>
        );
      }

      return (
        <div
          key={n.rel}
          className={`row ${n.id ? "file" : "other"}${(n.id && n.id === activeId) || activeId === `pdf:${n.rel}` || activeId === `img:${n.rel}` || activeId === `canvas:${n.rel}` ? " current" : ""}`}
          style={pad}
          title={n.rel}
          draggable
          onDragStart={(e) => { setDragRel(n.rel); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", n.rel); }}
          onDragEnd={() => { setDragRel(null); setOverDir(null); }}
          onContextMenu={onCtx}
          onClick={(e) => openFile(n, e.metaKey || e.ctrlKey)}
          onDoubleClick={(e) => { e.preventDefault(); openFile(n, true); }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openFile(n, true); } }}
        >
          {guides}
          <span className="caret" />
          <FileIcon name={n.name} />
          {/*
            El nombre completo, con extensión, como en VS Code.

            Antes se recortaba con `replace(/\.[^.]+$/, "")`, y sobre un
            archivo oculto ese regex se come el nombre ENTERO: `.DS_Store` es
            un punto seguido de algo sin más puntos, así que la fila salía en
            blanco con solo la etiqueta de tipo al lado. La etiqueta también
            sobra ahora: el icono ya dice de qué tipo es, y repetir "ts" junto
            a `indexer.ts` solo gasta el ancho de una barra lateral estrecha.
          */}
          <span className="name">{n.name}</span>
        </div>
      );
    });
  }

  return (
    <div ref={boxRef}>
      <div className="treehint" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ flex: 1 }}>{moving ? "Moviendo y repuntando enlaces…" : "Clic derecho para crear, renombrar o borrar · arrastra para mover"}</span>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer", opacity: showHidden ? 1 : 0.6, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} style={{ margin: 0 }} />
          <span>Ocultos</span>
        </label>
      </div>

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

      {menu && createPortal(
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{menu.node.name}</div>
          {menu.node.dir && (
            <button onClick={() => {
              setCreatingIn(menu.node.rel); setSelDir(menu.node.rel);
              setOpen((p) => new Set(p).add(menu.node.rel));
              setDraft(""); setErr(""); setMenu(null);
            }}>Nueva nota aquí</button>
          )}
          {menu.node.dir && (
            <button onClick={() => {
              setMkdirIn(menu.node.rel); setCreatingIn(null); setDraft(""); setMenu(null);
              setOpen((p) => { const n = new Set(p); n.add(menu.node.rel); return n; });
            }}>Nueva carpeta aquí</button>
          )}
          {!menu.node.dir && (menu.node.id || /\.pdf$/i.test(menu.node.name)) && (
            <button onClick={() => {
              const sid = menu.node.id ?? `pdf:${menu.node.rel}`;
              const cur = tabs?.activeId;
              setMenu(null);
              // Splitting only makes sense against a note in the main pane.
              if (cur && !cur.startsWith("pdf:")) {
                router.push(`/note/${encodeURIComponent(cur)}?split=${encodeURIComponent(sid)}`);
              } else {
                alert("Abre primero una nota; el panel lateral se abre junto a ella.");
              }
            }}>Abrir al lado</button>
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
          {(() => {
            const p = pathsOf(menu.node);
            return (
              <>
                <div className="ctxsep" />
                <button onClick={() => copy(p.rel, "rel")}>
                  {copied === "rel" ? "✓ copiada" : "Copiar ruta relativa"}
                </button>
                <button onClick={() => copy(p.abs, "abs")}>
                  {copied === "abs" ? "✓ copiada" : "Copiar ruta absoluta"}
                </button>
                {p.real !== p.abs && (
                  <button onClick={() => copy(p.real, "real")}>
                    {copied === "real" ? "✓ copiada" : "Copiar ruta real (Drive)"}
                  </button>
                )}
                <div className="ctxsep" />
              </>
            );
          })()}
          <button onClick={() => {
            setRenaming(menu.node);
            // Las notas se renombran por su título (el `.md` lo pone el
            // servidor); cualquier otro archivo se edita con su nombre
            // completo, extensión incluida.
            setDraft(
              menu.node.dir || !/\.md$/i.test(menu.node.name)
                ? menu.node.name
                : menu.node.name.replace(/\.md$/i, ""),
            );
            setErr(""); setMenu(null);
          }}>Renombrar</button>
          <button className="danger" onClick={() => { const n = menu.node; setMenu(null); askDelete(n); }}>
            Borrar
          </button>
        </div>,
        document.body,
      )}

      {deleting && createPortal(
        <div className="qsback" onMouseDown={() => { setDeleting(null); setErr(""); }}>
          <div className="qsbox" style={{ padding: "16px 24px", maxWidth: "480px" }} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Confirmar eliminación</h2>
            <p style={{ margin: 0, marginBottom: 24, lineHeight: 1.5, color: "var(--fg-dim)" }}>
              {deleting.notEmptyCount !== undefined ? (
                <>La carpeta <strong>{deleting.node.name}</strong> contiene {deleting.notEmptyCount} elemento(s). ¿Estás seguro de que quieres borrarla junto con todo su contenido?</>
              ) : (
                <>¿Estás seguro de que quieres borrar {deleting.node.dir ? "la carpeta" : "la nota"} <strong>{deleting.node.name}</strong>? Esta acción no se puede deshacer.</>
              )}
            </p>
            {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { setDeleting(null); setErr(""); }}>Cancelar</button>
              <button className="danger" onClick={() => doDelete(deleting.node, deleting.notEmptyCount !== undefined)}>Borrar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
