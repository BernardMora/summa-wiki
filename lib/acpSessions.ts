import { AcpSession, AgentNotFoundError, NpxNotFoundError } from "../src/acp/session.ts";
import { installCommand, presetById } from "../src/acp/presets.ts";
import type { AcpConversation, AcpServerMessage } from "../src/acp/wire.ts";
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  MAX_CHAT_IMAGES,
  type AcpPromptImage,
  type AcpPromptResource,
} from "../src/acp/wire.ts";
import { findNote, getIndex, invalidate, resolveId } from "./server.ts";
import { pathToFileURL } from "node:url";
import type { LiveBuffer } from "../src/acp/filesystem.ts";
import type * as acp from "@agentclientprotocol/sdk";
import { openInSystemTerminal, shellLine } from "../src/acp/launchTerminal.ts";
import { mcpServerFor } from "../src/mcp/attach.ts";
import { registerMcpEndpoint, releaseMcpEndpoints } from "../src/mcp/registry.ts";

/**
 * Las conversaciones vivas con agentes, por id.
 *
 * Existe por una razón: **la sesión no puede ser propiedad de la conexión que
 * la mira.**
 * Cambiar de pestaña, mover el panel o recargar la página cierra el
 * WebSocket, y ninguna de las tres cosas debería matar una conversación —
 * menos aún con un turno a medias. El proceso del agente vive aquí, colgado
 * del servidor, hasta que alguien cierra la pestaña de verdad
 * (`app/api/acp/route.ts`).
 *
 * Lo que sí cambia respecto de la terminal es qué se guarda para redibujar.
 * Una pty guarda los últimos bytes de pantalla, porque una terminal ES su
 * pantalla. Aquí lo que llega son mensajes tipados y lo que se guarda es la
 * conversación: al reengancharse se reproduce entera y la interfaz la vuelve
 * a plegar. Sin eso, volver a una pestaña mostraría un chat en blanco con un
 * agente que sí recuerda todo — la peor de las dos.
 *
 * `globalThis` bajo `Symbol.for`: `server.ts` corre con
 * el cargador nativo de Node y las rutas de `app/api` con el bundler de Next.
 * Cada uno instancia el módulo por su lado, así que un `Map` de nivel de
 * módulo NO sería el mismo mapa — y el DELETE de la ruta no encontraría nada
 * que cerrar aunque respondiera `ok`.
 */

/**
 * Cuántos mensajes se retienen por conversación.
 *
 * Generoso a propósito: son objetos pequeños y una conversación larga con
 * herramientas los gasta rápido. Lo que se pierde al pasarse es el principio
 * del chat, no el final — y el agente sigue teniendo su propio contexto, así
 * que la pérdida es de lo que se ve, no de lo que se sabe.
 */
const MAX_TRANSCRIPT = 2_000;

export interface AcpEntry {
  /**
   * Id de la conversación — la misma clave con la que vive en `acpSessions`.
   *
   * Duplicarlo dentro de la entrada parece redundante y no lo es: todo lo que
   * recibe una `AcpEntry` la recibe suelta, sin el mapa, y algunas cosas
   * necesitan el id para hablar con registros de FUERA — el de tokens MCP,
   * sin ir más lejos. La alternativa era pasarlo como segundo argumento por
   * media docena de funciones, donde acabaría desincronizándose de la entrada
   * que acompaña.
   */
  id: string;
  agent: string;
  cwd: string;
  /** `null` mientras arranca o si el arranque falló. Ver `phase`. */
  session: AcpSession | null;
  /**
   * En qué punto está el arranque.
   *
   * `session === null` no basta para saberlo: vale igual para «todavía está
   * arrancando» que para «no arrancó». La diferencia decide si reconectarse
   * reproduce lo que hay o vuelve a intentarlo, y confundirlas es lo que
   * dejaba un error clavado para siempre.
   */
  phase: "starting" | "auth" | "live" | "failed";
  transcript: AcpServerMessage[];
  /** Peticiones de permiso sin contestar, por el id que se le dio al navegador. */
  pending: Map<string, (optionId: string) => void>;
  listeners: Set<(message: AcpServerMessage) => void>;
  /** Hay un turno en curso: no se acepta otro prompt hasta que termine. */
  busy: boolean;
  permissionSeq: number;
  buffers: Map<string, LiveBuffer>;
  /**
   * Token de la URL del servidor MCP de esta conversación, o `null` si el
   * agente no llegó a recibir uno.
   *
   * Se guarda para poder RETIRARLO al cerrar: el registro de tokens vive
   * fuera de aquí (`src/mcp/registry.ts`) y no tiene forma de enterarse por su
   * cuenta de que un chat se cerró. Sin esto, cada conversación abierta y
   * cerrada dejaría una URL viva capaz de mover la interfaz de una pestaña que
   * ya no existe.
   */
  mcpToken: string | null;
  /**
   * Cuántas veces se ha lanzado un agente para esta conversación.
   *
   * Sirve para descartar lo que llegue de un arranque ya superado. Sin esto,
   * reintentar con npx daba un chat roto de forma reproducible: resolver el
   * PATH tarda casi un segundo, así que el rechazo del PRIMER intento —«no se
   * encontró codex-acp»— aterrizaba DESPUÉS de que el segundo hubiera
   * empezado, y se colaba en su transcripción. La sesión buena arrancaba de
   * verdad, mandaba su `ready`, y la interfaz seguía enseñando el error del
   * intento anterior.
   */
  gen: number;
}

const KEY = Symbol.for("summa-wiki.acpSessions");
type Registry = Map<string, AcpEntry>;
const g = globalThis as unknown as Record<symbol, Registry>;
g[KEY] ??= new Map<string, AcpEntry>();
export const acpSessions: Registry = g[KEY];

/** Lo que el agente dice ser, con versión. Para el `title`, no para el rótulo. */
function agentDetail(session: AcpSession): string {
  const info = session.init.agentInfo;
  return [info?.name, info?.version].filter(Boolean).join(" ");
}

function readyMessage(entry: AcpEntry, session: AcpSession): AcpServerMessage {
  return {
    t: "ready",
    agent: entry.agent,
    agentName: presetById(entry.agent)?.name ?? entry.agent,
    agentDetail: agentDetail(session),
    model: session.model,
    sessionId: session.sessionId ?? "",
    configOptions: session.configOptions,
    availableCommands: session.availableCommands,
    imageInput: session.acceptsImages,
    // Las dos, no una: enumerar sin poder reabrir daría una lista que no lleva
    // a ningún sitio, y reabrir sin enumerar no da nada que pulsar.
    canList: session.canListSessions && session.canLoadSession,
  };
}

/**
 * Cuánto título se manda. Ver `AcpConversation` en `wire.ts` para por qué hace
 * falta cortar: Codex usa el primer mensaje entero como título.
 */
const TITLE_MAX = 120;

export function summarize(info: acp.SessionInfo): AcpConversation {
  const title = (info.title ?? "").replace(/\s+/g, " ").trim();
  return {
    sessionId: info.sessionId,
    title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title,
    updatedAt: info.updatedAt ?? "",
  };
}

/**
 * Las conversaciones anteriores de este agente, para este vault.
 *
 * La conversación ABIERTA se excluye. No es un adorno: abrir una pestaña de
 * chat crea una sesión con `session/new`, así que sin este filtro la primera
 * fila de la lista sería siempre la conversación vacía en la que ya estás —la
 * más reciente de todas, por definición— y ofrecerla como algo a lo que volver
 * es ofrecer no hacer nada.
 *
 * Un fallo aquí se cuenta como «no hay lista», no como un error del chat: la
 * conversación en curso sigue sirviendo, y convertir un `session/list` que no
 * contesta en un aviso rojo sobre el chat sería cambiar una carencia por una
 * avería. Ver `attachMcp`, que hace lo mismo por la misma razón.
 */
export async function listConversations(entry: AcpEntry) {
  const session = entry.session;
  if (!session || !session.canListSessions || !session.canLoadSession) {
    return emit(entry, { t: "sessions", sessions: [] });
  }
  try {
    const res = await session.listSessions(entry.cwd);
    const open = session.sessionId;
    emit(entry, {
      t: "sessions",
      sessions: res.sessions.filter((info) => info.sessionId !== open).map(summarize),
    });
  } catch {
    emit(entry, { t: "sessions", sessions: [] });
  }
}

/**
 * Reabre una conversación anterior en el proceso que ya está corriendo.
 *
 * El agente NO se relanza. `session/load` cambia de qué sesión habla la
 * conexión abierta, así que volver a una conversación de la semana pasada
 * cuesta lo que tarda el agente en releerla y no lo que tarda en arrancar.
 *
 * Se borra la transcripción ANTES de pedir la carga porque el agente empieza a
 * reproducir la conversación mientras la petición sigue en vuelo: limpiar
 * después borraría justo lo que se acaba de recibir. Los mensajes reproducidos
 * entran por el mismo `onEvent` que los de un turno en vivo, así que aquí no
 * hay nada que copiar — ver `AcpSession.loadSession`.
 */
export async function loadConversation(entry: AcpEntry, sessionId: string) {
  const session = entry.session;
  if (!session || !session.canLoadSession) return;
  if (entry.busy) return emit(entry, { t: "error", message: "Hay un turno en curso" });
  entry.pending.clear();
  entry.transcript.length = 0;
  emit(entry, { t: "restarting", reason: "load" });
  try {
    await session.loadSession(sessionId, entry.cwd, attachMcp(entry, session));
    emit(entry, readyMessage(entry, session));
  } catch (error) {
    emit(entry, { t: "error", message: error instanceof Error ? error.message : String(error) });
    // La sesión anterior ya no está seleccionada en el agente y ésta no cargó.
    // Un `ready` deja al menos la pestaña utilizable para escribir de nuevo.
    emit(entry, readyMessage(entry, session));
  }
}

function authRequiredMessage(session: AcpSession, error: unknown): AcpServerMessage {
  const required = typeof error === "object" && error !== null
    && "code" in error && (error as { code?: unknown }).code === -32000;
  return {
    t: "auth-required",
    message: error instanceof Error ? error.message : String(error),
    methods: session.authMethods,
    required,
  };
}

/**
 * Mensajes que son SUCESOS y no forman parte de la conversación.
 *
 * Existe como conjunto y no como una regla en la cabeza de quien escribe
 * porque la distinción no se ve en el sitio donde se rompe. Guardar un
 * `ui` costó una pestaña de chat que no se podía mirar: el `open_note` de un
 * turno anterior se reproducía al montarse el panel, abría la nota, la nota
 * robaba el foco y el chat se desmontaba — indefinidamente. Quien añada un
 * mensaje nuevo que PROVOQUE algo en vez de describirlo lo apunta aquí.
 *
 * `sessions` está por un motivo parecido pero no idéntico: no provoca nada,
 * pero **caduca**. Es la respuesta a una pregunta hecha en un momento, y el
 * agente sigue creando conversaciones —desde su propia CLI— mientras la app
 * está abierta. Reproducir la lista de hace dos horas al reconectarse pintaría
 * un menú con conversaciones que ya no son las últimas, y con la que está
 * abierta ahora mismo entre ellas. La interfaz distingue «no lo he preguntado»
 * de «no hay ninguna» precisamente para no tener que enseñar una respuesta
 * vieja mientras llega la buena; guardarla aquí tiraría esa distinción.
 */
export const EPHEMERAL: ReadonlySet<AcpServerMessage["t"]> = new Set(["ui", "sessions"]);

function emit(entry: AcpEntry, message: AcpServerMessage) {
  // Barrera, no conveniencia: si alguien emite un suceso por el camino normal,
  // se manda igual pero no se guarda, en vez de envenenar la transcripción.
  if (EPHEMERAL.has(message.t)) { signal(entry, message); return; }
  entry.transcript.push(message);
  if (entry.transcript.length > MAX_TRANSCRIPT) entry.transcript.splice(0, entry.transcript.length - MAX_TRANSCRIPT);
  for (const listener of entry.listeners) listener(message);
}

/**
 * Manda un mensaje a quien esté mirando AHORA, sin guardarlo.
 *
 * Es para lo que OCURRE una vez, en contraste con lo que la conversación ES.
 * La transcripción se reproduce entera cada vez que alguien se conecta —
 * cambiar de pestaña, recargar, abrir una segunda ventana— y reproducir un
 * suceso lo vuelve a provocar.
 *
 * Se descubrió con el peor síntoma posible: la pestaña del chat se volvió
 * imposible de mirar. Un `open_note` guardado se reproducía en cuanto el panel
 * del chat se montaba, así que abrir el chat abría la nota, la nota tomaba el
 * foco, el chat se desmontaba — y al volver a intentarlo pasaba otra vez. La
 * herramienta funcionaba perfectamente; lo que estaba mal era recordarla.
 */
function signal(entry: AcpEntry, message: AcpServerMessage) {
  for (const listener of entry.listeners) listener(message);
}

/**
 * Lo que hay que mandarle a quien acaba de conectarse.
 *
 * El `ready` se SINTETIZA con el estado de ahora en vez de reproducir el que
 * se emitió al arrancar: las opciones de configuración cambian durante la
 * sesión —el agente puede anunciar otras, o el usuario cambiar de modelo— y
 * el `ready` viejo pintaría el desplegable con la selección equivocada.
 */
export function replay(entry: AcpEntry): AcpServerMessage[] {
  const out: AcpServerMessage[] = [];
  const session = entry.session;
  if (session?.sessionId) {
    out.push(readyMessage(entry, session));
  }
  // El `ready` reproducido queda fuera para no pintarlo dos veces; y los
  // sucesos también, por si alguno llegó a guardarse: reproducir uno lo vuelve
  // a provocar. Ver `EPHEMERAL`.
  for (const message of entry.transcript) {
    if (message.t === "ready" || EPHEMERAL.has(message.t)) continue;
    out.push(message);
  }
  return out;
}

/**
 * La conversación con ese id, arrancándola si no existía.
 *
 * Devuelve la entrada de inmediato, con `session: null` mientras el proceso
 * arranca: resolver el PATH abre una shell de login y tarda casi un segundo,
 * y hacer esperar a la conexión todo ese rato dejaría la interfaz en blanco
 * sin poder decir qué está pasando. Lo que salga —sesión lista o el binario
 * que falta— llega después por el mismo canal que todo lo demás.
 */
export function openSession(id: string, agent: string, cwd: string): AcpEntry {
  const existing = acpSessions.get(id);
  if (existing) {
    /*
     * Un arranque fallido se REINTENTA al reconectarse, no se reproduce.
     *
     * El fallo casi siempre es «falta el binario», y lo que hace entonces
     * cualquiera es instalarlo y volver a abrir la pestaña. Con la
     * reproducción a secas eso no servía de nada: la entrada muerta seguía en
     * el registro, y como los ids de pestaña sobreviven en `localStorage`, el
     * MISMO error volvía a pintarse cada vez — con el paquete ya instalado.
     * Se veía como que la app no se enteraba de las instalaciones.
     *
     * Solo se reintenta desde `failed`. Reintentar desde `live` mataría una
     * conversación viva al cambiar de pestaña, y desde `starting` lanzaría un
     * segundo proceso encima del que todavía está resolviendo el PATH.
     */
    if (existing.phase === "failed") relaunch(existing, false);
    return existing;
  }

  const entry: AcpEntry = {
    id, agent, cwd,
    session: null,
    transcript: [],
    pending: new Map(),
    listeners: new Set(),
    busy: false,
    permissionSeq: 0,
    buffers: new Map(),
    mcpToken: null,
    gen: 0,
    phase: "starting",
  };
  acpSessions.set(id, entry);
  launch(entry, false);
  return entry;
}

/**
 * Vuelve a lanzar el agente, opcionalmente por `npx`.
 *
 * Se borra la transcripción y se avisa con `restarting`: lo que había en
 * pantalla era el error de que faltaba el binario, y dejarlo encima del
 * arranque nuevo diría que sigue fallando.
 */
export function relaunch(entry: AcpEntry, viaNpx: boolean) {
  entry.session?.close();
  entry.session = null;
  entry.pending.clear();
  entry.busy = false;
  entry.transcript.length = 0;
  entry.phase = "starting";
  emit(entry, { t: "restarting" });
  launch(entry, viaNpx);
}

/**
 * Da de alta el servidor MCP de esta conversación y devuelve lo que hay que
 * pasarle a `session/new`.
 *
 * Se hace por CADA arranque, no una vez por conversación: reintentar con npx
 * lanza un proceso nuevo, y un token que sobreviviera al proceso muerto sería
 * una URL viva apuntando a una sesión que ya no existe. El token viejo se
 * retira antes de emitir el nuevo.
 *
 * Un fallo aquí NO impide arrancar. Sin herramientas del wiki el agente sigue
 * siendo utilizable, y convertir «no encontré el puente de stdio» en «el chat
 * no abre» sería cambiar una carencia por una avería.
 */
function attachMcp(entry: AcpEntry, session: AcpSession): acp.McpServer[] {
  if (entry.mcpToken) releaseMcpEndpoints(entry.id);
  entry.mcpToken = registerMcpEndpoint({
    session: entry.id,
    /*
     * Se manda SIN guardar (ver `signal`): una acción de interfaz es un
     * suceso, y reproducirla al reconectarse la volvería a provocar.
     *
     * Que la vista siga donde el agente la dejó se resuelve en el navegador,
     * que es donde ese estado vive: `components/acp-ui.ts` retiene la última
     * orden de grafo para la vista que todavía no estaba montada cuando pasó.
     */
    ui: (action) => signal(entry, { t: "ui", action }),
  });
  const server = mcpServerFor(session.init, entry.mcpToken);
  return server ? [server] : [];
}

function launch(entry: AcpEntry, viaNpx: boolean) {
  const { agent, cwd } = entry;
  const gen = ++entry.gen;
  /** ¿Sigue siendo éste el arranque vigente? Ver `AcpEntry.gen`. */
  const current = () => entry.gen === gen;
  const start = AcpSession.start({
    agent,
    cwd,
    viaNpx,
    buffers: entry.buffers,
    onFileWrite: (absolutePath, content, mtimeMs) => {
      const note = getIndex().notes.find((candidate) => candidate.abs === absolutePath);
      invalidate();
      if (note) emit(entry, { t: "file-written", id: note.id, content, mtimeMs });
    },
    onEvent: (event) => {
      if (!current()) return;
      if (event.kind === "update") emit(entry, { t: "update", update: event.update });
      if (event.kind === "terminal") emit(entry, { t: "terminal", terminalId: event.terminalId, chunk: event.chunk });
      if (event.kind === "stderr") emit(entry, { t: "stderr", text: event.text });
      if (event.kind === "closed") emit(entry, { t: "closed", error: event.error });
      if (event.kind === "permission") {
        /*
         * El permiso cruza un proceso: quien decide está en el navegador y la
         * promesa que espera está aquí. Se le pone un id y se guarda el
         * `respond` — sin ese id no habría forma de saber a qué petición
         * contesta un mensaje que llega por el socket, y un agente puede tener
         * más de una abierta.
         */
        const requestId = `perm-${++entry.permissionSeq}`;
        entry.pending.set(requestId, event.respond);
        emit(entry, { t: "permission", requestId, request: event.request });
      }
    },
  });

  /*
   * UN solo `catch`, envolviendo también lo que pasa DESPUÉS de arrancar.
   *
   * Esto era un `.then(ok, fail)`, y así el fallo de `newSession` —que ocurre
   * dentro de la rama de éxito— no lo veía ningún manejador: salía como
   * rechazo no atendido y **tiraba el proceso del servidor entero**, con las
   * demás conversaciones y la app con él. Se reprodujo con una cuenta de
   * Gemini caducada, que arranca bien y contesta `initialize` para reventar en
   * `session/new`. Es el caso normal de una credencial vencida, no una rareza.
   */
  void start.then(async (session) => {
    // Un arranque superado que sí llegó a levantar el proceso tiene que
    // cerrarlo: si no, queda un agente huérfano corriendo por cada reintento.
    if (!current()) { session.close(); return; }
    entry.session = session;
    try {
      await session.newSession(cwd, attachMcp(entry, session));
    } catch (error) {
      if (session.authMethods.length) {
        entry.phase = "auth";
        emit(entry, authRequiredMessage(session, error));
        return;
      }
      throw error;
    }
    if (!current()) { session.close(); return; }
    entry.phase = "live";
    emit(entry, readyMessage(entry, session));
  }).catch((error: unknown) => {
    if (!current()) return;
    const missing = error instanceof AgentNotFoundError ? error : null;
    emit(entry, {
      t: "error",
      message: error instanceof Error ? error.message : String(error),
      code: missing ? "agent-not-found" : error instanceof NpxNotFoundError ? "npx-not-found" : undefined,
      command: missing?.preset.command,
      agent: missing?.preset.id,
      install: missing ? installCommand(missing.preset, process.platform === "win32") : undefined,
      // Solo se ofrece si el camino existe Y no es el que se acaba de
      // intentar: reofrecer npx después de que npx haya fallado sería un botón
      // que repite el mismo fallo.
      npx: missing?.canUseNpx && !viaNpx ? `npx -y ${missing.preset.npm}` : undefined,
    });
    // Si llegó a arrancar y murió en `session/new`, el proceso sigue vivo sin
    // nadie que le hable. La entrada se queda —el error tiene que seguir ahí
    // al reengancharse— pero el hijo no.
    entry.session?.close();
    entry.session = null;
    entry.phase = "failed";
  });
}

/** Authenticate through the agent, then retry session creation in-place. */
export async function authenticateSession(entry: AcpEntry, methodId: string) {
  const session = entry.session;
  if (!session || entry.phase !== "auth") return;
  emit(entry, { t: "authenticating", methodId, terminal: false });
  try {
    await session.authenticate(methodId);
    await session.newSession(entry.cwd, attachMcp(entry, session));
    entry.phase = "live";
    emit(entry, readyMessage(entry, session));
  } catch (error) {
    entry.phase = "auth";
    emit(entry, authRequiredMessage(session, error));
  }
}

/**
 * Enseña cómo iniciar sesión a mano, y de paso intenta abrir la terminal.
 *
 * La app dejó de ejecutar el inicio de sesión. Un método `type: "terminal"` es
 * un proceso interactivo y ahora corre en la terminal del usuario — ver
 * `src/acp/launchTerminal.ts` para el razonamiento completo y para qué costaba
 * lo contrario.
 *
 * No hay «esperar a que termine». La app no ve el proceso, así que no puede
 * saber cuándo acabó ni si salió bien; lo dice la persona pulsando reintentar,
 * que relanza el agente. Relanzar y no solo repetir `session/new` es
 * deliberado: las credenciales se escriben en disco y el proceso que ya estaba
 * corriendo las leyó al arrancar, cuando todavía no existían.
 */
export async function launchAuthCommand(entry: AcpEntry, methodId: string) {
  const session = entry.session;
  if (!session || entry.phase !== "auth") return;
  try {
    const auth = session.authCommand(methodId);
    const opened = await openInSystemTerminal(auth);
    emit(entry, { t: "auth-manual", methodId, command: shellLine(auth), opened });
  } catch (error) {
    emit(entry, { t: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/** Manda un turno. El texto se emite de vuelta para que TODA ventana abierta lo vea. */
function validatedPromptImages(images: AcpPromptImage[]): AcpPromptImage[] {
  if (images.length > MAX_CHAT_IMAGES) {
    throw new Error(`A prompt can contain at most ${MAX_CHAT_IMAGES} images`);
  }

  let total = 0;
  return images.map((image) => {
    if (!CHAT_IMAGE_MIME_TYPES.has(image.mimeType)) {
      throw new Error(`Unsupported prompt image type: ${image.mimeType}`);
    }
    if (!image.data || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
      throw new Error("Prompt image data is not valid base64");
    }
    const size = Buffer.from(image.data, "base64").byteLength;
    if (size > MAX_CHAT_IMAGE_BYTES) {
      throw new Error(`A prompt image cannot exceed ${MAX_CHAT_IMAGE_BYTES} bytes`);
    }
    total += size;
    if (total > MAX_CHAT_IMAGE_TOTAL_BYTES) {
      throw new Error(`Prompt images cannot exceed ${MAX_CHAT_IMAGE_TOTAL_BYTES} bytes in total`);
    }
    return { ...image, size };
  });
}

export async function promptSession(
  entry: AcpEntry,
  text: string,
  resources: AcpPromptResource[] = [],
  images: AcpPromptImage[] = [],
) {
  if (!entry.session) return emit(entry, { t: "error", message: "La sesión todavía no está lista" });
  if (entry.busy) return emit(entry, { t: "error", message: "Hay un turno en curso" });
  let acceptedImages: AcpPromptImage[];
  try {
    acceptedImages = validatedPromptImages(images);
    if (acceptedImages.length && !entry.session.acceptsImages) {
      throw new Error("This agent does not support image prompts");
    }
    if (!text.trim() && !resources.length && !acceptedImages.length) {
      throw new Error("A prompt must contain text, a resource, or an image");
    }
  } catch (error) {
    return emit(entry, { t: "error", message: error instanceof Error ? error.message : String(error) });
  }
  entry.busy = true;
  emit(entry, { t: "sent", text, ...(acceptedImages.length ? { images: acceptedImages } : {}) });
  try {
    const links = resources.flatMap((resource) => {
      const note = findNote(getIndex(), resource.id);
      const absolute = note ? resolveId(note.id) : null;
      if (!note || !absolute) return [];
      return [{
        name: note.slug,
        title: resource.title || note.title,
        uri: pathToFileURL(absolute).href,
        mimeType: "text/markdown",
        description: resource.description ?? note.excerpt,
      }];
    });
    const res = await entry.session.prompt(text, links, acceptedImages);
    emit(entry, { t: "turn", stopReason: res.stopReason });
  } catch (error) {
    emit(entry, { t: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    entry.busy = false;
    /*
     * Un permiso que sigue abierto cuando el turno ya acabó no lo va a
     * contestar nadie: el agente abortó su lado y la promesa se resolvió sola
     * como `cancelled`. Hay que decirlo, o la interfaz deja un diálogo en
     * pantalla esperando una decisión que ya no sirve para nada.
     */
    for (const requestId of entry.pending.keys()) emit(entry, { t: "permission-done", requestId, optionId: null });
    entry.pending.clear();
  }
}

/** Update the server-side mirror of an unsaved CodeMirror document. */
export function syncAcpBuffer(entry: AcpEntry, id: string, content: string) {
  const absolute = resolveId(id);
  if (!absolute) return;
  entry.buffers.set(absolute, { content, updatedAt: Date.now() });
}

export function answerPermission(entry: AcpEntry, requestId: string, optionId: string) {
  const respond = entry.pending.get(requestId);
  if (!respond) return;
  entry.pending.delete(requestId);
  respond(optionId);
  emit(entry, { t: "permission-done", requestId, optionId });
}

export async function setConfig(entry: AcpEntry, configId: string, value: string | boolean) {
  if (!entry.session) return;
  try {
    await entry.session.setConfigOption(configId, value);
    // Se reemite como `config_option_update` —el mismo evento que manda un
    // agente que cambia una opción por su cuenta— para que la interfaz tenga
    // un solo camino por el que enterarse, y no dos que puedan discrepar.
    emit(entry, {
      t: "update",
      update: { sessionUpdate: "config_option_update", configOptions: entry.session.configOptions },
    });
  } catch (error) {
    emit(entry, { t: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export function cancelSession(entry: AcpEntry) {
  void entry.session?.cancel();
}

/** Cierra de verdad: mata el agente y sus comandos, y olvida la conversación. */
export function killAcpSession(id: string) {
  const entry = acpSessions.get(id);
  if (!entry) return;
  acpSessions.delete(id);
  releaseMcpEndpoints(id);
  entry.listeners.clear();
  entry.session?.close();
}
