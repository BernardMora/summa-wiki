import { splitBold } from "@/src/match.ts";

/**
 * Pinta el `**negritas**` que llevan algunos mensajes traducidos.
 *
 * Existe porque hay frases donde el énfasis es del contenido, no del diseño:
 * «se **copian**: los originales no se tocan» pierde el sentido sin la negrita,
 * y partir el mensaje en tres claves para meter un `<strong>` en medio produce
 * traducciones imposibles — el orden de las palabras cambia con el idioma y los
 * trozos dejan de encajar.
 *
 * `app/page.tsx` tiene su propia copia de dos líneas para los textos de la
 * arquitectura; esta es la del lado del cliente. No se comparten porque aquella
 * es un componente de servidor y esto se importa desde componentes de cliente.
 */
export function bold(text: string) {
  return splitBold(text).map((c, i) => (c.bold ? <strong key={i}>{c.text}</strong> : c.text));
}
