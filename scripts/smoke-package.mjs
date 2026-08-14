/**
 * Prueba de humo del artefacto EMPAQUETADO.
 *
 * Por qué existe: los tres errores que rompieron la primera build de Windows
 * —`lib/` sin empaquetar, `typescript` ausente, Next arrancando en modo
 * desarrollo— compartían la misma forma. Los tres funcionaban perfectamente
 * con `npm run dev` y los tres solo se manifestaban después de instalar,
 * porque el paquete corre con OTRO cwd, OTRO node y OTRO conjunto de archivos
 * que el repositorio. Ninguna prueba sobre el código fuente los podía ver.
 *
 * Así que esto no prueba el código: prueba el .exe. Levanta el servidor
 * exactamente como lo levanta electron/main.js cuando `app.isPackaged` —mismo
 * binario, mismo cwd, mismo entorno— y comprueba que responde. Es la
 * diferencia entre enterarse en CI y enterarse por un usuario.
 *
 * Se queda en la capa del servidor a propósito, sin abrir ventana: el fallo
 * que importa es el arranque, y una prueba que necesita GUI no corre en CI.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "dist", "win-unpacked", "resources", "app");
const EXE = path.join(ROOT, "dist", "win-unpacked", "Summa Wiki.exe");

// Un puerto poco habitual, no el 4321: la idea es no chocar con un `npm run
// dev` que el desarrollador tenga abierto mientras empaqueta.
const PORT = 43219;

function fail(msg, detail = "") {
  console.error(`\n  ✗ ${msg}`);
  if (detail) console.error(`\n${detail.trim()}\n`);
  process.exit(1);
}

for (const [label, p] of [["la app empaquetada", APP], ["el ejecutable", EXE]]) {
  if (!existsSync(p)) fail(`No se encontró ${label}: ${p}`, "Corre `electron-builder --win` antes que esto.");
}

// Del paquete, no del repositorio: así esta línea comprueba de paso que el
// módulo llegó al .exe, y garantiza que se arranca con el código que se
// instala y no con el que está en el árbol de trabajo.
const { serverEnv, SERVER_ARGV } = await import(
  pathToFileURL(path.join(APP, "electron", "server-env.mjs")).href
);

/** ¿Responde el servidor? Cualquier respuesta HTTP vale: se prueba el arranque. */
async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: "manual" });
    return r.status;
  } catch {
    return null;
  }
}

console.log("  • arrancando el servidor empaquetado…");

// El entorno NO se escribe aquí: se pide a la misma función que usa main.js,
// con isPackaged en true. Es lo que hace que esta prueba valga — una lista de
// variables copiada a mano habría pasado en verde mientras la app instalada
// arrancaba en modo desarrollo, porque la copia tendría el NODE_ENV que al
// original le faltaba.
//
// WIKI_NODE se quita del entorno de partida a propósito: si quien empaqueta lo
// tiene exportado, la prueba usaría su node en vez del Electron del paquete, y
// dejaría sin comprobar justo el camino que recorre el usuario.
const { WIKI_NODE, ...baseEnv } = process.env;
const env = serverEnv({ isPackaged: true, port: PORT, baseEnv });

const server = spawn(EXE, SERVER_ARGV, {
  cwd: APP,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
const keep = (b) => { log += b.toString(); if (log.length > 8000) log = log.slice(-8000); };
server.stdout.on("data", keep);
server.stderr.on("data", keep);

let exited = null;
server.on("exit", (code) => { exited = code; });

const stop = () => {
  if (exited !== null || !server.pid) return;
  // taskkill /T: el servidor abre sus propios hijos (las shells de la pty), y
  // matar solo al padre los dejaría huérfanos ocupando el puerto.
  spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
};

const deadline = Date.now() + 90_000;
let status = null;

while (Date.now() < deadline) {
  if (exited !== null) {
    fail(`El servidor murió al arrancar (código ${exited}).`, log);
  }
  status = await ping();
  if (status !== null) break;
  await new Promise((r) => setTimeout(r, 300));
}

if (status === null) {
  stop();
  fail("El servidor no respondió en 90 s.", log);
}

// Un 500 significa que arrancó pero no puede servir — build incompleta, un
// import que resuelve en dev y no en el paquete. Cuenta como fallo aunque el
// proceso siga vivo. Un 3xx hacia /setup es correcto: es la app sin vault.
if (status >= 500) {
  stop();
  fail(`El servidor respondió ${status}.`, log);
}

stop();
console.log(`  ✓ el servidor empaquetado responde (HTTP ${status})`);
