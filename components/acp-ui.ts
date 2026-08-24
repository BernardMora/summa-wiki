import type { UiAction } from "@/src/mcp/tools.ts";

/**
 * Las acciones de interfaz que pide el agente, repartidas a quien pueda
 * obedecerlas.
 *
 * ## Por qué un bus y no una prop
 *
 * Quien recibe la acción es `AgentChat`, que está dentro de un panel. Quien
 * puede abrir una pestaña es `Workspace`, que está por encima; y quien puede
 * mover la cámara es `GraphView`, que está en OTRO panel, hermano del chat y
 * a veces ni montado. No hay ningún ancestro común al que subir el estado sin
 * hacer pasar por él algo que no le incumbe. Es el mismo patrón, y por la
 * misma razón, que `acp-buffers.ts` usa para las escrituras del agente.
 *
 * ## Lo que se recuerda y lo que no
 *
 * `focus_graph` se GUARDA además de emitirse. El caso normal es que el agente
 * abra el grafo y lo enfoque en la misma frase: la pestaña se crea y la vista
 * se monta *después* de que la orden pasara, así que un bus puro la perdería
 * siempre — el grafo aparecería en blanco justo cuando acaba de pedirse que
 * mire a un sitio. Al montarse, `GraphView` lee lo último pendiente y lo
 * aplica.
 *
 * `open_note` no se guarda: abrir una nota se completa en el acto, y repetirlo
 * al montar un panel nuevo reabriría notas viejas sin que nadie lo pidiera.
 */

const listeners = new Set<(action: UiAction) => void>();

/** Última orden de grafo sin aplicar, para la vista que todavía no existía. */
let pendingGraph: UiAction | null = null;

export function publishUiAction(action: UiAction) {
  if (action.kind === "focus_graph") pendingGraph = action;
  listeners.forEach((listener) => listener(action));
}

export function subscribeUiActions(listener: (action: UiAction) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Consume la orden de grafo pendiente. Devolverla dos veces la repetiría. */
export function takePendingGraphAction(): UiAction | null {
  const action = pendingGraph;
  pendingGraph = null;
  return action;
}

export type { UiAction };
