import fs from "node:fs";
import path from "node:path";
import type { Architecture } from "../architecture.ts";
import { IDENTIDAD } from "./identidad.ts";
import { PARA } from "./para.ts";
import { PLANO } from "./plano.ts";

/**
 * Los paquetes que trae la app. El usuario elige uno al crear un vault.
 *
 * Un registro en código y no una carpeta de JSON que se lee en tiempo de
 * ejecución: hay que enumerarlos para pintar el selector, y un `readdir` sobre
 * una ruta relativa al módulo es exactamente lo que se rompe al empaquetar el
 * `.app` — el archivo no queda rastreado y el fallo aparece donde no hay dónde
 * depurarlo. Importarlos hace que el empaquetador los siga solo.
 *
 * Que sean tres, y que apuesten cosas distintas, es a propósito: `identidad`
 * ordena por preguntas que no cambian, `para` por accionabilidad —una nota se
 * muda cuando cambia su estado— y `plano` renuncia a que la carpeta signifique
 * algo. Un selector con tres variantes de lo mismo no sería una elección.
 */
export const PACKS: Architecture[] = [IDENTIDAD, PARA, PLANO];

/** El que se usa cuando el vault no declara ninguno. */
export const DEFAULT_PACK = IDENTIDAD;

export function getPack(id: string): Architecture | undefined {
  return PACKS.find((p) => p.id === id);
}

export { IDENTIDAD, PARA, PLANO };

/**
 * Carga la arquitectura del vault, con el paquete de identidad como respaldo.
 *
 * Vive en el registro y no en `src/architecture.ts` porque necesita conocer
 * los paquetes, y `architecture.ts` es el CONTRATO: los paquetes lo importan a
 * él. Tenerlo allá cerraba un ciclo con un valor —`ARCHITECTURE_VERSION`— que
 * TypeScript no marca y que revienta al arrancar con "Cannot access before
 * initialization". Los tipos se borran al compilar; las constantes no.
 *
 * Recibe la ruta del vault en vez de importarla de `src/config.ts` para no
 * cerrar el otro ciclo posible: config define VAULT y necesita la arquitectura
 * para construir los bundles.
 *
 * Tolerante a propósito: un archivo corrupto o a medio escribir cae al
 * respaldo en vez de tumbar la app. Perder las categorías propias por un JSON
 * mal cerrado es malo; no poder abrir el wiki es peor.
 */
export function loadArchitecture(vault: string): Architecture {
  const file = path.join(vault, ".summa", "architecture.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return DEFAULT_PACK;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_PACK;

  // Fusión superficial contra el respaldo: una arquitectura escrita a mano a
  // la que le falte una clave nueva sigue funcionando, en vez de quedarse sin
  // categorías o sin bundles porque el archivo se escribió con una versión
  // anterior del formato.
  return { ...DEFAULT_PACK, ...(raw as Partial<Architecture>) };
}
