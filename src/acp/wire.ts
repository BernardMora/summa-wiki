import type * as acp from "@agentclientprotocol/sdk";
import type { UiAction } from "../mcp/tools.ts";

/**
 * Lo que viaja por el WebSocket entre el navegador y el servidor.
 *
 * ## Por qué hay un protocolo aquí en medio
 *
 * ACP es stdio: hablarlo requiere lanzar procesos, y eso solo puede pasar en
 * el servidor. El navegador necesita entonces su propio canal, y este archivo
 * es el contrato — importado por las dos puntas, así que un mensaje que una
 * mande y la otra no entienda no compila.
 *
 * Es deliberadamente delgado. Casi todo lo que baja es el `SessionUpdate` de
 * ACP tal cual, sin traducir: reempaquetarlo en tipos propios crearía una
 * segunda forma que hay que mantener al día con la primera, y lo que la
 * interfaz pinta es exactamente lo que el protocolo define. Lo único que se
 * inventa es lo que ACP no tiene porque no lo necesita: identificar una
 * petición de permiso para poder contestarla desde otra máquina —el navegador
 * no comparte memoria con el servidor, así que la promesa pendiente no le
 * llega—, y el goteo de salida de los terminales.
 */

/**
 * Una conversación anterior, tal como se enseña en la lista.
 *
 * Es un recorte de `acp.SessionInfo`, no el objeto entero, y por dos razones
 * concretas. El `cwd` sobra: la lista ya se pide filtrada por el directorio de
 * la pestaña, así que sería el mismo valor repetido en cada fila. Y el título
 * hay que recortarlo — Codex manda como título **el primer mensaje completo**,
 * que en una conversación real son cuatrocientos caracteres, y mandarlos
 * enteros por el socket para que el navegador los corte con CSS es pagar el
 * ancho de banda de un texto que nadie va a leer.
 */
export interface AcpConversation {
  sessionId: string;
  /** Ya recortado. Vacío cuando el agente no da ninguno. */
  title: string;
  /** ISO 8601, o vacío si el agente no lo dice. */
  updatedAt: string;
}

/** Del navegador al servidor. */
export type AcpClientMessage =
  | { t: "prompt"; text: string; resources?: AcpPromptResource[]; images?: AcpPromptImage[] }
  | { t: "buffer"; id: string; content: string }
  | { t: "cancel" }
  | { t: "config"; configId: string; value: string | boolean }
  | { t: "permission"; requestId: string; optionId: string }
  | { t: "authenticate"; methodId: string }
  /**
   * Un método de autenticación `type: "terminal"`: enséñame el comando e
   * intenta abrirlo en mi terminal.
   *
   * La app NO ejecuta el inicio de sesión. Es un proceso interactivo y corre
   * donde los procesos interactivos saben correr — ver `launchTerminal.ts`
   * para por qué eso es mejor que emular una terminal aquí dentro. Se manda
   * también al pulsar «abrir de nuevo»: reintentar es pedir lo mismo.
   */
  | { t: "auth-launch"; methodId: string }
  /**
   * Volver a lanzar el agente. Con `viaNpx` se usa el camino que no instala
   * nada.
   *
   * Es un mensaje aparte y no una opción del arranque porque la decisión llega
   * DESPUÉS de que el arranque falle: la app no sabe si el binario está hasta
   * que lo busca, y bajar un paquete de la red no se hace por si acaso. El
   * reintento a secas es para lo otro que la gente hace al ver «no está
   * instalado»: instalarlo en una terminal y volver aquí.
   */
  | { t: "retry"; viaNpx?: boolean }
  /** Pide la lista de conversaciones anteriores de ESTE agente. */
  | { t: "sessions" }
  /** Reabre una de ellas en esta pestaña. */
  | { t: "load"; sessionId: string };

export interface AcpPromptResource {
  id: string;
  title: string;
  path: string;
  description?: string;
}

/**
 * Image bytes copied into a prompt.
 *
 * The browser owns this data only while the draft is open. Once sent, the
 * selected ACP agent receives a standard image content block and becomes the
 * durable owner of the conversation, just as it is for text messages.
 */
export interface AcpPromptImage {
  /** Stable within the client so a preview can be removed without using its array index. */
  id: string;
  /** Original clipboard filename when the browser provides one. */
  name?: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64 payload without a data-URL prefix. */
  data: string;
  /** Decoded byte count, used for limits and display without decoding again. */
  size: number;
}

export const CHAT_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
]);
export const MAX_CHAT_IMAGES = 20;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;

/** Del servidor al navegador. */
export type AcpServerMessage =
  /** Sesión lista. Lo primero que baja, y lo que la interfaz espera para dejar escribir. */
  | {
      t: "ready";
      agent: string;
      /**
       * Nombre para pintar. Es el del preset —«Codex», «Hermes Agent»—, no el
       * que el agente da de sí mismo, porque ese no siempre es un nombre: el
       * adaptador de Codex se presenta como `@agentclientprotocol/codex-acp`,
       * y encabezar la conversación con la ruta de un paquete de npm es tan
       * correcto como inútil. Además es el mismo rótulo que el usuario pulsó
       * en el menú, que es lo que espera volver a ver.
       */
      agentName: string;
      /** Lo que el agente dice ser, con versión. Va al `title`, para diagnóstico. */
      agentDetail: string;
      sessionId: string;
      configOptions: acp.SessionConfigOption[];
      availableCommands: acp.AvailableCommand[];
      /** Whether the current agent advertised ACP image prompt support. */
      imageInput: boolean;
      /**
       * Modelo en uso, cuando el agente solo lo dice por la API vieja y no deja
       * cambiarlo por ACP. Se pinta como texto, no como desplegable: Hermes
       * anuncia doce modelos y contesta «Method not found» a
       * `session/select_model`, así que un control para elegirlos sería una
       * mentira con forma de botón. Se cambian con su comando `/model`.
       */
      model: { id: string; label: string } | null;
      /**
       * Si este agente sabe enumerar y reabrir conversaciones anteriores.
       *
       * Viaja en el `ready` y no se deduce del preset porque no es propiedad
       * del preset: depende de la VERSIÓN instalada. Los cuatro harnesses
       * probados el 2026-08-23 lo soportan, y basta con que uno actualice para
       * que un botón escrito en una tabla mienta en una dirección o en la otra.
       */
      canList: boolean;
    }
  /** La lista pedida con `{ t: "sessions" }`. Vacía es una respuesta válida. */
  | { t: "sessions"; sessions: AcpConversation[] }
  /** Lo que el usuario mandó, devuelto por el servidor: ver `AcpRegistry`. */
  | { t: "sent"; text: string; images?: AcpPromptImage[] }
  | { t: "file-written"; id: string; content: string; mtimeMs: number }
  | { t: "auth-required"; message: string; methods: acp.AuthMethod[]; required: boolean }
  | { t: "authenticating"; methodId: string; terminal: boolean }
  /**
   * Cómo iniciar sesión a mano, porque el método es interactivo.
   *
   * `command` es la línea tal como se teclea, y es el mecanismo de verdad: se
   * enseña siempre, para copiar. `opened` dice si además se consiguió abrir la
   * terminal del sistema — una comodidad que puede fallar (un Linux sin
   * ninguna terminal conocida) sin que el camino se cierre.
   */
  | { t: "auth-manual"; methodId: string; command: string; opened: boolean }
  | { t: "update"; update: acp.SessionNotification["update"] }
  | { t: "permission"; requestId: string; request: acp.RequestPermissionRequest }
  /**
   * El permiso ya se decidió. Existe para el caso de dos ventanas abiertas
   * sobre la misma conversación: la que no contestó tiene que enterarse de
   * que el diálogo ya no aplica, o se queda pidiendo algo que ya se concedió.
   * `optionId: null` = se canceló el turno.
   */
  | { t: "permission-done"; requestId: string; optionId: string | null }
  | { t: "terminal"; terminalId: string; chunk: string }
  /**
   * El agente pidió cambiar la vista: abrir una nota, enfocar el grafo.
   *
   * Baja por el mismo cable que todo lo demás, y eso es lo que hace que
   * funcione en vista dividida: llega a TODAS las conexiones abiertas sobre
   * esta conversación, así que las dos ventanas obedecen la misma orden.
   *
   * No pasa por el reductor de la transcripción — no es algo que se pinte,
   * es algo que ocurre — igual que `file-written`. Ver `components/acp-ui.ts`.
   */
  | { t: "ui"; action: UiAction }
  | { t: "turn"; stopReason: acp.StopReason }
  | { t: "stderr"; text: string }
  /**
   * No se pudo arrancar. `install` lleva el comando de instalación cuando el
   * fallo es que falta el binario — el error más común con diferencia, y el
   * único que el usuario puede arreglar sin salir de la app. `npx` lleva el
   * comando equivalente que evita instalarlo, y solo viene cuando ese camino
   * existe: es lo que decide si la interfaz ofrece el botón.
   */
  | {
      t: "error";
      /**
       * Texto tal cual, para lo que no se puede traducir: lo que conteste el
       * agente, un fallo de red, un error del protocolo.
       */
      message: string;
      /**
       * Los fallos que SÍ son nuestros y sí se traducen. El servidor no sabe
       * en qué idioma está la interfaz —el idioma vive en `settings.json` y lo
       * reparte el layout por contexto—, así que manda un código y el texto lo
       * pone quien pinta. Sin esto, un usuario con la app en inglés recibía el
       * «No se encontró …» en español.
       */
      code?: "agent-not-found" | "npx-not-found";
      /** El binario que faltaba. Solo con `code: "agent-not-found"`. */
      command?: string;
      /**
       * Which preset failed to start, by id.
       *
       * The name and the documentation link are NOT sent: they live in
       * `ACP_PRESETS`, which the client imports too, and a copy on the wire is
       * one more thing that can disagree with the table. The id is the only
       * part the client cannot work out on its own, because a chat can be
       * pointed at a harness that is not the vault default.
       */
      agent?: string;
      install?: string;
      npx?: string;
    }
  /**
   * La sesión se está relanzando: lo que hubiera en pantalla ya no aplica.
   *
   * `reason` distingue las dos cosas que lo provocan, porque la espera que
   * sigue no se parece: relanzar arranca un proceso, cargar una conversación
   * reproduce la que se pidió. Decir «conectando» mientras llega una
   * conversación de trescientos mensajes deja a alguien mirando un panel en
   * blanco sin saber si pulsó bien.
   */
  | { t: "restarting"; reason?: "relaunch" | "load" }
  | { t: "closed"; error?: string };
