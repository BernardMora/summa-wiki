/**
 * Arma `build/icon.ico` a partir de los PNG que ya están en `build/icons/`.
 *
 *     npm run ico
 *
 * No rasteriza nada: parte de los PNG commiteados. Esa es toda la gracia.
 *
 * La primera versión metía el .ico dentro de make-icon.mjs, y correrlo en
 * Windows salió caro: el rasterizado abre una ventana de 1024×1024 y captura
 * su contenido, pero una pantalla de 1080p no da esa altura, así que
 * `capturePage()` devolvió 1024×860. Como `resize({width, height})` fuerza las
 * dos dimensiones, TODOS los tamaños salieron deformados —la mitad de los
 * píxeles del icono de 32 cambiaron— y el .ico heredó el estropicio sin que
 * nada avisara. Los PNG originales venían de un Mac con pantalla Retina, donde
 * la captura sale al doble y sobra resolución.
 *
 * De ahí la separación: regenerar el logo desde el SVG es una operación que
 * depende de la máquina y hay que hacerla donde se pueda; reconstruir el .ico
 * es determinista y se puede hacer en cualquier sitio.
 *
 * Se corre con Electron solo por `nativeImage`, para el tamaño que falte.
 */
import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ico, ICO_SIZES } from "./ico.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "build", "icons");

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const png = (size) => path.join(ICONS, `icon-${size}.png`);

  /**
   * El PNG más grande disponible, del que salen los tamaños que falten.
   *
   * Se mide en píxeles reales y no por el número del nombre: en los archivos
   * que vienen del Mac, `icon-1024.png` son 2048×2048. Reducir desde el mayor
   * conserva todo el detalle que haya.
   */
  const sources = fs.readdirSync(ICONS)
    .map((f) => f.match(/^icon-(\d+)\.png$/))
    .filter(Boolean)
    .map((m) => ({ size: Number(m[1]), file: path.join(ICONS, m[0]) }));
  if (!sources.length) throw new Error(`no hay PNG en ${ICONS} — corre \`npm run icons\` primero`);

  const biggest = sources.reduce((a, b) => (a.size > b.size ? a : b));
  const base = nativeImage.createFromPath(biggest.file);
  if (base.isEmpty()) throw new Error(`no se pudo leer ${biggest.file}`);

  const { width, height } = base.getSize();
  if (width !== height) {
    throw new Error(`el PNG base no es cuadrado (${width}×${height}): el arte está deformado`);
  }

  const images = ICO_SIZES.map((size) => {
    // Si el tamaño ya existe en disco se usa tal cual; solo se deriva lo que
    // falte. Así el .ico queda hecho de los mismos bytes que ya están
    // commiteados, y no de una segunda reducción distinta.
    if (fs.existsSync(png(size))) return { size, data: fs.readFileSync(png(size)) };

    const data = base.resize({ width: size, height: size, quality: "best" }).toPNG();
    fs.writeFileSync(png(size), data);
    console.log(`  · generado icon-${size}.png desde ${path.basename(biggest.file)} (${width}px)`);
    return { size, data };
  });

  fs.writeFileSync(path.join(ROOT, "build", "icon.ico"), ico(images));
  console.log(`ok · build/icon.ico con ${images.length} tamaños (${ICO_SIZES.join(", ")})`);
  app.quit();
}).catch((e) => { console.error("fallo:", e.message); app.exit(1); });
