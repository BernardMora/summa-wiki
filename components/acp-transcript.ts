import type * as acp from "@agentclientprotocol/sdk";
import type { AcpConversation, AcpPromptImage, AcpServerMessage } from "@/src/acp/wire.ts";

/**
 * Pliega el chorro de mensajes del servidor en algo que se pueda pintar.
 *
 * ## Por qué es una función pura y vive fuera del componente
 *
 * Porque es la única parte de esta pantalla donde puede haber un error de
 * verdad, y así se puede probar sin navegador ni agente. Lo que llega no es
 * texto: son ~15 tipos de `session/update`, con trozos de mensaje que hay que
 * agrupar, llamadas a herramienta que se anuncian primero y se completan
 * después, y planes que se reemplazan enteros. El componente solo dibuja lo
 * que salga de aquí.
 *
 * Y porque el estado se reconstruye desde cero al reengancharse: el servidor
 * reproduce la conversación entera y esto la vuelve a plegar. Que reproducir N
 * mensajes dé exactamente el mismo estado que haberlos recibido en vivo es una
 * propiedad de una función pura, no algo que haya que recordar mantener.
 */

export type ChatItem =
  | { kind: "user"; key: string; text: string; images: AcpPromptImage[] }
  | { kind: "message"; key: string; text: string }
  | { kind: "thought"; key: string; text: string }
  | { kind: "tool"; key: string; call: acp.ToolCall }
  | { kind: "plan"; key: string; planId: string; entries: acp.PlanEntry[]; markdown?: string }
  | {
      kind: "error"; key: string;
      /** Texto crudo del servidor. Solo se pinta cuando no hay `code`. */
      message: string;
      /** Fallo nuestro y traducible: lo pinta quien sabe el idioma. */
      code?: "agent-not-found" | "npx-not-found";
      command?: string;
      /** El preset que falló, por id. Da el nombre y el enlace; ver `wire.ts`. */
      agent?: string;
      install?: string; npx?: string;
    };

export type ChatStatus = "starting" | "auth" | "authenticating" | "ready" | "busy" | "closed" | "failed";

export interface ChatState {
  status: ChatStatus;
  /** Rótulo del agente: el del preset. Vacío hasta que la sesión está lista. */
  agentName: string;
  /** Lo que el agente dice ser, con versión. Para el `title`. */
  agentDetail: string;
  /** Modelo en uso cuando no se puede cambiar desde aquí. Ver `wire.ts`. */
  model: { id: string; label: string } | null;
  items: ChatItem[];
  configOptions: acp.SessionConfigOption[];
  commands: acp.AvailableCommand[];
  /** Whether the connected agent accepts image blocks in prompts. */
  imageInput: boolean;
  auth: { message: string; methods: acp.AuthMethod[]; required: boolean } | null;
  /**
   * Cómo iniciar sesión a mano, cuando el método es interactivo.
   * `null` mientras nadie lo ha pedido. Ver `launchTerminal.ts`.
   */
  manualAuth: { methodId: string; command: string; opened: boolean } | null;
  /** El diálogo abierto, o `null`. Solo puede haber uno a la vista. */
  permission: { requestId: string; request: acp.RequestPermissionRequest } | null;
  /** Salida acumulada de cada terminal del cliente, por id. */
  terminals: Record<string, string>;
  usage: acp.UsageUpdate | null;
  /** Por qué paró el último turno. `null` mientras no haya terminado ninguno. */
  stopReason: acp.StopReason | null;
  /**
   * Lo que el agente escribió por stderr.
   *
   * Se GUARDA siempre y se ENSEÑA casi nunca, y las dos mitades importan.
   *
   * Guardarlo, porque hay fallos que solo se anuncian por aquí: un agente al
   * que le faltan credenciales no manda nada por el protocolo, y sin esto su
   * avería se ve como un silencio.
   *
   * No enseñarlo mientras todo va bien, porque todos los agentes escriben
   * ruido de funcionamiento normal por stderr — Claude Code una línea de
   * `[session/query]` por turno, Hermes dos docenas de `[INFO]` de registro de
   * plugins al arrancar. Un panel presente en cada conversación sana no es
   * solo estorbo: enseña a ignorarlo, y entonces no se mira el día que es el
   * único sitio donde está la explicación. Ver `showsDiagnostics`.
   */
  stderr: string;
  /**
   * Conversaciones anteriores de este agente, o `null` si no se han pedido.
   *
   * `null` y `[]` dicen cosas distintas y la interfaz las pinta distinto: sin
   * pedir todavía —el menú no se ha abierto— frente a pedido y no hay ninguna.
   * Con un solo array vacío, abrir el menú enseñaría «no hay conversaciones»
   * durante el viaje de ida y vuelta, que es la respuesta equivocada dicha con
   * confianza.
   */
  sessions: AcpConversation[] | null;
  /** El agente sabe enumerarlas y reabrirlas. Ver `wire.ts`. */
  canList: boolean;
  /** Se está reproduciendo una conversación pedida. Ver `restarting`. */
  loading: boolean;
  /** Contador de claves. Interno; ver `nextKey`. */
  seq: number;
}

export const EMPTY: ChatState = {
  status: "starting",
  agentName: "",
  agentDetail: "",
  model: null,
  items: [],
  configOptions: [],
  commands: [],
  imageInput: false,
  auth: null,
  manualAuth: null,
  permission: null,
  terminals: {},
  usage: null,
  stopReason: null,
  stderr: "",
  sessions: null,
  canList: false,
  loading: false,
  seq: 0,
};

/**
 * Claves de React derivadas de un contador del propio estado, no de
 * `Math.random()` ni del índice del array.
 *
 * Del contador porque tiene que ser estable entre renders: una clave nueva en
 * cada vuelta haría que React desmontara y remontara cada burbuja, perdiendo
 * la selección de texto y la posición del scroll en mitad de una respuesta que
 * está llegando. Y no del índice porque los items no solo se añaden al final —
 * un plan se reemplaza y una herramienta se actualiza en su sitio.
 */
function nextKey(state: ChatState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

/**
 * Los trozos de texto llegan de uno en uno y se pegan al item anterior si son
 * del mismo mensaje.
 *
 * `messageId` es la señal buena y es opcional: cuando viene, un cambio de id
 * significa mensaje nuevo. Cuando no —y varios agentes no lo mandan— la regla
 * de repuesto es la posición: si el último item ya es de esta clase, es el
 * mismo mensaje. Se equivoca solo en el caso de dos mensajes consecutivos del
 * mismo tipo sin id, que se ven como uno; el fallo contrario —una burbuja
 * nueva por cada token— sería ilegible.
 */
function appendChunk(state: ChatState, kind: "user" | "message" | "thought", text: string) {
  const last = state.items[state.items.length - 1];
  if (last && last.kind === kind) {
    state.items[state.items.length - 1] = { ...last, text: last.text + text };
    return;
  }
  if (kind === "user") {
    state.items.push({ kind, key: nextKey(state, kind), text, images: [] });
    return;
  }
  state.items.push({ kind, key: nextKey(state, kind), text });
}

/** Append a replayed image block to the current user message. */
function appendUserImage(state: ChatState, block: Extract<acp.ContentBlock, { type: "image" }>) {
  const padding = block.data.endsWith("==") ? 2 : block.data.endsWith("=") ? 1 : 0;
  const image: AcpPromptImage = {
    id: nextKey(state, "image"),
    mimeType: block.mimeType as AcpPromptImage["mimeType"],
    data: block.data,
    size: Math.max(0, Math.floor(block.data.length * 3 / 4) - padding),
  };
  const last = state.items[state.items.length - 1];
  if (last?.kind === "user") {
    if (!last.images.some((candidate) => candidate.mimeType === image.mimeType && candidate.data === image.data)) {
      state.items[state.items.length - 1] = { ...last, images: [...last.images, image] };
    }
    return;
  }
  state.items.push({ kind: "user", key: nextKey(state, "user"), text: "", images: [image] });
}

/**
 * Texto legible de `rawOutput`, para las herramientas que no mandan `content`.
 *
 * **Existe porque hay un tercer camino de salida que el protocolo no bendice.**
 * `ToolCallContent` define tres variantes y `rawOutput` no es ninguna: el
 * esquema lo describe como «raw output returned by the tool», de tipo
 * `unknown`. Pero el adaptador de Codex pone ahí la salida de sus comandos y
 * no manda `content` ninguno, así que un cliente que solo mire las tres
 * variantes pinta una tarjeta «List files» vacía para un `ls` que sí corrió.
 *
 * Por eso esto es un RESPALDO y no una cuarta variante: solo se mira cuando no
 * hay `content`, y en la interfaz va plegado. Al ser `unknown`, lo que salga no
 * está garantizado — de ahí el rodeo por las claves que se han visto de verdad
 * antes de caer al JSON, que al menos enseña algo en vez de nada.
 */
export function rawOutputText(rawOutput: unknown): string {
  if (rawOutput === undefined || rawOutput === null) return "";
  if (typeof rawOutput === "string") return rawOutput;
  if (typeof rawOutput === "object") {
    // `formatted_output` es lo que usa codex-acp; los otros dos son los nombres
    // obvios que aparecen en herramientas de shell.
    for (const key of ["formatted_output", "output", "stdout"]) {
      const value = (rawOutput as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  try { return JSON.stringify(rawOutput, null, 2); } catch { return ""; }
}

/** El texto de un bloque de contenido, o vacío si no es texto (imagen, audio). */
export function blockText(block: acp.ContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "resource_link") return block.uri;
  if (block.type === "resource" && "text" in block.resource) return block.resource.text;
  return "";
}

function applyUpdate(state: ChatState, update: acp.SessionNotification["update"]) {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      if (update.content.type === "image") appendUserImage(state, update.content);
      else appendChunk(state, "user", blockText(update.content));
      return;
    case "agent_message_chunk":
      appendChunk(state, "message", blockText(update.content));
      return;
    case "agent_thought_chunk":
      appendChunk(state, "thought", blockText(update.content));
      return;

    case "tool_call":
      state.items.push({ kind: "tool", key: `tool-${update.toolCallId}`, call: update });
      return;

    /*
     * La actualización trae SOLO lo que cambió, así que se funde encima en vez
     * de reemplazar — y hay que descartar los `null`, que en este protocolo
     * significan «sin cambios» y no «vacío». Escribirlos borraría el título de
     * una herramienta cada vez que llega un cambio de estado.
     */
    case "tool_call_update": {
      const at = state.items.findIndex((i) => i.kind === "tool" && i.call.toolCallId === update.toolCallId);
      const patch: Partial<acp.ToolCall> = {};
      for (const [k, v] of Object.entries(update)) {
        if (k === "sessionUpdate" || k === "toolCallId" || v === null || v === undefined) continue;
        (patch as Record<string, unknown>)[k] = v;
      }
      if (at < 0) {
        // Una actualización sobre algo que nunca se anunció. Pasa al
        // reengancharse a una conversación cuyo principio ya se recortó del
        // historial: mejor una tarjeta con lo que se sepa que un hueco.
        state.items.push({
          kind: "tool",
          key: `tool-${update.toolCallId}`,
          call: { toolCallId: update.toolCallId, title: update.title ?? update.toolCallId, ...patch },
        });
        return;
      }
      const item = state.items[at] as Extract<ChatItem, { kind: "tool" }>;
      state.items[at] = { ...item, call: { ...item.call, ...patch } };
      return;
    }

    // El plan estable no tiene id: se reemplaza entero, cada vez.
    case "plan":
      upsertPlan(state, "", update.entries);
      return;

    /*
     * `plan_update` y `plan_removed` están marcados UNSTABLE en el esquema.
     * Se atienden porque cuestan poco, pero solo las dos formas que se pueden
     * pintar con lo que ya hay: entradas y markdown. La variante `file`
     * apunta a un archivo del disco y necesitaría leerlo — fase 4, cuando `fs`
     * exista; hasta entonces ignorarla es más honesto que inventarse el texto.
     */
    case "plan_update":
      if (update.plan.type === "items") upsertPlan(state, update.plan.planId, update.plan.entries);
      if (update.plan.type === "markdown") upsertPlan(state, update.plan.planId, [], update.plan.content);
      return;
    case "plan_removed":
      state.items = state.items.filter((i) => !(i.kind === "plan" && i.planId === update.planId));
      return;

    case "available_commands_update":
      state.commands = update.availableCommands ?? state.commands;
      return;
    case "config_option_update":
      state.configOptions = update.configOptions ?? state.configOptions;
      return;
    case "usage_update":
      state.usage = update;
      return;
    default:
      // El resto —modos, info de sesión, compactación— no tiene nada que
      // pintar todavía. Se ignora en silencio a propósito: el protocolo crece,
      // y un `update` desconocido no es un error.
      return;
  }
}

function upsertPlan(state: ChatState, planId: string, entries: acp.PlanEntry[], markdown?: string) {
  const at = state.items.findIndex((i) => i.kind === "plan" && i.planId === planId);
  const item: ChatItem = { kind: "plan", key: `plan-${planId || "main"}`, planId, entries, markdown };
  if (at < 0) state.items.push(item);
  else state.items[at] = item;
}

/**
 * ¿Merece la pena enseñar el stderr del agente?
 *
 * Solo cuando algo puede necesitar explicación: la sesión no arrancó, pide
 * autenticación, se cerró, o algún turno falló. En cualquiera de esos casos el
 * registro ya está completo —se venía guardando desde el principio— así que el
 * panel aparece con la respuesta dentro, no vacío esperando a que vuelva a
 * pasar.
 *
 * `authenticating` queda fuera a propósito: ahí no ha fallado nada todavía, y
 * el sitio donde mirar es el panel de inicio de sesión, no un volcado.
 */
export function showsDiagnostics(state: ChatState): boolean {
  if (!state.stderr) return false;
  if (state.status === "failed" || state.status === "auth" || state.status === "closed") return true;
  // Un fallo a mitad de turno deja la sesión viva y utilizable, así que el
  // estado sigue siendo `ready`; lo que lo delata es el elemento de error.
  return state.items.some((item) => item.kind === "error");
}

/**
 * Transcript rows: standalone items, plus RUNS of tool calls folded into one.
 *
 * An ordinary turn fires ten or fifteen calls back to back, and one card each
 * pushed the answer — the only thing the person asked for — off the screen.
 * The Claude Code TUI settles this with a single line ("read 1 file, ran 7
 * shell commands"); the same applies here: a whole run is one disclosure.
 *
 * Grouping starts at TWO calls. A lone call stays a card, because its title
 * names the file or the command and the tally — "read 1 file" — says less.
 */
export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type Row =
  | { row: "item"; key: string; item: ChatItem }
  | { row: "tools"; key: string; items: ToolItem[] };

export function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind !== "tool") {
      rows.push({ row: "item", key: item.key, item });
      continue;
    }
    const run: ToolItem[] = [];
    while (i < items.length && items[i]!.kind === "tool") run.push(items[i++] as ToolItem);
    i--;
    // Keyed by the FIRST item of the run: that key does not change as new
    // calls land at the end, so the disclosure is never remounted and never
    // loses what the person opened by hand.
    rows.push(run.length > 1
      ? { row: "tools", key: `group-${run[0]!.key}`, items: run }
      : { row: "item", key: run[0]!.key, item: run[0]! });
  }
  return rows;
}

/** Aplica UN mensaje. Devuelve un estado nuevo; el de entrada no se toca. */
export function reduce(prev: ChatState, message: AcpServerMessage): ChatState {
  const state: ChatState = { ...prev, items: [...prev.items] };

  switch (message.t) {
    case "ready":
      state.agentName = message.agentName;
      state.agentDetail = message.agentDetail;
      state.model = message.model;
      state.configOptions = message.configOptions;
      state.commands = message.availableCommands;
      state.imageInput = message.imageInput;
      state.auth = null;
      /*
       * Promociona desde «arrancando» y también desde «falló»: un `ready`
       * significa que hay una sesión viva, y llegar después de un error es
       * exactamente lo que pasa al reintentar. Lo que NO pisa es `busy` —al
       * reengancharse en mitad de un turno, el `ready` sintetizado llega antes
       * que el `sent` que lo abrió— ni `closed`.
       */
      if (state.status === "starting" || state.status === "failed") state.status = "ready";
      state.canList = message.canList;
      // Lo que hubiera listado es de la sesión anterior a la carga; volver a
      // abrir el menú lo pide otra vez, y ahora sin la conversación en curso.
      state.sessions = null;
      state.loading = false;
      return state;

    case "sent":
      state.items.push({
        kind: "user",
        key: nextKey(state, "user"),
        text: message.text,
        images: message.images ?? [],
      });
      state.status = "busy";
      return state;

    case "file-written":
      // The editor buffer bridge consumes this side effect before folding.
      return state;

    case "ui":
      // Igual que `file-written`: es un efecto, no algo que se pinte. Lo
      // consume `components/acp-ui.ts` antes de plegar, y el estado del chat
      // no cambia — la conversación no se ve distinta porque el grafo se haya
      // movido.
      return state;

    case "auth-required":
      state.auth = { message: message.message, methods: message.methods, required: message.required };
      state.status = "auth";
      return state;

    case "authenticating":
      state.status = "authenticating";
      state.manualAuth = null;
      return state;

    case "auth-manual":
      /*
       * El estado vuelve a `auth`, no se queda en `authenticating`. La app no
       * está haciendo nada: está esperando a que una persona termine en otra
       * ventana, y sigue habiendo métodos que elegir. Dejarlo en
       * «autenticando» deshabilitaría los botones que hacen falta para
       * reintentar o para probar otro método.
       */
      state.status = "auth";
      state.manualAuth = { methodId: message.methodId, command: message.command, opened: message.opened };
      return state;

    case "update":
      applyUpdate(state, message.update);
      return state;

    case "permission":
      state.permission = { requestId: message.requestId, request: message.request };
      return state;

    case "permission-done":
      // Se compara el id: si dos ventanas están abiertas, la que no contestó
      // recibe el aviso y tiene que cerrar ESE diálogo, no cualquiera.
      if (state.permission?.requestId === message.requestId) state.permission = null;
      return state;

    case "terminal":
      state.terminals = {
        ...state.terminals,
        [message.terminalId]: (state.terminals[message.terminalId] ?? "") + message.chunk,
      };
      return state;

    case "turn":
      state.status = "ready";
      state.stopReason = message.stopReason;
      return state;

    case "stderr":
      state.stderr = (state.stderr + message.text).slice(-20_000);
      return state;

    case "error":
      state.items.push({
        kind: "error", key: nextKey(state, "err"),
        message: message.message, code: message.code, command: message.command,
        agent: message.agent, install: message.install, npx: message.npx,
      });
      // Un fallo de ARRANQUE deja la sesión inservible; uno de turno no. Se
      // distinguen por si llegó a haber sesión: sin nombre de agente, ni
      // siquiera contestó `initialize`.
      state.status = state.agentName ? "ready" : "failed";
      return state;

    case "closed":
      state.status = "closed";
      return state;

    /*
     * Se relanza el agente: lo que había en pantalla era el error de que
     * faltaba, y dejarlo encima del arranque nuevo diría que sigue fallando.
     * `seq` NO se reinicia — las claves de React tienen que seguir siendo
     * únicas dentro de esta pestaña, o el item nuevo reutilizaría la clave de
     * uno recién desmontado.
     */
    case "sessions":
      state.sessions = message.sessions;
      return state;

    case "restarting":
      /*
       * `canList` sobrevive al borrado y el resto no.
       *
       * Es una propiedad del AGENTE, no de la conversación, y el `ready` que
       * lo repone llega al final de la carga — detrás de los trescientos
       * mensajes que se están reproduciendo. Reponerlo a `false` mientras
       * tanto haría desaparecer el botón del historial justo mientras se usa.
       */
      return { ...EMPTY, seq: state.seq, canList: state.canList, loading: message.reason === "load" };
  }
}

export function reduceAll(messages: AcpServerMessage[], from: ChatState = EMPTY): ChatState {
  return messages.reduce(reduce, from);
}

/*
 * Vive aquí y no en `AgentChat.tsx` por una razón del entorno, no de diseño:
 * las pruebas corren con `--experimental-strip-types`, que solo borra tipos y
 * no sabe qué hacer con JSX. Cualquier función que se quiera probar tiene que
 * estar en un `.ts`.
 */
/**
 * Parte el texto en prosa y bloques cercados.
 *
 * La cerca de APERTURA se reconoce por el principio de línea; el cierre, por
 * una línea que solo tenga la cerca. Es lo que evita que un ``` mencionado a
 * mitad de un párrafo abra un bloque falso que se coma el resto del mensaje —
 * y pasa: los agentes explican cómo escribir markdown.
 *
 * Un bloque sin cerrar (el turno todavía está llegando) se pinta como código
 * hasta donde va. La alternativa —esperar al cierre— haría que el código
 * apareciera de golpe al final en vez de escribirse.
 */
export function splitFences(text: string): { code: boolean; lang: string; text: string }[] {
  const out: { code: boolean; lang: string; text: string }[] = [];
  const lines = text.split("\n");
  let buffer: string[] = [];
  let code = false;
  let lang = "";

  const flush = () => {
    const joined = buffer.join("\n");
    if (joined.trim() || code) out.push({ code, lang, text: joined });
    buffer = [];
  };

  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence && !code) {
      flush();
      code = true;
      lang = fence[1]!.trim();
      continue;
    }
    if (code && /^\s*```\s*$/.test(line)) {
      flush();
      code = false;
      lang = "";
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}
