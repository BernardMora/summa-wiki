/**
 * Este archivo es .mjs y NO .ts a propósito.
 *
 * El servidor arranca Next en modo programático (`next({ dev })` en
 * server.ts), así que Next vuelve a leer y resolver ESTE archivo en tiempo de
 * ejecución, dentro de la app empaquetada. Con un `next.config.ts` Next tiene
 * que transpilarlo, y para eso hace `require("typescript")` — un paquete que
 * vive en devDependencies y que electron-builder, con toda la razón, no mete
 * en el .exe. Resultado: la app instalada moría con "Cannot find module
 * 'typescript'" mientras que en desarrollo todo iba bien.
 *
 * Next busca la configuración en el orden next.config.js → .mjs → .ts, así que
 * este archivo gana siempre y el .ts sobraba. En .mjs la configuración es
 * JavaScript plano: cero herramienta de TypeScript en tiempo de ejecución.
 *
 * El JSDoc de abajo da autocompletado en el editor, pero que quede claro que
 * `npm run typecheck` NO mira este archivo: el `include` de tsconfig.json solo
 * abarca .ts y .tsx. Es el precio de sacar la configuración de TypeScript, y
 * se paga a gusto — un config de seis líneas sin comprobar vale menos que una
 * app instalada que no arranca.
 */

/** @type {import("next").NextConfig} */
const config = {
  // Local-only tool: the vault lives outside the project root, and the server
  // reads it with fs at request time. Nothing is bundled or uploaded.
  eslint: { ignoreDuringBuilds: true },

  // `next build` y `next dev` usan .next por defecto, así que una build hecha
  // con el servidor de desarrollo encendido le borra los chunks que todavía
  // tiene mapeados en memoria y toda ruta empieza a devolver 500 con
  // "Cannot find module './873.js'". Se separan los directorios: el script de
  // build fija NEXT_BUILD_DIR y el dev se queda con .next.
  //
  // Ojo: quien CONSUME la build también tiene que fijar NEXT_BUILD_DIR, no
  // solo quien la produce. La app empaquetada lo hace en electron/main.js; sin
  // eso Next buscaría la build en `.next` y no encontraría nada.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
};

export default config;
