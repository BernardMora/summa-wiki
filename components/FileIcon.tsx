"use client";

/**
 * Iconos del explorador, al estilo del tema Seti de VS Code: una silueta por
 * familia de archivo y un color por extensión.
 *
 * SVG en línea y no un paquete de iconos a propósito. Los temas de iconos de
 * VS Code traen entre 400 y 1.000 SVG para cubrir ecosistemas que este vault
 * no toca (Rust, Elixir, Docker, Terraform…). Aquí importan doce formas y el
 * color, que es lo que de verdad hace escaneable una lista: uno no lee el
 * icono de TypeScript, ve azul en la posición de siempre. Añadir una
 * extensión es una línea en COLOR y, si hace falta, otra en SHAPE.
 *
 * Los colores están fijos, no atados a las variables del tema: son identidad
 * del lenguaje (el amarillo de JS, el azul de TS) y deben leerse igual en
 * claro y en oscuro. Solo el icono genérico y las carpetas siguen al tema.
 */

type Shape =
  | "doc" | "code" | "markup" | "style" | "data" | "image" | "pdf"
  | "table" | "archive" | "media" | "font" | "config" | "shell" | "canvas" | "folder";

/** Extensión -> silueta. Lo que no aparece cae en "doc". */
const SHAPE: Record<string, Shape> = {
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code", cjs: "code",
  py: "code", rb: "code", go: "code", rs: "code", java: "code", c: "code",
  h: "code", cpp: "code", cs: "code", php: "code", swift: "code", kt: "code",
  lua: "code", r: "code", sql: "code", ipynb: "code",

  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",

  css: "style", scss: "style", sass: "style", less: "style",

  json: "data", jsonl: "data", yaml: "data", yml: "data", toml: "data",
  plist: "data", xmp: "data",

  md: "doc", mdx: "doc", txt: "doc", rtf: "doc", tex: "doc", docx: "doc", doc: "doc",

  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", bmp: "image", ico: "image", heic: "image", tiff: "image",

  pdf: "pdf",
  csv: "table", tsv: "table", xlsx: "table", xls: "table", numbers: "table",
  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive", dmg: "archive",
  mp4: "media", mov: "media", avi: "media", mkv: "media", webm: "media",
  mp3: "media", wav: "media", m4a: "media", flac: "media", aiff: "media",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
  sh: "shell", zsh: "shell", bash: "shell", fish: "shell", ps1: "shell",
  canvas: "canvas", excalidraw: "canvas",
  env: "config", gitignore: "config", lock: "config", ini: "config", conf: "config",
  pptx: "media", key: "media",
};

/** Extensión -> color. Sin entrada, gris del tema. */
const COLOR: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6",
  js: "#e5c07b", jsx: "#e5c07b", mjs: "#e5c07b", cjs: "#e5c07b",
  json: "#e5c07b", jsonl: "#e5c07b",
  py: "#4b8bbe", ipynb: "#e5813e",
  rb: "#cc342d", go: "#00add8", rs: "#dea584", java: "#e76f00",
  c: "#7aa6da", h: "#7aa6da", cpp: "#7aa6da", cs: "#68217a",
  php: "#8892bf", swift: "#f05138", kt: "#a97bff", lua: "#000080",
  r: "#276dc3", sql: "#dd7f3e", sh: "#89e051", zsh: "#89e051", bash: "#89e051",
  html: "#e34c26", htm: "#e34c26", vue: "#41b883",
  css: "#563d7c", scss: "#c6538c", sass: "#c6538c", less: "#1d365d",
  xml: "#e37933", svg: "#ffb13b",
  yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221",
  md: "#519aba", mdx: "#519aba", txt: "#9aa0a6", tex: "#3d6117",
  pdf: "#d73333",
  docx: "#2b579a", doc: "#2b579a",
  xlsx: "#217346", xls: "#217346", csv: "#217346", tsv: "#217346", numbers: "#217346",
  pptx: "#d24726", key: "#d24726",
  png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4", gif: "#a074c4",
  webp: "#a074c4", avif: "#a074c4", heic: "#a074c4", ico: "#a074c4",
  zip: "#c9a227", tar: "#c9a227", gz: "#c9a227", rar: "#c9a227", "7z": "#c9a227", dmg: "#c9a227",
  mp4: "#c76b9e", mov: "#c76b9e", mkv: "#c76b9e", webm: "#c76b9e", avi: "#c76b9e",
  mp3: "#6ab0a3", wav: "#6ab0a3", m4a: "#6ab0a3", flac: "#6ab0a3", aiff: "#6ab0a3",
  ttf: "#cbcb41", otf: "#cbcb41", woff: "#cbcb41", woff2: "#cbcb41",
  canvas: "#8b74e8", excalidraw: "#8b74e8",
  env: "#6ab0a3", lock: "#9aa0a6", ini: "#9aa0a6", conf: "#9aa0a6", gitignore: "#9aa0a6",
};

/**
 * `.excalidraw.md` y `.tar.gz` son dos extensiones, no una: partir por el
 * último punto los clasificaría como markdown y como gzip. Se miran primero
 * las compuestas que sí cambian el icono.
 */
export function extOf(name: string): string {
  const low = name.toLowerCase();
  if (low.endsWith(".excalidraw.md")) return "excalidraw";
  if (low.endsWith(".tar.gz") || low.endsWith(".tar.bz2")) return "tar";
  // Nombres que son solo extensión: .env, .gitignore.
  if (low.startsWith(".") && !low.slice(1).includes(".")) return low.slice(1);
  return low.includes(".") ? low.split(".").pop()! : "";
}

// Cada silueta es un solo <path> sobre una rejilla de 16, para que todas
// pesen igual en la fila y no haya que alinearlas una por una.
const PATHS: Record<Shape, string> = {
  doc: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5",
  code: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6.6 8.4 5.2 9.9l1.4 1.5 M9.4 8.4l1.4 1.5-1.4 1.5",
  markup: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6.3 8.6 7.6 10l-1.3 1.4 M10.2 8.6 8.9 10l1.3 1.4",
  style: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6 9h4.5 M6 11.2h3",
  data: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6.8 8.3q-1 0-1 1t-.9 1q.9 0 .9 1t1 1 M9.6 8.3q1 0 1 1t.9 1q-.9 0-.9 1t-1 1",
  image: "M2.5 3.5h11v9h-11z M2.5 10.2 6 7l3 2.8L11 8.4l2.5 2.2",
  pdf: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6.2 11.7V8.6h1.2a.9.9 0 0 1 0 1.9H6.2 M9.4 11.7V8.6h1.4",
  table: "M2.5 3.5h11v9h-11z M2.5 6.6h11 M2.5 9.5h11 M6.4 3.5v9",
  archive: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M7.4 2v1.4 M8.6 3.4v1.4 M7.4 4.8v1.4 M8.6 6.2v1.4 M7.4 7.6v1.4",
  media: "M2.5 3.5h11v9h-11z M6.6 6.6 10 8.5l-3.4 1.9z",
  font: "M4 1.5h5L12.5 5v9.5h-8.5z M9 1.5V5h3.5 M6.2 12 8.3 7.6 10.4 12 M6.9 10.6h2.8",
  config: "M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z M8 1.6v1.7 M8 12.7v1.7 M1.6 8h1.7 M12.7 8h1.7 M3.5 3.5l1.2 1.2 M11.3 11.3l1.2 1.2 M3.5 12.5l1.2-1.2 M11.3 4.7l1.2-1.2",
  shell: "M2.5 3h11v10h-11z M4.7 6.4 6.6 8l-1.9 1.6 M8.4 10h3",
  canvas: "M3.2 2.6h3.4v3.4H3.2z M9.4 10h3.4v3.4H9.4z M6.6 4.3h2.4a2 2 0 0 1 2 2v3.7",
  folder: "",   // dibujada aparte: tiene dos estados
};

export function FileIcon({ name, className = "" }: { name: string; className?: string }) {
  const ext = extOf(name);
  const shape = SHAPE[ext] ?? "doc";
  const color = COLOR[ext] ?? "var(--muted)";
  return (
    <svg
      className={`ficon ${className}`} viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke={color} strokeWidth="1.1"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d={PATHS[shape]} />
    </svg>
  );
}

/**
 * Carpeta abierta y cerrada. La abierta se inclina y pierde la tapa, que es
 * el gesto que usa VS Code: a un golpe de vista se ve dónde estás sin leer el
 * chevron.
 */
export function FolderIcon({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`ficon ficon-dir ${className}`} viewBox="0 0 16 16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.1"
      strokeLinecap="round" strokeLinejoin="round"
    >
      {open ? (
        <path d="M1.9 12.8V4.2A.7.7 0 0 1 2.6 3.5h3.1l1.5 1.7h4.7a.7.7 0 0 1 .7.7v1.3 M1.9 12.8l1.8-5h11l-1.8 5z" />
      ) : (
        <path d="M1.9 12.5v-8a.7.7 0 0 1 .7-.7h3.1l1.5 1.7h6.1a.7.7 0 0 1 .7.7v6.3a.7.7 0 0 1-.7.7H2.6a.7.7 0 0 1-.7-.7z" />
      )}
    </svg>
  );
}
