import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Architecture } from "./architecture.ts";

/**
 * Ingesta: meter carpetas ajenas del disco al vault.
 *
 * ## Por qué hay una pre-pasada determinista antes del agente
 *
 * La carpeta `Documents` de cualquiera tiene miles de archivos, y la inmensa
 * mayoría no requiere ningún juicio: un `.zip` no entra, un `node_modules` no
 * entra, dos copias idénticas del mismo PDF son una sola. Mandarle todo eso a
 * un modelo cuesta horas y dinero para llegar a la misma respuesta que da una
 * extensión. **Al agente solo le llega lo que de verdad hay que leer para
 * decidir.** Es la misma lección que dejó medida la etapa A de la Fase 6.
 *
 * ## Copiar, nunca mover
 *
 * El original se queda donde está, siempre. Un agente reorganizando el
 * `Documents` de alguien in situ es irreversible si sale mal, y "sale mal" aquí
 * incluye que el modelo se equivoque de carpeta — que va a pasar. El ledger es
 * el deshacer.
 */

export const INGEST_VERSION = 1;

/** Qué hacer con un archivo, decidido sin leerlo. */
export type Kind =
  /** Markdown o texto: entra como nota, y el agente decide dónde. */
  | "note"
  /** PDF, docx, presentación: entra tal cual, con nota compañera (spec §6). */
  | "source"
  /** Imagen: entra como asset. */
  | "image"
  /** No entra. `reason` dice por qué. */
  | "skip";

export interface ScannedFile {
  abs: string;
  /** Ruta relativa a la carpeta de origen que la contiene. */
  rel: string;
  size: number;
  ext: string;
  kind: Kind;
  reason?: string;
  /** Solo para lo que entra: sha1 del contenido, para detectar duplicados. */
  hash?: string;
  /** Ruta del archivo idéntico ya visto, si este es una copia. */
  duplicateOf?: string;
}

export interface ScanResult {
  files: ScannedFile[];
  /** Conteos por tipo, para la vista previa. */
  counts: Record<Kind, number>;
  bytes: number;
  duplicates: number;
  /** Carpetas que se pidieron y no se pudieron leer. */
  unreadable: string[];
  truncated: boolean;
  /** Por qué se cortó: qué decirle al usuario para que pueda arreglarlo. */
  truncatedBy?: "files" | "time";
  /** Cuánto tardó, para poder decirlo en la interfaz. */
  ms: number;
}

const NOTE_EXT = new Set([".md", ".markdown", ".txt", ".text"]);
const SOURCE_EXT = new Set([".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".epub", ".rtf", ".odt"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg", ".tiff", ".bmp"]);

/**
 * Carpetas en las que no se entra nunca.
 *
 * `node_modules` y `.git` por volumen; `Library` y `.Trash` porque en macOS
 * están dentro del home y nadie que elija su home quiere eso; los directorios
 * de la propia app para no ingerir el vault dentro de sí mismo.
 */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "Library", ".Trash", "$RECYCLE.BIN",
  "__pycache__", "venv", ".venv", "dist", "build", ".next", "target",
  "Applications", "System", ".summa", ".claude", ".obsidian",
]);

const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "Icon\r"]);

/** Un archivo más grande que esto no es una nota ni una fuente que valga copiar. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Tope duro de archivos escaneados.
 *
 * Existe para que elegir el home por error no cuelgue la app durante minutos
 * antes de decir nada. Si se alcanza, se avisa en vez de mentir con un número
 * parcial que parece completo.
 */
const MAX_FILES = 20_000;

/**
 * Presupuesto de tiempo del recorrido.
 *
 * El tope de archivos no basta: una carpeta montada en red o en la nube puede
 * tardar segundos en listar UN directorio, y con eso 200 archivos ya son varios
 * minutos sin que el tope se acerque. Un análisis que no vuelve es peor que uno
 * incompleto — el incompleto al menos se puede acotar y repetir.
 */
const TIME_BUDGET_MS = 20_000;

function classify(name: string, size: number): { kind: Kind; ext: string; reason?: string } {
  const ext = path.extname(name).toLowerCase();
  if (SKIP_FILES.has(name)) return { kind: "skip", ext, reason: "ruido del sistema" };
  if (name.startsWith(".")) return { kind: "skip", ext, reason: "archivo oculto" };
  if (size > MAX_FILE_BYTES) return { kind: "skip", ext, reason: "más de 100 MB" };
  if (size === 0) return { kind: "skip", ext, reason: "vacío" };
  if (NOTE_EXT.has(ext)) return { kind: "note", ext };
  if (SOURCE_EXT.has(ext)) return { kind: "source", ext };
  if (IMAGE_EXT.has(ext)) return { kind: "image", ext };
  return { kind: "skip", ext, reason: ext ? `no se ingiere ${ext}` : "sin extensión" };
}

/**
 * Huella de contenido para detectar copias.
 *
 * Lee como mucho `HASH_BYTES` del principio del archivo y mezcla el tamaño. Dos
 * archivos con el mismo tamaño y el mismo primer megabyte son la misma copia a
 * efectos prácticos; y a cambio, un PDF de 90 MB cuesta leer 1 MB en vez de 90.
 *
 * Importa más de lo que parece: leer el archivo entero es lo que colgaba el
 * análisis sobre carpetas respaldadas en la nube —Drive, iCloud—, donde cada
 * lectura de un archivo que solo existe en el servidor dispara una descarga y
 * bloquea segundos. Con miles de archivos, eso es una espera sin final visible.
 */
const HASH_BYTES = 1024 * 1024;

function hashOf(abs: string, size: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(size, HASH_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return crypto.createHash("sha1").update(String(size)).update(buf).digest("hex");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ya cerrado */ } }
  }
}

export function scanFolders(folders: string[], vault: string): ScanResult {
  const t0 = Date.now();
  const files: ScannedFile[] = [];
  const unreadable: string[] = [];
  let truncated = false;
  let truncatedBy: ScanResult["truncatedBy"];
  const vaultAbs = path.resolve(vault);

  // ---- Pasada 1: recorrer. No se lee ni un byte de contenido.
  const walk = (root: string, dir: string) => {
    if (truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable.push(dir);
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      const abs = path.join(dir, e.name);
      // El vault nunca se ingiere a sí mismo: elegir una carpeta que lo
      // contiene duplicaría todas las notas dentro de la bandeja.
      if (abs === vaultAbs || abs.startsWith(vaultAbs + path.sep)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(root, abs);
        continue;
      }
      // Los symlinks se saltan: seguirlos puede salirse de la carpeta elegida
      // —o ciclar— y quien eligió esa carpeta no pidió lo que hay al otro lado.
      if (!e.isFile()) continue;
      if (files.length >= MAX_FILES) { truncated = true; truncatedBy = "files"; return; }
      if (Date.now() - t0 > TIME_BUDGET_MS) { truncated = true; truncatedBy = "time"; return; }

      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      const { kind, ext, reason } = classify(e.name, size);
      files.push({ abs, rel: path.relative(root, abs), size, ext, kind, reason });
    }
  };

  for (const folder of folders) {
    const root = path.resolve(folder);
    try {
      if (!fs.statSync(root).isDirectory()) { unreadable.push(root); continue; }
    } catch { unreadable.push(root); continue; }
    walk(root, root);
  }

  // ---- Pasada 2: duplicados, agrupando primero por TAMAÑO.
  //
  // Dos archivos de distinto tamaño no pueden ser copias, así que un tamaño
  // único descarta el duplicado sin abrir nada. Solo se leen los que comparten
  // tamaño con otro, que en un corpus normal son un puñado.
  //
  // La versión anterior hasheaba TODO lo que entraba, leyendo cada archivo
  // entero durante el recorrido. Sobre una carpeta respaldada en la nube eso es
  // una descarga por archivo, y el análisis se quedaba sin volver.
  const bySize = new Map<number, ScannedFile[]>();
  for (const f of files) {
    if (f.kind === "skip") continue;
    const g = bySize.get(f.size);
    if (g) g.push(f); else bySize.set(f.size, [f]);
  }

  let duplicates = 0;
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const seen = new Map<string, string>();
    for (const f of group) {
      f.hash = hashOf(f.abs, f.size);
      if (!f.hash) continue;
      const prev = seen.get(f.hash);
      if (prev) { f.duplicateOf = prev; duplicates++; }
      else seen.set(f.hash, f.abs);
    }
  }

  const counts: Record<Kind, number> = { note: 0, source: 0, image: 0, skip: 0 };
  let bytes = 0;
  for (const f of files) {
    if (f.duplicateOf) continue;
    counts[f.kind]++;
    if (f.kind !== "skip") bytes += f.size;
  }

  return { files, counts, bytes, duplicates, unreadable, truncated, truncatedBy, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ plan

export interface Action {
  from: string;
  /** Ruta destino, relativa al vault. */
  to: string;
  kind: Exclude<Kind, "skip">;
}

export interface Plan {
  actions: Action[];
  skipped: { abs: string; reason: string }[];
  duplicates: number;
}

/** Nombre de archivo en slug, como pide la spec §3. */
export function slugify(name: string): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  const slug = base
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return (slug || "sin-nombre") + ext.toLowerCase();
}

/**
 * Dónde cae cada archivo. **Todo aterriza en la bandeja**, conservando la
 * estructura de carpetas de origen.
 *
 * Repartirlo aquí sería adivinar: la ruta de origen no dice si un documento es
 * un proyecto o una referencia, y es justo la decisión para la que existe el
 * agente. Lo que sí hace esta función es dejarlo todo en un sitio conocido,
 * con nombre válido y sin colisiones, para que el agente mueva desde ahí.
 */
export function planIngest(scan: ScanResult, arch: Architecture): Plan {
  const actions: Action[] = [];
  const skipped: { abs: string; reason: string }[] = [];
  const used = new Set<string>();
  const inbox = arch.inbox.replace(/\/$/, "");

  for (const f of scan.files) {
    if (f.kind === "skip") { skipped.push({ abs: f.abs, reason: f.reason ?? "" }); continue; }
    if (f.duplicateOf) { skipped.push({ abs: f.abs, reason: `copia de ${f.duplicateOf}` }); continue; }

    const dir = path.dirname(f.rel);
    const parts = dir === "." ? [] : dir.split(path.sep).map((d) => slugify(d));
    // Las imágenes van a `assets/` de su carpeta, no sueltas junto a las notas
    // (spec §7). No es cosmético: una carpeta de origen con doscientas fotos y
    // tres notas deja la bandeja ilegible justo cuando hay que decidir qué es
    // cada cosa, y el agente pierde de vista las notas entre las fotos. Ahí
    // dentro, además, ya están en el sitio que la nota destino va a necesitar:
    // moverlas es cambiar de carpeta, no inventarse una convención.
    const bucket = f.kind === "image" ? [...parts, "assets"] : parts;
    let to = [inbox, ...bucket, slugify(path.basename(f.rel))].join("/");

    // Dos archivos distintos con el mismo nombre en la misma carpeta destino:
    // se numera en vez de pisar. Pasa en cuanto dos carpetas de origen tienen
    // un `notas.md` cada una.
    if (used.has(to)) {
      const ext = path.extname(to);
      const base = to.slice(0, to.length - ext.length);
      let n = 2;
      while (used.has(`${base}-${n}${ext}`)) n++;
      to = `${base}-${n}${ext}`;
    }
    used.add(to);
    actions.push({ from: f.abs, to, kind: f.kind });
  }

  return { actions, skipped, duplicates: scan.duplicates };
}

// ------------------------------------------------------------------ apply

export interface Ledger {
  version: number;
  startedAt: string;
  finishedAt: string;
  vault: string;
  architecture: string;
  sources: string[];
  /** Lo que de verdad se escribió. Es el deshacer y la auditoría. */
  copied: { from: string; to: string; kind: string }[];
  companions: string[];
  skipped: { abs: string; reason: string }[];
  errors: { from: string; error: string }[];
}

const COMPANION_HEADER = `<!-- ai -->
Nota compañera generada al ingerir el archivo. El contenido del documento **no
se ha leído**: esto es solo el registro de que existe y dónde está. Resume aquí
lo que valga la pena, o pide que se le pase OCR.
<!-- /ai -->`;

/** Fecha local: `toISOString()` daría UTC y estamparía mañana desde Tijuana. */
function today(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

/**
 * Ejecuta el plan. Copia, nunca mueve; nunca sobrescribe.
 *
 * `created` no se inventa (spec §5): se deja **vacío**. El `mtime` del archivo
 * de origen dice cuándo se tocó por última vez, no cuándo se escribió, y esa
 * distinción ya costó una auditoría entera en la Fase 0.
 */
export function applyPlan(plan: Plan, vault: string, arch: Architecture, sources: string[]): Ledger {
  const startedAt = new Date().toISOString();
  const copied: Ledger["copied"] = [];
  const companions: string[] = [];
  const errors: Ledger["errors"] = [];

  for (const a of plan.actions) {
    const dst = path.join(vault, a.to);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) { errors.push({ from: a.from, error: "el destino ya existía" }); continue; }
      fs.copyFileSync(a.from, dst);
      copied.push({ from: a.from, to: a.to, kind: a.kind });

      // Un PDF no entra al grafo; su nota compañera sí (spec §6).
      if (a.kind === "source") {
        const note = a.to.replace(/\.[^./]+$/, "") + ".md";
        const noteAbs = path.join(vault, note);
        if (!fs.existsSync(noteAbs)) {
          const title = path.basename(a.from, path.extname(a.from));
          fs.writeFileSync(noteAbs, [
            "---",
            "type: source",
            `title: ${JSON.stringify(title)}`,
            "created:",
            `updated: ${today()}`,
            "author: agent",
            `resource: ${path.basename(a.to)}`,
            "---",
            "",
            `# ${title}`,
            "",
            COMPANION_HEADER,
            "",
          ].join("\n"), "utf8");
          companions.push(note);
        }
      }
    } catch (e) {
      errors.push({ from: a.from, error: (e as Error).message });
    }
  }

  return {
    version: INGEST_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    vault,
    architecture: arch.id,
    sources,
    copied,
    companions,
    skipped: plan.skipped,
    errors,
  };
}

export function ledgerPath(vault: string, at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(vault, ".summa", `ingest-${stamp}.json`);
}

export function writeLedger(vault: string, ledger: Ledger): string {
  const file = ledgerPath(vault, new Date(ledger.startedAt));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return file;
}
