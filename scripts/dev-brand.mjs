/**
 * Convierte el Electron de `node_modules` en una app que se llama "Summa Wiki".
 *
 *     npm run brand
 *
 * Por qué hace falta: sin empaquetar, la app que corre ES
 * `node_modules/electron/dist/Electron.app`. `app.setName()` NO la renombra:
 * afecta a `app.getName()` y a la carpeta de userData, y nada más. Es la queja
 * clásica de todo el que desarrolla con Electron.
 *
 * Lo que NO basta: escribir `CFBundleName` y ya. Eso se intentó primero y el
 * Dock siguió diciendo "Electron". El motivo es que LaunchServices cachea el
 * nombre visible indexado por `CFBundleIdentifier`, y el bundle seguía siendo
 * `com.github.Electron` —el mismo ID que ya tenía registrado con el nombre
 * viejo—. Mientras el ID no cambie, macOS sirve su copia en caché y el plist
 * da igual. Por eso aquí se cambia la identidad ENTERA:
 *
 *   - el directorio          Electron.app          → Wiki.app
 *   - el ejecutable          Contents/MacOS/Electron → Contents/MacOS/Wiki
 *   - CFBundleExecutable, CFBundleName, CFBundleDisplayName
 *   - CFBundleIdentifier     com.github.Electron   → BUNDLE_ID
 *   - el icono del Finder    Resources/electron.icns
 *
 * `path.txt` es lo que lee `require("electron")` para saber qué binario
 * lanzar, así que se reescribe también: si no, `npm run desktop` apuntaría a
 * una ruta que ya no existe.
 *
 * Renombrar rompe el sello de la firma ad-hoc del bundle, así que al final se
 * vuelve a firmar. Sin eso macOS puede negarse a abrirla en Apple Silicon.
 *
 * Esto es un parche de DESARROLLO, no la solución: la solución es empaquetar
 * con electron-builder, que escribe todo esto de una vez y con firma de verdad.
 * Se pierde en cada `npm install` porque toca node_modules; por eso está
 * enganchado al `postinstall`. Es idempotente: correrlo dos veces no hace nada
 * la segunda.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).productName ?? "Wiki";

/**
 * ID propio, distinto de `com.github.Electron`. Es la pieza que de verdad
 * despega el nombre viejo de la caché de LaunchServices; sin cambiarlo, todo
 * lo demás de este script es decorativo.
 *
 * `wiki.summa` es el DNS invertido de summa.wiki, que es la convención de
 * Apple. Cambiarlo obliga a macOS a reindexar la app como si fuera nueva, y es
 * justo lo que se quiere cada vez que cambia la marca.
 */
const BUNDLE_ID = "wiki.summa";

const DIST = path.join(ROOT, "node_modules", "electron", "dist");

if (process.platform !== "darwin") {
  console.log("brand: solo aplica en macOS, no se hace nada");
  process.exit(0);
}

// Puede estar recién instalada (`Electron.app`), ya renombrada por una corrida
// anterior (`${NAME}.app`), o renombrada con una MARCA VIEJA — que es lo que
// pasó al pasar de "Wiki" a "Summa". Por eso se busca cualquier `.app` en
// `dist/` en vez de una lista de nombres conocidos: el renombrado de marca no
// puede depender de acordarse de todos los nombres que tuvo antes.
const APP = (fs.existsSync(DIST) ? fs.readdirSync(DIST) : [])
  .filter((f) => f.endsWith(".app"))
  .map((f) => path.join(DIST, f))[0];
if (!APP) {
  console.log("brand: no está node_modules/electron todavía, no se hace nada");
  process.exit(0);
}

// ─── El directorio del bundle ───────────────────────────────────────────────

const target = path.join(DIST, `${NAME}.app`);
if (APP !== target) fs.renameSync(APP, target);

// ─── El ejecutable ──────────────────────────────────────────────────────────

const plist = path.join(target, "Contents", "Info.plist");
const macos = path.join(target, "Contents", "MacOS");
const exe = path.join(macos, NAME);

// Cuál es el ejecutable AHORA se pregunta al plist, no se adivina por nombre:
// puede ser `Electron` recién instalado o el de una marca anterior. `MacOS/`
// solo contiene el binario principal —los helpers viven en Frameworks/—, así
// que si el plist miente, el único archivo del directorio es la respuesta.
if (!fs.existsSync(exe)) {
  let current;
  try {
    current = execFileSync("/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleExecutable", plist], { encoding: "utf8" }).trim();
  } catch { /* plist sin la clave; se cae al listado */ }
  const old = [current && path.join(macos, current), ...fs.readdirSync(macos).map((f) => path.join(macos, f))]
    .find((p) => p && fs.existsSync(p));
  if (!old) {
    console.error(`brand: no encuentro el ejecutable en ${macos}`);
    process.exit(1);
  }
  fs.renameSync(old, exe);
}

// ─── Info.plist ─────────────────────────────────────────────────────────────

const set = (key, value) => {
  // `Set` falla si la clave no existe y `Add` falla si ya existe: se intenta
  // el primero y se cae al segundo. Más simple que consultar antes.
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { stdio: "pipe" });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist], { stdio: "pipe" });
  }
};

set("CFBundleName", NAME);
set("CFBundleDisplayName", NAME);
set("CFBundleExecutable", NAME);
set("CFBundleIdentifier", BUNDLE_ID);

// ─── El icono del Finder ────────────────────────────────────────────────────

// El del Dock lo pone main.js en caliente; este es el del Finder y el
// conmutador de apps. Solo si ya se corrió `npm run icons`.
const icns = path.join(ROOT, "build", `${NAME}.icns`);
if (fs.existsSync(icns)) {
  fs.copyFileSync(icns, path.join(target, "Contents", "Resources", "electron.icns"));
}

// ─── El lanzador ────────────────────────────────────────────────────────────

// `node_modules/electron/index.js` lee esta ruta relativa a `dist/`. Sin
// actualizarla, `npm run desktop` busca un binario que acabamos de renombrar.
fs.writeFileSync(
  path.join(ROOT, "node_modules", "electron", "path.txt"),
  `${NAME}.app/Contents/MacOS/${NAME}`,
);

// ─── Firma y caché del sistema ──────────────────────────────────────────────

// Renombrar el ejecutable y reescribir el plist invalidan el sello ad-hoc.
// Firma superficial (sin --deep): el código anidado —Frameworks, Helpers— no
// se ha tocado y conserva la suya, así que basta con volver a sellar el nivel
// de arriba, y así tarda un segundo en vez de un minuto.
try {
  execFileSync("codesign", ["--force", "--sign", "-", target], { stdio: "pipe" });
} catch (e) {
  console.warn("brand: no se pudo refirmar (puede que aún así abra):", e.message.trim().split("\n")[0]);
}

// LaunchServices cachea por fecha del bundle: sin tocarlo, macOS sigue
// mostrando el nombre viejo aunque el plist ya diga otra cosa.
const now = new Date();
fs.utimesSync(target, now, now);
try {
  execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", target], { stdio: "pipe" });
} catch { /* lsregister es un extra; si no está, basta con tocar el bundle */ }

console.log(
  `brand: ${path.basename(target)} · ${BUNDLE_ID}` +
  `${fs.existsSync(icns) ? " · con icono" : " · sin .icns; corre npm run icons"}`,
);
