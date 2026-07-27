import type { NextConfig } from "next";

const config: NextConfig = {
  // Local-only tool: the vault lives outside the project root, and the server
  // reads it with fs at request time. Nothing is bundled or uploaded.
  eslint: { ignoreDuringBuilds: true },

  // `next build` y `next dev` usan .next por defecto, así que una build hecha
  // con el servidor de desarrollo encendido le borra los chunks que todavía
  // tiene mapeados en memoria y toda ruta empieza a devolver 500 con
  // "Cannot find module './873.js'". Se separan los directorios: el script de
  // build fija NEXT_BUILD_DIR y el dev se queda con .next.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
};

export default config;
