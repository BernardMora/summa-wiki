/**
 * Genera los PNG del icono de la app a partir de `public/wiki-icon.svg`.
 *
 *     npm run icons
 *
 * Se corre con Electron, no con Node, y sin dependencias nuevas: el Chromium
 * que ya trae Electron rasteriza el SVG. La alternativa habitual (sharp,
 * resvg, svg2png) mete un módulo nativo más por algo que ocurre una vez cada
 * vez que cambia el logo.
 *
 * Un solo render a 1024 y el resto por `nativeImage.resize`. La primera
 * versión abría una ventana por tamaño para rasterizar cada uno desde el
 * vector — más nítido en teoría — pero crear ventanas de 16 px, transparentes
 * y en ráfaga, mataba el proceso sin mensaje. No vale la pena: el favicon se
 * sirve como SVG (vectorial, perfecto a cualquier tamaño) y estos PNG son para
 * el Dock y el .icns, donde nada baja de 16 px con arte distinto.
 */
import { app, BrowserWindow, nativeImage } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ico, ICO_SIZES } from "./ico.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).productName ?? "Summa";
const SRC = path.join(ROOT, "public", "wiki-icon.svg");
const OUT = path.join(ROOT, "build", "icons");
const BASE = 1024;
// El 48 es de Windows: el Explorador lo usa en la vista de iconos medianos y,
// si falta, escala el de 64 y se ve blando justo en el tamaño más común.
const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

/**
 * Geometría del icono de macOS (Big Sur en adelante).
 *
 * Un icono de app NO ocupa su lienzo entero: el arte vive en un cuadrado de
 * 824 sobre 1024 —80.5%, o sea 100 px de margen por lado— y el resto es
 * transparente. Ese margen es lo que hace que el Dock alinee todos los iconos
 * al mismo tamaño óptico. Un PNG a sangre se dibuja más grande que sus vecinos
 * y se nota de inmediato: es exactamente lo que pasaba aquí.
 */
const BOX = Math.round(BASE * 824 / 1024);
const INSET = Math.round((BASE - BOX) / 2);

/**
 * La esquina de macOS es una SUPERELIPSE, no un `border-radius`.
 *
 * Un rectángulo redondeado pega un arco de círculo a un lado recto y el salto
 * de curvatura se ve —el icono queda con "pelotitas" en las esquinas al lado
 * de los del sistema. La superelipse |x|^n + |y|^n = 1 con n = 5 curva de
 * forma continua y clava la silueta de Apple: su punto a 45° cae en 0.871 del
 * semilado, contra 0.868 del rectángulo de radio 22.5% que Apple documenta.
 *
 * Se emite como polilínea de 720 puntos en vez de con curvas Bézier porque a
 * este tamaño el error de cuerda es de milésimas de píxel y la matemática cabe
 * en cuatro líneas.
 */
function squircle(size, n = 5, steps = 720) {
  const r = size / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = r + r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = r + r * Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, "_render.html");
  // El recorte va aquí y no en el SVG a propósito: `public/wiki-icon.svg` es
  // también el favicon de la web, donde un 20% de margen vacío sería absurdo.
  // El logo se guarda a sangre; el margen y la superelipse son cosa del icono
  // de escritorio, y se aplican solo al generarlo.
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}
    #art{position:absolute;left:${INSET}px;top:${INSET}px;
         width:${BOX}px;height:${BOX}px;clip-path:path("${squircle(BOX)}")}
    #art>svg{display:block;width:100%;height:100%}</style>
    <div id="art">${fs.readFileSync(SRC, "utf8")}</div>`);

  const win = new BrowserWindow({
    width: BASE, height: BASE, show: false, frame: false,
    transparent: true, useContentSize: true,
  });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 500));
  const shot = await win.webContents.capturePage();
  win.destroy();
  fs.rmSync(tmp, { force: true });

  if (shot.isEmpty()) throw new Error("la captura salió vacía");

  /*
   * La captura tiene que ser CUADRADA, y esto no es una comprobación de
   * cortesía: es la que faltaba.
   *
   * `capturePage()` devuelve lo que la ventana pudo ocupar de verdad. En una
   * pantalla de 1080p una ventana de 1024 de alto no cabe, y el resultado salió
   * 1024×860 sin error ninguno. Como el `resize` de abajo fuerza ancho y alto,
   * todos los tamaños se generaron deformados y el estropicio llegó hasta el
   * icono del .exe: la mitad de los píxeles del de 32 habían cambiado, y no
   * había forma de notarlo salvo comparando contra el arte anterior.
   *
   * Mejor romper aquí y regenerar el logo en una máquina con pantalla
   * suficiente que dejar arte degradado en el repositorio. El .ico no depende
   * de esto: se reconstruye desde los PNG con `npm run ico`.
   */
  const got = shot.getSize();
  if (got.width !== got.height) {
    throw new Error(
      `la captura salió ${got.width}×${got.height}, no cuadrada — esta pantalla no da ${BASE}px. ` +
      `Regenera el logo en una pantalla mayor; para rehacer solo el .ico usa \`npm run ico\`.`,
    );
  }

  for (const size of SIZES) {
    const img = size === BASE ? shot : shot.resize({ width: size, height: size, quality: "best" });
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), img.toPNG());
  }
  fs.copyFileSync(path.join(OUT, "icon-512.png"), path.join(ROOT, "build", "icon.png"));

  // El .ico es el candidato de MÁXIMA prioridad que busca electron-builder en
  // build/ (ver iconConverter.js). Con solo los PNG sueltos el empaquetado
  // avisaba "application icon is not set" y metía el átomo de Electron en el
  // .exe. Al existir este archivo no hace falta declarar `win.icon` en
  // package.json: la convención lo encuentra en cada build, para siempre.
  fs.writeFileSync(
    path.join(ROOT, "build", "icon.ico"),
    ico(ICO_SIZES.map((size) => ({ size, data: fs.readFileSync(path.join(OUT, `icon-${size}.png`)) }))),
  );


  // El .icns se arma aquí y no en un script de npm aparte. Antes vivía en
  // `package.json` como una línea de shell con el nombre del producto escrito
  // a mano seis veces; al renombrar la app de "Wiki" a "Summa" quedó generando
  // un archivo que `dev-brand.mjs` ya no buscaba. El nombre tiene UNA fuente
  // —`productName`— y esta es la única parte del pipeline que lo necesita.
  //
  // Solo en macOS: `iconutil` es una herramienta del sistema que no existe en
  // ningún otro lado. Sin esta guarda, `npm run icons` en Windows generaba los
  // PNG y el .ico correctamente y REVENTABA en la última línea, dejando creer
  // que no había producido nada. El .icns ya está commiteado y solo cambia
  // cuando cambia el logo, así que no hace falta regenerarlo desde Windows.
  let icns = "—";
  if (process.platform === "darwin") {
    const iconset = path.join(ROOT, "build", `${NAME}.iconset`);
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset, { recursive: true });
    // iconutil solo acepta esta escalera de tamaños con estos nombres exactos.
    for (const size of [16, 32, 128, 256, 512]) {
      fs.copyFileSync(path.join(OUT, `icon-${size}.png`), path.join(iconset, `icon_${size}x${size}.png`));
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(ROOT, "build", `${NAME}.icns`)]);
    fs.rmSync(iconset, { recursive: true, force: true });
    icns = `build/${NAME}.icns`;
  }

  console.log(
    `ok · ${SIZES.length} tamaños en build/icons/ · base ${shot.getSize().width}px` +
    ` · build/icon.ico (${ICO_SIZES.length}) · ${icns}`,
  );
  app.quit();
}).catch((e) => { console.error("fallo:", e.message); app.exit(1); });
