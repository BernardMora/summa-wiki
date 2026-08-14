/**
 * Empaqueta varios PNG en un único .ico.
 *
 * Vive aparte de make-icon.mjs porque son dos trabajos con requisitos muy
 * distintos: rasterizar el SVG necesita un Chromium con una pantalla capaz de
 * dar 1024 px, y esto no necesita nada. Separarlos permite reconstruir el .ico
 * en cualquier máquina a partir de los PNG ya commiteados, sin arriesgarse a
 * re-renderizar peor de lo que estaba.
 *
 * Se escribe a mano porque el formato es un encabezado de 6 bytes más una
 * tabla de entradas de 16, y meter una dependencia (png-to-ico y compañía)
 * para eso contradice la nota de make-icon.mjs sobre no añadir módulos por
 * algo que pasa una vez cada vez que cambia el logo.
 *
 * Los PNG se incrustan tal cual, sin convertir a BMP. Windows admite entradas
 * comprimidas en PNG desde Vista y Electron 43 ya solo arranca en Windows 10,
 * así que el camino BMP —tres veces más código, con su máscara AND invertida—
 * no compraría compatibilidad con ningún sistema que esta app soporte.
 *
 * @param {{size: number, data: Buffer}[]} images
 * @returns {Buffer}
 */
export function ico(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const head = Buffer.alloc(HEADER);
  head.writeUInt16LE(0, 0);            // reservado
  head.writeUInt16LE(1, 2);            // 1 = icono (2 sería cursor)
  head.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(ENTRY);
    // 256 se codifica como 0: el campo es de un byte y no llega a 256.
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                // paleta: ninguna
    e.writeUInt8(0, 3);                // reservado
    e.writeUInt16LE(1, 4);             // planos
    e.writeUInt16LE(32, 6);            // bits por píxel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

/** Lo que entra en el .ico. Por encima de 256 el formato no define nada. */
export const ICO_SIZES = [16, 32, 48, 64, 128, 256];
