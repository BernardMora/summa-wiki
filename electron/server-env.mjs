/**
 * El entorno con el que se lanza `server.ts`, en un solo sitio.
 *
 * Vive aparte de main.js por una razón concreta: la prueba de humo
 * (scripts/smoke-package.mjs) tiene que arrancar el servidor EXACTAMENTE como
 * lo arranca la app instalada, y no puede importar main.js porque ese módulo
 * carga `electron` en su primera línea y no existe fuera de Electron.
 *
 * La primera versión de la prueba repetía estas variables a mano, y eso la
 * volvía inútil justo para el fallo que la motivó: `NODE_ENV` sin definir en
 * el paquete. La prueba lo definía por su cuenta, así que pasaba en verde
 * mientras la app instalada arrancaba Next en modo desarrollo y moría. Una
 * copia de la configuración no prueba la configuración: prueba la copia.
 *
 * @param {object} o
 * @param {boolean} o.isPackaged Si corre desde el .exe instalado.
 * @param {number} o.port Puerto del servidor de páginas; la pty usa port + 1.
 * @param {NodeJS.ProcessEnv} [o.baseEnv] Entorno de partida; por defecto el actual.
 */
export function serverEnv({ isPackaged, port, baseEnv = process.env }) {
  const env = { ...baseEnv, PORT: String(port), UV_THREADPOOL_SIZE: "64" };

  // Electron marca su propio entorno; el hijo debe verse como un `node`
  // cualquiera. Lo demás (npm_*, CLAUDE_CODE_*) lo limpia server.ts por su
  // cuenta antes de abrir cada shell — ver shellEnv() allá.
  for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_")) delete env[k];

  if (!isPackaged) return env;

  /*
   * La app empaquetada tiene que DECIR que lo está. Estas variables no son un
   * detalle de configuración: son la diferencia entre servir la build y
   * intentar compilar desde cero.
   *
   * - NODE_ENV: server.ts decide con `NODE_ENV !== "production"` si arranca
   *   Next en modo desarrollo. Nadie definía la variable dentro del .exe, así
   *   que la app instalada levantaba el modo dev e intentaba compilar `app/` y
   *   `components/` — carpetas que ni siquiera van en el paquete, porque en
   *   producción todo eso ya está compilado dentro de .next-build.
   *
   * - NEXT_BUILD_DIR: next.config.mjs separa el directorio de build del de
   *   desarrollo para que una build no le pise los chunks al `next dev`. El
   *   script `build` fija la variable al PRODUCIR; hay que fijarla igual al
   *   CONSUMIR, o Next busca la build en `.next` y no encuentra nada.
   *
   * - ELECTRON_RUN_AS_NODE: el bucle de arriba lo borró junto al resto de
   *   ELECTRON_*, y aquí vuelve a propósito. Es lo que convierte al propio
   *   binario de Electron en el `node` que ejecuta el servidor, y por eso el
   *   usuario no necesita tener Node instalado. Solo cuando el ejecutable es
   *   el nuestro: con WIKI_NODE apuntando a un node de verdad, sobra.
   */
  env.NODE_ENV = "production";
  env.NEXT_BUILD_DIR = ".next-build";
  if (!baseEnv.WIKI_NODE) env.ELECTRON_RUN_AS_NODE = "1";

  return env;
}

/** Los argumentos de `node` para arrancar el servidor. Mismo motivo que arriba. */
export const SERVER_ARGV = ["--experimental-strip-types", "--no-warnings", "server.ts"];
