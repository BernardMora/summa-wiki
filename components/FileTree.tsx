"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { openBesideInWorkspace, useTabs } from "./Tabs.tsx";
import { REVEAL_EVENT } from "./Crumb.tsx";
import { FileIcon, FolderIcon } from "./FileIcon.tsx";
import { useT } from "./I18n";
import { bold } from "./markup";
import { queueTerminalInput, terminalTargets } from "./terminalBridge.ts";

/** Sangría por nivel, en px. Es también la separación entre guías. */
const STEP = 11;

/** `children === undefined` -> aún no se pidió; `[]` -> ya se pidió y está vacía. */
interface Node { name: string; rel: string; dir: boolean; id?: string; ext?: string; children?: Node[]; }
interface Menu { x: number; y: number; node: Node; }
interface Cat { id: string; label: string; }

const TYPES = ["knowledge", "project", "area", "moc", "journal", "source", "connection", "system"];
const OPEN_KEY = "wiki.tree.open";
export type FileTreeCreateKind = "note" | "canvas" | "folder";
export interface FileTreeCreateRequest { seq: number; kind: FileTreeCreateKind; folder: string; }

/**
 * Filesystem view of the vault, Obsidian-sidebar style. Right-click gives
 * folder actions (new note / rename / delete) and file actions (rename /
 * delete). Categories answer "what is this about"; this answers "where does
 * it live".
 */
export default function FileTree({ createRequest, onSelectedDirChange }: { createRequest?: FileTreeCreateRequest | null; onSelectedDirChange?: (rel: string) => void }) {
  const t = useT();
  const [root, setRoot] = useState<Node[]>([]);
  /**
   * Carpetas abiertas, recordadas entre sesiones.
   *
   * El valor por defecto eran `00-System`, `01-Pillars` y `02-Journal`, que
   * dejaron de existir con la reorganización de julio: el árbol abría con todo
   * colapsado. Ahora se guarda lo que el usuario deje abierto y solo se usa un
   * valor inicial la primera vez — y ese valor lo pone la arquitectura, no el
   * código, porque `00-Identidad` es el paquete de una persona, no el de todas.
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
  const [canvasIn, setCanvasIn] = useState<string | null>(null);
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
  const [chatOpen, setChatOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [vault, setVault] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const tabs = useTabs();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { onSelectedDirChange?.(selDir); }, [selDir, onSelectedDirChange]);
  useEffect(() => {
    if (!createRequest) return;
    setSelDir(createRequest.folder);
    beginCreate(createRequest.kind, createRequest.folder);
  }, [createRequest]);

  /**
   * Carga perezosa, carpeta por carpeta — como Finder o VS Code, no como el
   * árbol completo que caminaba todo el vault en cada carga.
   *
   * `rootRef` deja que `ensureDir`, el reveal y el SSE lean el árbol actual
   * de forma síncrona fuera de un render (el mismo motivo que `loadRef` más
   * abajo). `inflight` evita pedir la misma carpeta dos veces si dos efectos
   * la reclaman a la vez (abrirla a mano justo cuando el reveal también la
   * necesita, por ejemplo).
   */
  const rootRef = useRef<Node[]>(root);
  rootRef.current = root;
  const inflight = useRef<Map<string, Promise<void>>>(new Map());
  /**
   * Carpetas que el SERVIDOR ya rechazó como inválidas (400: no existen en el
   * vault) — típicamente una entrada de `open` persistida en localStorage de
   * antes de una reorganización, o de una carpeta borrada estando abierta.
   *
   * Solo se marca aquí lo que el servidor confirmó que no existe, nunca una
   * carpeta legítima que simplemente no pudo engancharse a tiempo (por
   * ejemplo: al montar, `open` dispara `ensureDir` para varias carpetas a la
   * vez, y una carpeta hija puede resolver su fetch ANTES que su padre —
   * `setChildrenAt` no tiene dónde ponerla todavía, pero si eso contara como
   * "dada por vencida" se quedaría cargando para siempre, porque el efecto
   * que la reintentaría ya no la vuelve a pedir). Sin este Set, una carpeta
   * genuinamente inexistente sí se reintentaría en cada cambio de `root` —
   * barato por request, pero innecesario.
   */
  const gaveUp = useRef<Set<string>>(new Set());

  /**
   * Un fallo tiene DOS formas y el árbol reacciona distinto a cada una, así que
   * la respuesta las distingue en vez de colapsarlas en un `ok: false`.
   *
   * `reached: true` — el servidor contestó y contestó que no. La ruta no vale;
   * `refreshDir` da la carpeta por perdida, que es lo correcto porque eso no se
   * arregla solo.
   *
   * `reached: false` — no hubo respuesta. `fetch` RECHAZA (no devuelve un 4xx)
   * cuando la petición no llega a salir o se corta a medias: el servidor
   * todavía no escucha, la app se está cerrando, o —lo más común— la página
   * está navegando y el navegador aborta lo que hubiera en vuelo.
   * `openInWorkspace` navega con `window.location.href`, así que abrir una
   * terminal desde la portada mientras el árbol carga produce exactamente eso.
   * Aquí no se da nada por perdido: no se sabe nada del disco, solo que esta
   * petición no llegó.
   *
   * Antes ese rechazo no se atrapaba en ningún sitio. `hardReload` lo esperaba
   * sin `catch` y el efecto que lo llama tampoco, así que salía por arriba como
   * una promesa rechazada sin manejar — el «Runtime TypeError: Failed to fetch»
   * del overlay de Next, apuntando a un árbol que en realidad no tenía nada
   * roto: solo se le fue la página debajo.
   */
  async function fetchDir(dir: string, hidden = showHidden) {
    const params = new URLSearchParams({ dir });
    if (hidden) params.set("hidden", "1");
    try {
      const r = await fetch(`/api/tree?${params}`);
      if (!r.ok) return { ok: false as const, reached: true };
      const d = (await r.json()) as { children: Node[]; links: Record<string, string>; vault: string; defaultOpen: string[] };
      return { ok: true as const, ...d };
    } catch {
      // También cae aquí un `json()` que revienta: un cuerpo truncado es un
      // servidor que se murió a media respuesta, no un veredicto sobre la ruta.
      return { ok: false as const, reached: false };
    }
  }

  function findNode(nodes: Node[], rel: string): Node | undefined {
    for (const n of nodes) {
      if (n.rel === rel) return n;
      if (n.dir && n.children && rel.startsWith(`${n.rel}/`)) return findNode(n.children, rel);
    }
    return undefined;
  }

  /**
   * Conserva los hijos ya cargados de las subcarpetas que sigan existiendo.
   * Sin esto, refrescar `A` porque algo cambió adentro olvidaría lo que ya se
   * sabía de `A/B` — cada refresco por SSE colapsaría visualmente cualquier
   * rama abierta debajo del punto que cambió.
   */
  function reconcile(oldChildren: Node[], newChildren: Node[]): Node[] {
    const byRel = new Map(oldChildren.map((n) => [n.rel, n]));
    return newChildren.map((n) => {
      const prev = byRel.get(n.rel);
      return prev?.dir && n.dir && prev.children !== undefined ? { ...n, children: prev.children } : n;
    });
  }

  /**
   * Reemplazo inmutable de los hijos de `rel` (`""` = la raíz), reconciliando.
   *
   * Si `rel` no engancha en ningún nodo, devuelve la MISMA referencia de
   * `nodes` — no una copia estructuralmente igual. Es lo que deja que
   * `setRoot` detecte "nada cambió" y no dispare un re-render; sin esto, un
   * `rel` que nunca existió (ver `gaveUp` arriba) produciría un array nuevo
   * en cada intento, aunque su contenido fuera idéntico, y ese cambio de
   * referencia realimentaría el efecto que depende de `root`.
   */
  function setChildrenAt(nodes: Node[], rel: string, children: Node[]): Node[] {
    if (rel === "") return reconcile(nodes, children);
    let changed = false;
    const next = nodes.map((n) => {
      if (n.rel === rel) { changed = true; return { ...n, children: reconcile(n.children ?? [], children) }; }
      if (n.dir && n.children && rel.startsWith(`${n.rel}/`)) {
        const updated = setChildrenAt(n.children, rel, children);
        if (updated !== n.children) { changed = true; return { ...n, children: updated }; }
      }
      return n;
    });
    return changed ? next : nodes;
  }

  /**
   * Recarga forzada de una carpeta (root incluida), reconciliando. La usan
   * las mutaciones propias y el SSE — a diferencia de `ensureDir`, no
   * comprueba si ya estaba cargada.
   */
  async function refreshDir(rel: string): Promise<void> {
    const d = await fetchDir(rel);
    if (!d.ok) {
      // Solo cuando el servidor CONFIRMA que la ruta no es válida se da por
      // vencido; eso no se resuelve solo en un refresco posterior. Si no hubo
      // respuesta (`reached: false`) la carpeta se queda como estaba: darla por
      // perdida por una navegación a destiempo la borraría del árbol hasta el
      // siguiente arranque.
      if (rel !== "" && d.reached) gaveUp.current.add(rel);
      return;
    }
    setRoot((prev) => setChildrenAt(prev, rel, d.children ?? []));
    setLinks((prev) => ({ ...prev, ...(d.links ?? {}) }));
    // Todo lo que aparece en una respuesta fresca está confirmado: si algo
    // había quedado marcado como perdido por error, ya no aplica.
    for (const c of d.children ?? []) gaveUp.current.delete(c.rel);
  }

  /**
   * Recarga completa y SIN reconciliar, solo para el primer montaje y para el
   * toggle de «Ocultos»: ahí cualquier subárbol ya cargado quedó filtrado con
   * el valor anterior de `showHidden`, así que conservarlo sería mostrar
   * datos obsoletos en vez de refrescarlos.
   */
  async function hardReload(hidden = showHidden) {
    inflight.current.clear();
    gaveUp.current.clear();
    const d = await fetchDir("", hidden);
    if (!d.ok) return; // la raíz del vault siempre es válida; esto no debería pasar
    setRoot(d.children ?? []);
    setVault(d.vault ?? "");
    setLinks(d.links ?? {});
    // Solo en el primer arranque de verdad: si hubo preferencia guardada,
    // manda ella, aunque esté vacía.
    if (!stored.current) setOpen(new Set(d.defaultOpen ?? []));
  }

  /** Pide los hijos de `rel` solo si todavía no se pidieron (y no se rindió ya). */
  function ensureDir(rel: string): Promise<void> {
    if (rel === "") {
      if (rootRef.current.length > 0) return Promise.resolve();
    } else if (findNode(rootRef.current, rel)?.children !== undefined || gaveUp.current.has(rel)) {
      return Promise.resolve();
    }
    const existing = inflight.current.get(rel);
    if (existing) return existing;
    const p = refreshDir(rel).finally(() => { inflight.current.delete(rel); });
    inflight.current.set(rel, p);
    return p;
  }

  /**
   * Las tres rutas de un nodo.
   *
   * `abs` es la ruta dentro del vault; `real` solo difiere cuando el nodo cuelga
   * de una carpeta montada por symlink. Ahí «ruta absoluta» es ambiguo, así que
   * se ofrecen las dos en vez de
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

  useEffect(() => { hardReload(showHidden); }, [showHidden]);
  // Lo que llegue a `open` — de localStorage, del default de arquitectura, de
  // abrir una carpeta a mano, o del reveal — se carga en cuanto le falten
  // hijos. `ensureDir` deduplica: si ya se pidió o ya está cargada, no hace
  // nada.
  useEffect(() => {
    for (const rel of open) ensureDir(rel);
  }, [open, root]);
  useEffect(() => {
    // `.catch` por lo mismo que `fetchDir`: si la página navega mientras esto
    // está en vuelo, el rechazo saldría al overlay. Sin categorías el árbol
    // sigue siendo usable.
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => setCats(d.categories ?? []))
      .catch(() => { /* sin respuesta: se queda la lista que hubiera */ });
  }, []);

  // El reveal necesita el árbol cargado hasta ese punto, no solo `open`
  // marcado — sin los nodos intermedios en el estado, no hay dónde
  // engancharle los hijos al último tramo. `ensureDirRef` evita la clausura
  // vieja del mismo modo que `loadRef`/`refreshDirRef` más abajo.
  const ensureDirRef = useRef(ensureDir);
  ensureDirRef.current = ensureDir;

  // Breadcrumb click: expand every folder along the path and select the last.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const rel = (e as CustomEvent<string>).detail;
      if (!rel) return;
      const segs = rel.split("/");
      const trail = segs.map((_, i) => segs.slice(0, i + 1).join("/"));
      (async () => {
        // De arriba hacia abajo: un nivel solo puede engancharse una vez que
        // su padre ya existe en el árbol del cliente.
        for (const t of trail) await ensureDirRef.current(t);
        setOpen((p) => { const n = new Set(p); trail.forEach((t) => n.add(t)); return n; });
        setSelDir(rel);
        requestAnimationFrame(() => {
          boxRef.current?.querySelector(".row.sel")?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      })();
    };
    window.addEventListener(REVEAL_EVENT, onReveal as EventListener);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal as EventListener);
  }, []);

  // Reveal whichever note is open: expand its folders so the highlight is
  // actually visible rather than buried in a collapsed branch. La rama de la
  // nota activa puede no estar cargada todavía, así que su ruta se resuelve
  // en el servidor en vez de buscarla en el árbol que ya tiene el cliente.
  const activeId = tabs?.activeId ?? null;
  useEffect(() => {
    if (!activeId) { setActiveTrail(new Set()); return; }
    let cancelled = false;
    (async () => {
      let rel: string | null;
      try {
        const r = await fetch(`/api/tree/resolve?id=${encodeURIComponent(activeId)}`);
        ({ rel } = (await r.json()) as { rel: string | null });
      } catch {
        return; // misma historia que en `fetchDir`: sin respuesta no hay rastro que marcar
      }
      if (!rel || cancelled) return;
      const segs = rel.split("/").slice(0, -1);
      const trail = segs.map((_, i) => segs.slice(0, i + 1).join("/"));
      for (const t of trail) await ensureDirRef.current(t);
      if (cancelled) return;
      if (trail.length) setOpen((p) => { const n = new Set(p); trail.forEach((t) => n.add(t)); return n; });
      setActiveTrail(new Set(trail));
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  /**
   * Refresco automático: el servidor vigila el vault y avisa por SSE.
   *
   * Hasta ahora el árbol solo se releía tras una acción propia (crear, mover,
   * borrar), así que un archivo creado desde Obsidian, desde la terminal
   * integrada o por un agente no aparecía hasta recargar la página — con la
   * app de escritorio abierta todo el día, eso significa un árbol
   * permanentemente desfasado.
   *
   * `refreshDir` se lee por referencia dentro del handler para que el
   * EventSource se abra una sola vez en la vida del componente: incluirlo en
   * las dependencias reconectaría en cada render. Cada cambio solo refresca
   * la carpeta padre del archivo que cambió, y solo si esa carpeta ya estaba
   * cargada — una carpeta nunca abierta no necesita refresco, se pedirá
   * fresca la primera vez que se abra.
   */
  const refreshDirRef = useRef(refreshDir);
  refreshDirRef.current = refreshDir;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string[] = [];
    const es = new EventSource("/api/watch");
    es.addEventListener("change", (e) => {
      try {
        const { rels } = JSON.parse((e as MessageEvent).data) as { rels?: string[] };
        if (rels?.length) pending.push(...rels);
      } catch { /* payload inesperado: se ignora, el siguiente evento lo intenta de nuevo */ }
      // El servidor ya agrupa a 250 ms; este segundo margen absorbe la ráfaga
      // de un `git checkout` o de un guardado masivo sin encadenar fetches.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const dirs = new Set(pending.map((rel) => {
          const i = rel.lastIndexOf("/");
          return i < 0 ? "" : rel.slice(0, i);
        }));
        pending = [];
        for (const dir of dirs) {
          if (dir === "" || findNode(rootRef.current, dir)?.children !== undefined) {
            refreshDirRef.current(dir);
          }
        }
      }, 200);
    });
    // Sin onerror el navegador reconecta solo, que es lo que se quiere; solo
    // se silencia el ruido en consola cuando el servidor se reinicia.
    es.onerror = () => { /* EventSource reintenta por su cuenta */ };
    return () => { if (timer) clearTimeout(timer); es.close(); };
  }, []);

  useEffect(() => {
    const close = () => { setMenu(null); setPinOpen(false); setChatOpen(false); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, []);

  function toggle(rel: string) {
    setOpen((p) => { const n = new Set(p); n.has(rel) ? n.delete(rel) : n.add(rel); return n; });
  }

  /** Carpeta padre de `rel` ("" si es de primer nivel). */
  function parentOf(rel: string): string {
    const i = rel.lastIndexOf("/");
    return i < 0 ? "" : rel.slice(0, i);
  }

  async function createNote(folder: string) {
    setErr("");
    const r = await fetch("/api/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, title: draft, type }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setCreatingIn(null); setDraft(""); await refreshDir(folder);
    router.push(`/note/${encodeURIComponent(d.id)}`); router.refresh();
  }

  async function createCanvas(folder: string) {
    setErr("");
    const r = await fetch("/api/create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, title: draft, format: "canvas" }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? "error"); return; }
    setCanvasIn(null); setDraft(""); await refreshDir(folder);
    tabs?.open(d.id, `${draft.trim()}.canvas`, false); router.refresh();
  }

  function beginCreate(kind: FileTreeCreateKind, folder = selDir) {
    setCreatingIn(kind === "note" ? folder : null);
    setCanvasIn(kind === "canvas" ? folder : null);
    setMkdirIn(kind === "folder" ? folder : null);
    setDraft(""); setErr(""); setMenu(null);
    if (folder) setOpen((p) => new Set(p).add(folder));
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
    await refreshDir(parent);
  }

  /** Mueve `rel` dentro de la carpeta `dest` y repunta los enlaces del vault. */
  async function moveTo(rel: string, dest: string) {
    setErr("");
    if (rel === dest || dest.startsWith(rel + "/")) return;
    if (parentOf(rel) === dest) return;   // ya está ahí
    setMoving(true);
    const r = await fetch("/api/fs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", rel, name: dest }),
    });
    const d = await r.json();
    setMoving(false);
    if (!r.ok) { setErr(d.error ?? t("tree.moveFailed")); return; }
    setOpen((p) => { const n = new Set(p); n.add(dest); return n; });
    await Promise.all([refreshDir(parentOf(rel)), refreshDir(dest)]);
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
    setRenaming(null); setDraft(""); await refreshDir(parentOf(node.rel)); router.refresh();
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
    if (!r.ok) { setErr(d.error ?? t("tree.deleteFailed")); return; }
    setDeleting(null);
    // Sin esto, la carpeta borrada (y cualquier hija que estuviera abierta)
    // se queda en `open` para siempre — inofensivo gracias a `gaveUp`, pero
    // basura que se acumula en localStorage.
    setOpen((p) => {
      let changed = false;
      const n = new Set<string>();
      for (const r2 of p) {
        if (r2 === node.rel || r2.startsWith(`${node.rel}/`)) { changed = true; continue; }
        n.add(r2);
      }
      return changed ? n : p;
    });
    await refreshDir(parentOf(node.rel)); router.refresh();
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
        setChatOpen(false);
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
                  await refreshDir(n.rel);
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
                  autoFocus placeholder={t("tree.folderNamePlaceholder")} value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFolder(n.rel);
                    if (e.key === "Escape") { setMkdirIn(null); setDraft(""); }
                  }}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => createFolder(n.rel)}>{t("common.create")}</button>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => { setMkdirIn(null); setDraft(""); }}>{t("common.cancel")}</button>
                </div>
                {err && <div className="err">{err}</div>}
              </div>
            )}

            {creatingIn === n.rel && (
              <div className="newform" style={{ marginLeft: 4 + depth * 11 }}>
                <input
                  autoFocus placeholder={t("tree.noteTitlePlaceholder")} value={draft}
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
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => createNote(n.rel)}>{t("common.create")}</button>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => setCreatingIn(null)}>{t("common.cancel")}</button>
                </div>
                {err && <div className="err">{err}</div>}
              </div>
            )}

            {canvasIn === n.rel && (
              <div className="newform" style={{ marginLeft: 4 + depth * 11 }}>
                <input
                  autoFocus placeholder={t("tree.canvasTitlePlaceholder")} value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createCanvas(n.rel);
                    if (e.key === "Escape") { setCanvasIn(null); setDraft(""); }
                  }}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => createCanvas(n.rel)}>{t("common.create")}</button>
                  <button className="newbtn" style={{ margin: 0 }} onClick={() => { setCanvasIn(null); setDraft(""); }}>{t("common.cancel")}</button>
                </div>
                {err && <div className="err">{err}</div>}
              </div>
            )}

            {isOpen && (n.children
              ? render(n.children, depth + 1, [...trail, n.rel])
              : <div className="row" style={{ paddingLeft: 4 + (depth + 1) * STEP, opacity: 0.5 }}>{t("common.loading")}</div>)}
          </div>
        );
      }

      return (
        <div
          key={n.rel}
          className={`row ${n.id ? "file" : "other"}${(n.id && n.id === activeId) || activeId === `pdf:${n.rel}` || activeId === `img:${n.rel}` || activeId === `canvas:${n.rel}` ? " current" : ""}`}
          style={pad}
          title={n.rel}
          data-tour-path={n.rel}
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
    <div ref={boxRef} data-tour="file-tree">
      <div className="treehint" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ flex: 1 }}>{moving ? t("tree.moving") : t("tree.hint")}</span>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer", opacity: showHidden ? 1 : 0.6, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} style={{ margin: 0 }} />
          <span>{t("tree.hidden")}</span>
        </label>
      </div>

      {creatingIn === "" && (
        <div className="newform">
          <input
            autoFocus placeholder={t("tree.noteTitlePlaceholder")} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createNote(""); if (e.key === "Escape") setCreatingIn(null); }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => createNote("")}>{t("common.create")}</button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setCreatingIn(null)}>{t("common.cancel")}</button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      )}

      {canvasIn === "" && (
        <div className="newform">
          <input
            autoFocus placeholder={t("tree.canvasTitlePlaceholder")} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createCanvas(""); if (e.key === "Escape") setCanvasIn(null); }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => createCanvas("")}>{t("common.create")}</button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setCanvasIn(null)}>{t("common.cancel")}</button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      )}

      {mkdirIn === "" && (
        <div className="newform">
          <input
            autoFocus placeholder={t("tree.folderNamePlaceholder")} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(""); if (e.key === "Escape") setMkdirIn(null); }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => createFolder("")}>{t("common.create")}</button>
            <button className="newbtn" style={{ margin: 0 }} onClick={() => setMkdirIn(null)}>{t("common.cancel")}</button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      )}

      <div className="tree">{render(root)}</div>

      {menu && createPortal(
        <div className="ctxmenu" data-tour="file-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctxhead">{menu.node.name}</div>
          {!menu.node.dir && <>
            <button data-tour="file-add-chat" onClick={() => {
              const ok = queueTerminalInput(`${menu.node.rel} `);
              setMenu(null);
              if (!ok) alert(t("terminal.chooseFirst"));
            }}>{t("terminal.addToChat")}</button>
            <div className="ctxsub">
              <button onClick={() => setChatOpen((value) => !value)}>{t("terminal.addTo")}</button>
              {chatOpen && <div className="ctxsubmenu">
                {terminalTargets().length === 0 && <div className="ctxhead">{t("terminal.noneOpen")}</div>}
                {terminalTargets().map((target) => <button key={target.id} onClick={() => {
                  queueTerminalInput(`${menu.node.rel} `, target.id); setMenu(null); setChatOpen(false);
                }}>{target.title}</button>)}
              </div>}
            </div>
          </>}
          {menu.node.dir && (
            <button onClick={() => {
              setSelDir(menu.node.rel); beginCreate("note", menu.node.rel);
            }}>{t("tree.newNoteHere")}</button>
          )}
          {menu.node.dir && (
            <button onClick={() => {
              setSelDir(menu.node.rel); beginCreate("canvas", menu.node.rel);
            }}>{t("tree.newCanvasHere")}</button>
          )}
          {menu.node.dir && (
            <button onClick={() => {
              setSelDir(menu.node.rel); beginCreate("folder", menu.node.rel);
            }}>{t("tree.newFolderHere")}</button>
          )}
          {!menu.node.dir && (menu.node.id || /\.pdf$/i.test(menu.node.name)) && (
            <button data-tour="file-open-beside" onClick={() => {
              const sid = menu.node.id ?? `pdf:${menu.node.rel}`;
              const cur = tabs?.activeId;
              setMenu(null);
              if (cur && !cur.startsWith("pdf:")) {
                if (!openBesideInWorkspace(sid, menu.node.name)) alert(t("tree.openBesideBlocked"));
              } else {
                alert(t("tree.openBesideBlocked"));
              }
            }}>{t("tree.openBeside")}</button>
          )}
          {!menu.node.dir && menu.node.id && (
            <div className="ctxsub">
              <button onClick={() => setPinOpen((v) => !v)}>{t("tree.pinTo")}</button>
              {pinOpen && (
                <div className="ctxsubmenu">
                  {cats.length === 0 && <div className="ctxhead">{t("tree.noCategories")}</div>}
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
                  >{t("tree.removeFromAll")}</button>
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
                  {copied === "rel" ? t("tree.copied") : t("tree.copyRelative")}
                </button>
                <button onClick={() => copy(p.abs, "abs")}>
                  {copied === "abs" ? t("tree.copied") : t("tree.copyAbsolute")}
                </button>
                {p.real !== p.abs && (
                  <button onClick={() => copy(p.real, "real")}>
                    {copied === "real" ? t("tree.copied") : t("tree.copyReal")}
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
            <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>{t("tree.confirmDelete")}</h2>
            <p style={{ margin: 0, marginBottom: 24, lineHeight: 1.5, color: "var(--fg-dim)" }}>
              {deleting.notEmptyCount !== undefined ? (
                bold(t("tree.deleteFolderNotEmpty", { name: deleting.node.name, n: deleting.notEmptyCount }))
              ) : (
                bold(t("tree.deleteConfirm", {
                  what: deleting.node.dir ? t("tree.deleteFolderLower") : t("tree.deleteNote"),
                  name: deleting.node.name,
                }))
              )}
            </p>
            {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { setDeleting(null); setErr(""); }}>{t("common.cancel")}</button>
              <button className="danger" onClick={() => doDelete(deleting.node, deleting.notEmptyCount !== undefined)}>{t("tree.delete")}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
