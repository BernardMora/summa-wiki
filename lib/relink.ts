import fs from "node:fs";
import path from "node:path";
import { VAULT } from "./server.ts";
import { EXCLUDE_DIRS } from "@/src/config.ts";

/**
 * Repunta los enlaces markdown del vault cuando un archivo cambia de lugar.
 *
 * Cada enlace se resuelve a su ruta absoluta usando la ubicación VIEJA del
 * emisor, se mapea el destino, y se recalcula la relativa desde la ubicación
 * NUEVA. Parchear rutas relativas con sustitución de texto es lo que rompe
 * enlaces cuando emisor y destino se mueven a la vez — la reorganización de
 * julio se hizo así justamente para evitarlo.
 */

const LINK = /(!?\[[^\]]*\]\()([^)\s]+)(\)|\s+"[^"]*"\))/g;
const nfc = (s: string) => s.normalize("NFC");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(abs).isDirectory(); } catch { continue; } }
    if (isDir) {
      if (path.relative(VAULT, abs).startsWith("05-Projects")) continue;
      walk(abs, out);
    } else if (e.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

/** Resuelve un href relativo a ruta del vault; null si no es interno. */
function resolveHref(baseDirRel: string, href: string): string | null {
  if (/^(https?:|aios:|mailto:|data:|#|\/)/i.test(href)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(href); } catch { return null; }
  const parts: string[] = [];
  for (const seg of `${baseDirRel}/${decoded}`.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return nfc(parts.join("/"));
}

const enc = (p: string) => encodeURI(p).replace(/[?#]/g, (c) => (c === "?" ? "%3F" : "%23"));

/**
 * @param moves  ruta vieja del vault -> ruta nueva del vault
 * @returns      cuántos archivos y cuántos enlaces se reescribieron
 */
export function relink(moves: Map<string, string>): { files: number; links: number } {
  const newOf = (p: string) => moves.get(p) ?? p;
  let files = 0, links = 0;

  for (const abs of walk(VAULT)) {
    const relNow = nfc(path.relative(VAULT, abs).split(path.sep).join("/"));
    // El emisor puede haberse movido él mismo: sus enlaces se resolvían desde
    // la ubicación vieja.
    let oldRel = relNow;
    for (const [from, to] of moves) if (to === relNow) { oldRel = from; break; }

    const oldDir = path.posix.dirname(oldRel);
    const newDir = path.posix.dirname(relNow);
    const text = fs.readFileSync(abs, "utf8");
    let touched = 0;

    const next = text.replace(LINK, (whole, pre: string, href: string, post: string) => {
      const hash = href.indexOf("#");
      const frag = hash > 0 ? href.slice(hash) : "";
      const bare = hash > 0 ? href.slice(0, hash) : href;
      const target = resolveHref(oldDir === "." ? "" : oldDir, bare);
      if (!target) return whole;
      const moved = moves.get(target);
      if (!moved && oldDir === newDir) return whole;      // nada que recalcular
      const finalTarget = moved ?? target;
      const rel = path.posix.relative(newDir === "." ? "" : newDir, finalTarget) || path.posix.basename(finalTarget);
      if (rel === bare) return whole;
      touched++;
      return pre + enc(rel) + frag + post;
    });

    if (touched) { fs.writeFileSync(abs, next, "utf8"); files++; links += touched; }
  }
  return { files, links };
}
