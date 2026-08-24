import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { client, ndJsonStream, methods as M } from "@agentclientprotocol/sdk";
import type * as acp from "@agentclientprotocol/sdk";
import { cleanEnv as agentEnv, runInUserShell } from "../agents.ts";
import { npxArgs, presetById, type AcpPreset } from "./presets.ts";
import { TerminalRegistry } from "./terminal.ts";
import { readAcpTextFile, writeAcpTextFile, type LiveBuffer } from "./filesystem.ts";
import type { AuthCommand } from "./launchTerminal.ts";
import type { AcpPromptImage } from "./wire.ts";

/**
 * Una conversación con un agente por ACP: el proceso, la conexión y la sesión.
 *
 * ## Por qué esto reemplaza a la terminal
 *
 * La terminal incrustada lanzaba la TUI del agente dentro de una pty y le
 * pasaba banderas de línea de comandos. Todo lo que la app quería saber —qué
 * modelos hay, si el agente está pidiendo permiso, qué archivo tocó— tenía que
 * deducirse de secuencias ANSI, o no se sabía. Aquí llega como datos tipados:
 * `session/update` trae bloques de contenido, llamadas a herramienta y diffs;
 * `session/request_permission` es una petición a la que se responde.
 *
 * Y no hace falta emular una terminal, así que **no hace falta node-pty**. Lo
 * único que se lanza es un proceso con stdin/stdout de tuberías normales.
 * El último uso que le quedaba —la pantalla de inicio de sesión— pasó a correr
 * en la terminal del usuario; ver `authCommand` y `launchTerminal.ts`.
 *
 * ## El PATH sigue siendo el problema de siempre
 *
 * Una app lanzada desde el Dock no hereda `.zshrc`, así que `opencode` o
 * `hermes` —instalados en `~/.local/bin` o `~/.opencode/bin`— no existen para
 * ella aunque el usuario los tenga. Se resuelve la ruta absoluta UNA vez, en
 * una shell de login, y se lanza esa ruta. Es la misma trampa que documenta
 * `src/agents.ts`, y la razón de reutilizar su `runInUserShell` en vez de
 * escribir un segundo sondeo que se desincronice.
 */

/** Lo que le llega a quien escucha una sesión, ya normalizado. */
export type AcpEvent =
  | { kind: "update"; update: acp.SessionNotification["update"] }
  | { kind: "permission"; request: acp.RequestPermissionRequest; respond: (optionId: string) => void }
  /**
   * Salida de un comando que corre EN ESTA app, mientras corre.
   *
   * Va aparte del `update` que lo anuncia: la llamada a herramienta llega una
   * vez, con un `terminalId` dentro, y el texto va goteando después. Quien
   * pinta une las dos cosas por ese id.
   */
  | { kind: "terminal"; terminalId: string; chunk: string }
  | { kind: "stderr"; text: string }
  | { kind: "closed"; error?: string };

export interface AcpSessionOptions {
  /** Id de `ACP_PRESETS`. */
  agent: string;
  /** Directorio de trabajo del agente. Normalmente el vault. */
  cwd: string;
  /** Recibe todo lo que produce la sesión. */
  onEvent: (event: AcpEvent) => void;
  /** Live browser buffers, keyed by absolute path. */
  buffers?: Map<string, LiveBuffer>;
  /** Tell browsers that an ACP write replaced an open document. */
  onFileWrite?: (absolutePath: string, content: string, mtimeMs: number) => void;
  /**
   * Lanzar con `npx` cuando el binario no esté instalado.
   *
   * **Nunca por defecto**, y esa es la parte importante: implica bajar un
   * paquete de la red la primera vez, y hacerlo sin preguntar es una descarga
   * silenciosa desde una app que promete no llamar a ningún servicio. Lo pide
   * la persona pulsando el botón que ofrece el error de «no está instalado».
   */
  viaNpx?: boolean;
}

/**
 * El binario no está en el PATH del usuario.
 *
 * Lleva el preset entero, no solo el nombre, para que quien lo muestre pueda
 * ofrecer el comando de instalación sin volver a buscarlo.
 *
 * Los campos se declaran y se asignan a mano: el servidor y el CLI corren bajo
 * `node --experimental-strip-types`, que solo BORRA tipos y no transforma
 * código, así que las propiedades de parámetro (`constructor(readonly x)`) no
 * compilan aunque TypeScript las acepte. Vale para toda clase de este archivo.
 */
export class AgentNotFoundError extends Error {
  readonly preset: AcpPreset;
  /** Se puede ofrecer correrlo con npx sin instalar nada. */
  readonly canUseNpx: boolean;

  constructor(preset: AcpPreset) {
    super(`No se encontró "${preset.command}" en el PATH`);
    this.name = "AgentNotFoundError";
    this.preset = preset;
    this.canUseNpx = Boolean(preset.npm);
  }
}

/**
 * Ni el binario ni npx. Es un fallo distinto y merece decirlo distinto: el
 * primero se arregla instalando el agente, éste significa que no hay Node
 * utilizable donde la app puede verlo, y ningún comando de los que ofrece la
 * app lo va a resolver.
 */
export class NpxNotFoundError extends Error {
  constructor() {
    super("No se encontró \"npx\": hace falta Node.js para ejecutar el adaptador sin instalarlo");
    this.name = "NpxNotFoundError";
  }
}

/**
 * Ruta absoluta del comando, resuelta como la vería una Terminal del usuario.
 *
 * Devuelve `null` cuando no está instalado. NO cae al nombre pelado: lanzar
 * `opencode` a secas desde una app del Dock falla con ENOENT, y el mensaje que
 * el usuario ve entonces ("spawn opencode ENOENT") no dice nada útil. Es mejor
 * saber aquí que falta y decirlo con el nombre y el comando de instalación.
 */
export async function resolveCommand(command: string): Promise<string | null> {
  const win = process.platform === "win32";
  const probe = win
    ? `$c = Get-Command '${command}' -ErrorAction SilentlyContinue; if ($c) { Write-Output $c.Source }`
    : `command -v ${command} 2>/dev/null`;
  const { stdout, ok } = await runInUserShell(probe, 12_000);
  if (!ok) return null;
  return parseResolvedPath(stdout, win);
}

/**
 * Se queda con la primera línea que parece una ruta absoluta.
 *
 * Separado para poder probarlo: lo de arriba levanta una shell de login y en CI
 * no hay ninguna, pero todo lo que puede salir mal de verdad está aquí. Una zsh
 * interactiva imprime su propio ruido —«Restored session: …»— mezclado con la
 * respuesta, y en Windows `Get-Command` resuelve alias y funciones que
 * devuelven un nombre en vez de una ruta y no se pueden lanzar.
 */
export function parseResolvedPath(stdout: string, win = process.platform === "win32"): string | null {
  for (const line of stdout.split("\n")) {
    const p = line.trim();
    const absolute = win ? /^[a-zA-Z]:[\\/]/.test(p) : p.startsWith("/");
    if (absolute) return p;
  }
  return null;
}

/**
 * Entorno para el proceso del agente.
 *
 * Es el mismo `cleanEnv` que usa la shell de sondeo (`src/agents.ts`), y esa
 * unidad importa: la política de qué variables se filtran tiene que ser UNA.
 * Estaban duplicadas, y la copia de aquí quitaba `npm_config_prefix` mientras
 * la del sondeo no — con lo que el agente arrancaba en un entorno sano pero
 * nunca llegaba a encontrarse, porque quien lo buscaba miraba en uno roto.
 *
 * Se reexporta con el nombre viejo porque es lo que nombran las pruebas y lo
 * que se lee bien desde aquí: en este archivo lo que se está construyendo es
 * el entorno *del agente*.
 */
export { cleanEnv as agentEnv } from "../agents.ts";

/**
 * Con qué comando arrancar el agente.
 *
 * Dos caminos, y el orden importa: **primero el binario instalado**. Si el
 * usuario ya tiene el adaptador, usarlo es más rápido, funciona sin red y
 * respeta la versión que él eligió. npx solo entra cuando no hay nada que
 * usar, y solo si alguien lo pidió.
 *
 * Se resuelve `npx` por el mismo camino que todo lo demás —una shell de
 * login— porque tiene exactamente el mismo problema: con Node instalado por
 * nvm, `npx` vive en `~/.nvm/versions/node/<v>/bin`, que una app lanzada desde
 * el Dock no tiene en su PATH.
 */
async function resolveLaunch(preset: AcpPreset, viaNpx: boolean): Promise<{ command: string; args: string[] }> {
  const bin = await resolveCommand(preset.command);
  if (bin) return { command: bin, args: preset.args };

  const viaPackage = viaNpx ? npxArgs(preset) : null;
  if (!viaPackage) throw new AgentNotFoundError(preset);

  const npx = await resolveCommand("npx");
  if (!npx) throw new NpxNotFoundError();
  return { command: npx, args: viaPackage };
}

/**
 * El entorno del agente, con las rutas que su preset pida (`envFrom`).
 *
 * Un binario que no se encuentra simplemente no define su variable: el
 * adaptador hará lo que hiciera antes. Es una ayuda, no un requisito, y fallar
 * por ella sería peor que no darla.
 */
async function presetEnv(preset: AcpPreset): Promise<NodeJS.ProcessEnv> {
  const env = agentEnv();
  for (const [key, command] of Object.entries(preset.envFrom ?? {})) {
    const resolved = await resolveCommand(command);
    if (resolved) env[key] = resolved;
  }
  return env;
}

/**
 * Id reservado para el desplegable de modo que se sintetiza a partir de la API
 * vieja. Lleva prefijo `acp:` para no poder chocar nunca con un `configId` que
 * mande un agente de verdad.
 */
export const LEGACY_MODE_ID = "acp:legacy-mode";

/** Lo mismo para el desplegable de modelo. Ver `fromLegacy`. */
export const LEGACY_MODEL_ID = "acp:legacy-model";

/** El modelo en uso, cuando el agente solo lo dice por la API vieja. */
export interface AnnouncedModel {
  id: string;
  /** Nombre para pintar, con proveedor si lo trae. */
  label: string;
}

/** Lo que el agente anuncia sobre sí mismo y va cambiando durante la sesión. */
interface Announced {
  configOptions: acp.SessionConfigOption[];
  availableCommands: acp.AvailableCommand[];
  model: AnnouncedModel | null;
}

/**
 * Traduce las APIs `modes`/`models` —obsoletas pero MUY vivas— a lo que la
 * interfaz ya sabe pintar.
 *
 * El esquema dice que `configOptions` las sustituye, y la fase 1 concluyó que
 * Hermes «no anuncia ninguna opción». Eso era mirar por la ventana
 * equivocada: Hermes 0.20.5 manda `configOptions: null` y, al lado,
 * **doce modelos y tres modos** por los campos viejos. La conclusión de que su
 * modelo se elegía solo fuera de la app era falsa, y el usuario lo vio antes
 * que las pruebas — su TUI enseña el modelo y el panel de la app no.
 *
 * **Los dos se pueden cambiar**, y los dos salen como desplegable. La versión
 * anterior de este comentario decía que los modelos no: que
 * `session/select_model` contestaba «Method not found» y que el método no
 * existía en el SDK. Las dos mitades eran ciertas y la conclusión falsa, porque
 * ese no es el nombre del método. El que existe —en el SDK y en el adaptador de
 * Hermes 0.20.5, comprobado sobre el cable— es `session/set_model`, y contesta
 * a los 24 modelos que Hermes anuncia, incluso a los de OTRO proveedor: su
 * `set_session_model` reconstruye el agente con el proveedor que pida el id.
 *
 * De ahí que el modelo ya no se pinte como texto cuando llega por esta vía. Un
 * texto era lo honesto mientras no se pudiera elegir; con el método bueno, es
 * esconder el control que el usuario buscaba fuera de la app.
 */
/**
 * El bloque `models` de `session/new`, tipado a mano.
 *
 * El SDK 1.4.0 ya NO lo declara en `NewSessionResponse` —se dio por retirado
 * con el resto de la API vieja— pero los agentes lo siguen mandando: Hermes
 * 0.20.5 manda doce modelos por ahí. El tipo no está en el SDK y el dato sí
 * está en el cable, así que se declara aquí en vez de fingir que no llega.
 */
interface LegacyModels {
  currentModelId?: string;
  availableModels?: { modelId: string; name: string; description?: string }[];
}

/**
 * Lo que `fromLegacy` mira de verdad.
 *
 * Se escribe así y no como `NewSessionResponse` porque `session/load` contesta
 * lo mismo MENOS el `sessionId` —ya se sabe cuál es, se acaba de pedir— y esta
 * función nunca lo usó. Pedir el tipo entero obligaba a inventarse un id para
 * poder reutilizarla desde la carga.
 */
type LegacyAnnounce = {
  modes?: acp.SessionModeState | null;
  models?: LegacyModels | null;
};

export function fromLegacy(res: LegacyAnnounce): { options: acp.SessionConfigOption[]; model: AnnouncedModel | null } {
  const options: acp.SessionConfigOption[] = [];

  const modes = res.modes;
  if (modes?.availableModes?.length) {
    options.push({
      id: LEGACY_MODE_ID,
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: modes.currentModeId,
      options: modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description })),
    });
  }

  const models = res.models;
  const available = models?.availableModels ?? [];
  const current = available.find((m) => m.modelId === models?.currentModelId);

  if (available.length > 1) {
    options.push({
      id: LEGACY_MODEL_ID,
      name: "Model",
      category: "model",
      type: "select",
      currentValue: models?.currentModelId ?? available[0]!.modelId,
      options: available.map((m) => ({ value: m.modelId, name: m.name, description: m.description })),
    });
    // Ya hay control: el texto de al lado diría lo mismo dos veces.
    return { options, model: null };
  }

  // Un solo modelo no es una elección. Se queda como texto, que es lo que es.
  return { options, model: current ? { id: current.modelId, label: current.name } : null };
}

export class AcpSession {
  readonly preset: AcpPreset;
  /** Lo que el agente contestó a `initialize`: capacidades y métodos de auth. */
  readonly init: acp.InitializeResponse;

  private readonly child: ChildProcessWithoutNullStreams;
  private readonly conn: acp.ClientConnection;
  private readonly announced: Announced;
  private readonly terminals: TerminalRegistry;
  private readonly launch: { command: string; args: string[] };
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;

  /** Id de la sesión ACP viva, o `null` antes de `newSession()`. */
  private id: string | null = null;

  private constructor(parts: {
    preset: AcpPreset;
    child: ChildProcessWithoutNullStreams;
    conn: acp.ClientConnection;
    init: acp.InitializeResponse;
    announced: Announced;
    terminals: TerminalRegistry;
    launch: { command: string; args: string[] };
    env: NodeJS.ProcessEnv;
    cwd: string;
  }) {
    this.preset = parts.preset;
    this.child = parts.child;
    this.conn = parts.conn;
    this.init = parts.init;
    this.announced = parts.announced;
    this.terminals = parts.terminals;
    this.launch = parts.launch;
    this.env = parts.env;
    this.cwd = parts.cwd;
  }

  /**
   * Opciones que el agente dice tener AHORA: modelo, modo, nivel de
   * razonamiento. Es la lista que pinta la interfaz — no hay ninguna tabla de
   * modelos en el código, y por eso no puede quedarse vieja.
   */
  get configOptions(): acp.SessionConfigOption[] { return this.announced.configOptions; }

  /** Comandos de barra que el agente anuncia (las skills del vault, entre otros). */
  get availableCommands(): acp.AvailableCommand[] { return this.announced.availableCommands; }

  /** Modelo en uso cuando el agente solo lo dice por la API vieja. */
  get model(): AnnouncedModel | null { return this.announced.model; }

  /** Id de la sesión ACP, o `null` si `newSession()` todavía no corrió. */
  get sessionId(): string | null { return this.id; }

  /** Authentication methods advertised during initialization. */
  get authMethods(): acp.AuthMethod[] { return this.init.authMethods ?? []; }

  /** Whether this agent accepts image content blocks in prompts. */
  get acceptsImages(): boolean {
    return this.init.agentCapabilities?.promptCapabilities?.image === true;
  }

  static async start(opts: AcpSessionOptions): Promise<AcpSession> {
    const preset = presetById(opts.agent);
    if (!preset) throw new Error(`Agente desconocido: ${opts.agent}`);

    const launch = await resolveLaunch(preset, opts.viaNpx ?? false);
    const env = await presetEnv(preset);

    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    // Hermes escribe su bitácora aquí y algunos adaptadores reportan errores de
    // autenticación solo por stderr. Sin esto, un agente que no arranca por
    // falta de credenciales se ve como un silencio.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => opts.onEvent({ kind: "stderr", text }));

    /*
     * El estado que el agente anuncia vive en un objeto aparte, no en el `this`
     * de la clase, porque los manejadores se registran ANTES de que la
     * instancia exista: `initialize` tiene que responderse para saber si
     * siquiera hay agente con el que construirla. Un `const self` declarado más
     * abajo estaría en zona muerta temporal para cualquier notificación que
     * llegue durante el arranque — y Hermes manda su primera antes del
     * `initialize`.
     */
    const announced: Announced = { configOptions: [], availableCommands: [], model: null };

    const terminals = new TerminalRegistry({
      cwd: opts.cwd,
      env,
      onChunk: (terminalId, chunk) => opts.onEvent({ kind: "terminal", terminalId, chunk }),
    });

    const app = client({ name: "summa-wiki" })
      .onNotification(M.client.session.update, ({ params }) => {
        if (params.update.sessionUpdate === "config_option_update") {
          announced.configOptions = params.update.configOptions ?? announced.configOptions;
        }
        if (params.update.sessionUpdate === "available_commands_update") {
          announced.availableCommands = params.update.availableCommands ?? announced.availableCommands;
        }
        opts.onEvent({ kind: "update", update: params.update });
      })
      /*
       * El permiso NO se decide aquí.
       *
       * Se emite hacia arriba con un `respond` y la promesa queda pendiente
       * hasta que alguien lo llame. Es lo que convierte el permiso en una
       * decisión de la persona en vez de una bandera que se le pasó al CLI y
       * que uno espera que respete: el camino viejo tenía tres banderas mal —
       * `--yes` que opencode ignora en silencio, entre ellas— y la interfaz
       * prometía cosas que no ocurrían.
       */
      .onRequest(M.client.session.requestPermission, ({ params, signal }) => {
        return new Promise<acp.RequestPermissionResponse>((resolve) => {
          // Si el turno se cancela, el protocolo EXIGE responder `cancelled`;
          // dejar la promesa colgada bloquea al agente para siempre.
          signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } }), { once: true });
          opts.onEvent({
            kind: "permission",
            request: params,
            respond: (optionId) => resolve({ outcome: { outcome: "selected", optionId } }),
          });
        });
      });

    /*
     * Las cinco de terminal. Se registran SIEMPRE, en pareja con el
     * `terminal: true` de más abajo: anunciar la capacidad sin atender los
     * métodos deja al agente llamando a un hueco.
     *
     * `wait_for_exit` es la única que espera de verdad, y por eso devuelve la
     * promesa tal cual en vez de resolverla aquí — un comando puede tardar
     * minutos y el resto de la conversación sigue corriendo mientras tanto.
     */
    app
      .onRequest(M.client.fs.readTextFile, ({ params }) => ({
        content: readAcpTextFile(
          { root: opts.cwd, buffers: opts.buffers ?? new Map() },
          params.path,
          params.line,
          params.limit,
        ),
      }))
      .onRequest(M.client.fs.writeTextFile, ({ params }) => {
        writeAcpTextFile(
          { root: opts.cwd, buffers: opts.buffers ?? new Map(), onWrite: opts.onFileWrite },
          params.path,
          params.content,
        );
        return {};
      })
      .onRequest(M.client.terminal.create, ({ params }) => terminals.create(params))
      .onRequest(M.client.terminal.output, ({ params }) => terminals.output(params.terminalId))
      .onRequest(M.client.terminal.waitForExit, ({ params }) => terminals.waitForExit(params.terminalId))
      .onRequest(M.client.terminal.kill, ({ params }) => { terminals.kill(params.terminalId); return {}; })
      .onRequest(M.client.terminal.release, ({ params }) => { terminals.release(params.terminalId); return {}; });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = app.connect(stream);

    const init = await conn.agent.request(M.agent.initialize, {
      protocolVersion: 1,
      /*
       * Tool terminals stream output through the app. Auth terminals allow
       * agents to advertise browser/code login flows that require a real PTY.
       * Filesystem reads prefer live CodeMirror buffers. Markdown writes pass
       * through the provenance handler before reaching disk.
       */
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
        auth: { terminal: true },
      },
      clientInfo: { name: "summa-wiki", version: "0.4.0" },
    });

    conn.closed.then(
      () => opts.onEvent({ kind: "closed" }),
      (e) => opts.onEvent({ kind: "closed", error: String(e) }),
    );
    return new AcpSession({ preset, child, conn, init, announced, terminals, launch, env, cwd: opts.cwd });
  }

  /**
   * Abre una sesión nueva y guarda lo que el agente anuncie de ella.
   *
   * `mcpServers` es lo que le da al agente las herramientas del wiki. Va aquí
   * y no en `initialize` porque es una propiedad de la SESIÓN: el agente se
   * conecta a esos servidores al crearla, y una conversación abierta contra
   * otro vault querría otros. Ver `src/mcp/attach.ts` para qué transporte
   * recibe cada agente y por qué.
   */
  async newSession(cwd: string, mcpServers: acp.McpServer[] = []): Promise<string> {
    const res = await this.conn.agent.request(M.agent.session.new, { cwd, mcpServers });
    this.id = res.sessionId;
    this.absorb(res);
    return res.sessionId;
  }

  /**
   * Lo que el agente anuncia DE la sesión, venga de abrirla o de cargarla.
   *
   * `session/new` y `session/load` contestan la misma forma, y una sesión
   * cargada que no pasara por aquí se quedaría con los desplegables de la
   * anterior: el modo y el modelo son estado de la conversación, no del
   * proceso, y una conversación vieja puede haberse quedado en otro modelo.
   */
  private absorb(res: LegacyAnnounce & { configOptions?: acp.SessionConfigOption[] | null }) {
    this.announced.configOptions = res.configOptions ?? [];
    // La API vieja solo se mira si la nueva vino vacía: un agente que manda las
    // dos ya dijo lo que quería decir, y duplicar el desplegable de modo sería
    // ofrecer dos controles para lo mismo.
    if (!this.announced.configOptions.length) {
      const legacy = fromLegacy(res);
      this.announced.configOptions = legacy.options;
      this.announced.model = legacy.model;
    }
  }

  /** ¿Sabe este agente enumerar sus conversaciones anteriores? */
  get canListSessions(): boolean {
    return Boolean(this.init.agentCapabilities?.sessionCapabilities?.list);
  }

  /** ¿Y volver a abrir una? Las dos hacen falta para que la lista sirva de algo. */
  get canLoadSession(): boolean {
    return Boolean(this.init.agentCapabilities?.loadSession);
  }

  /**
   * Las conversaciones anteriores que el agente guarda para este directorio.
   *
   * **El listado lo tiene el agente, no la app.** Es la decisión de fondo de
   * esta función y merece decirse: la alternativa era que Summa apuntara en un
   * archivo propio cada sesión que abre. Eso habría dado una lista que solo
   * conoce las conversaciones nacidas aquí —no las de la CLI del mismo
   * agente—, que se queda desfasada en cuanto alguien borra una por fuera, y
   * que hay que migrar cada vez que cambie. Preguntándoselo al agente, lo que
   * se ve en Summa es exactamente lo que el harness tiene.
   *
   * Se filtra por `cwd` a propósito: las conversaciones de otro vault hablan
   * de archivos que aquí no existen. Comprobado que los cuatro harnesses
   * instalados respetan el filtro — Claude Code baja de 85 a 71, Hermes de 15
   * a 8.
   */
  async listSessions(cwd: string, cursor?: string): Promise<acp.ListSessionsResponse> {
    return this.conn.agent.request(M.agent.session.list, { cwd, cursor });
  }

  /**
   * Reabre una conversación anterior en ESTE proceso de agente.
   *
   * No hay que reproducir nada a mano: el agente vuelve a mandar la
   * conversación entera por `session/update`, las mismas notificaciones que
   * manda en vivo, así que el reductor de la transcripción la rearma sin saber
   * que es historia. Por eso esta función no devuelve los mensajes — para
   * cuando la promesa se resuelve, ya pasaron por `onEvent`.
   */
  async loadSession(sessionId: string, cwd: string, mcpServers: acp.McpServer[] = []): Promise<void> {
    const res = await this.conn.agent.request(M.agent.session.load, { sessionId, cwd, mcpServers });
    this.id = sessionId;
    // `session/load` puede contestar vacío: el esquema deja la respuesta en
    // opcional y sólo trae modos y opciones cuando el agente los tiene.
    if (res) this.absorb(res);
  }

  /**
   * Run an agent-managed authentication method.
   *
   * Terminal methods are intentionally rejected here. ACP requires the client
   * to relaunch the configured agent invocation as an interactive process for
   * those methods; passing one to `authenticate` violates the protocol.
   */
  async authenticate(methodId: string): Promise<void> {
    const method = this.authMethods.find((candidate) => candidate.id === methodId);
    if (!method) throw new Error(`Unknown authentication method: ${methodId}`);
    if ("type" in method && method.type === "terminal") {
      throw new Error(`Authentication method ${methodId} requires an interactive terminal`);
    }
    await this.conn.agent.request(M.agent.authenticate, { methodId });
  }

  /**
   * El comando que hay que correr para un método de autenticación de terminal.
   *
   * NO lo ejecuta: lo describe. Un método `type: "terminal"` es, por contrato,
   * un proceso interactivo — el adaptador de Claude Code abre un navegador y
   * espera a que se pegue un código—, y un proceso interactivo necesita una
   * terminal de verdad. La app tenía una incrustada y costaba `node-pty`, un
   * módulo nativo de 63 MB, para una pantalla que se ve una vez por máquina.
   *
   * Ahora corre en la terminal del usuario (`launchTerminal.ts`) y la app
   * vuelve a preguntar después. La invocación es la MISMA que la del agente
   * más los argumentos del método, que es lo que el protocolo exige: es el
   * mismo binario en el mismo directorio, no un comando parecido.
   */
  authCommand(methodId: string): AuthCommand {
    const method = this.authMethods.find((candidate) => candidate.id === methodId);
    if (!method || !("type" in method) || method.type !== "terminal") {
      throw new Error(`Authentication method ${methodId} is not a terminal method`);
    }
    return {
      command: this.launch.command,
      args: [...this.launch.args, ...(method.args ?? [])],
      // Solo lo que el MÉTODO pide. Volcar aquí el entorno entero del agente
      // llenaría de ruido ilegible una línea que una persona tiene que leer y
      // pegar, y en la terminal del usuario el resto ya está.
      env: (method.env ?? {}) as Record<string, string>,
      cwd: this.cwd,
    };
  }

  /**
   * Manda un mensaje y espera a que termine el turno.
   *
   * El texto de la respuesta NO se devuelve: va llegando por `onEvent` como
   * `agent_message_chunk` mientras se genera. Lo que se devuelve es por qué
   * paró — `end_turn`, `cancelled`, `max_tokens`— que es lo que la interfaz
   * necesita para saber si dibujar el turno como terminado o interrumpido.
   */
  async prompt(
    text: string,
    resources: acp.ResourceLink[] = [],
    images: AcpPromptImage[] = [],
  ): Promise<acp.PromptResponse> {
    if (!this.id) throw new Error("prompt() antes de newSession()");
    return this.conn.agent.request(M.agent.session.prompt, {
      sessionId: this.id,
      prompt: [
        ...images.map((image) => ({
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
        })),
        ...(text ? [{ type: "text" as const, text }] : []),
        ...resources.map((resource) => ({ type: "resource_link" as const, ...resource })),
      ],
    });
  }

  /** Interrumpe el turno en curso. El agente responde con `stopReason: cancelled`. */
  async cancel(): Promise<void> {
    if (!this.id) return;
    await this.conn.agent.notify(M.agent.session.cancel, { sessionId: this.id });
  }

  /**
   * Cambia una opción anunciada por el agente (modelo, modo, …).
   *
   * Un solo método para todas: el protocolo dejó obsoletos `modes` y `models`
   * por `configOptions`, y la interfaz pinta lo que venga sin saber qué
   * significa. Por eso elegir modelo dejó de ser conocimiento de esta app.
   *
   * El valor va **etiquetado** (`type: "id" | "boolean"`), que es lo que
   * permite que el mismo método sirva para un desplegable de modelos y para un
   * interruptor. Mandar la cadena pelada es el error fácil aquí: el esquema lo
   * rechaza, y el campo se llama `configId`, no `optionId`.
   */
  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    if (!this.id) throw new Error("setConfigOption() antes de newSession()");

    // El desplegable de modo sintetizado no existe para el agente: lo suyo es
    // `session/set_mode`, y mandarle un `set_config_option` con un id inventado
    // por nosotros sería pedirle algo que no puede entender.
    /*
     * Igual que el modo: el id lo inventamos nosotros, así que hay que
     * traducirlo al método que el agente sí conoce antes de mandarlo.
     */
    if (configId === LEGACY_MODEL_ID) {
      /*
       * Por el nombre literal y no por `M.agent.session.*`: el mapa de métodos
       * del SDK v1 no lo lista —solo el v2 y `protocol.js`, que ya lo marca
       * como método de sesión—, así que la constante no existe y hay que usar
       * la sobrecarga cruda. El método sí está en el cable: comprobado contra
       * Hermes 0.20.5, que contesta `{}` tanto a un modelo del mismo proveedor
       * como a uno de otro.
       */
      await this.conn.agent.request<unknown>("session/set_model", { sessionId: this.id, modelId: String(value) });
      const model = this.announced.configOptions.find((o) => o.id === LEGACY_MODEL_ID);
      if (model && model.type === "select") model.currentValue = String(value);
      return;
    }

    if (configId === LEGACY_MODE_ID) {
      await this.conn.agent.request(M.agent.session.setMode, { sessionId: this.id, modeId: String(value) });
      /*
       * Se actualiza en el sitio y no con `map`: el tipo de `configOptions` es
       * una unión discriminada por `type`, y un `{ ...o, currentValue }`
       * genérico la aplana a algo que ya no encaja en ninguna de las dos ramas.
       */
      const mode = this.announced.configOptions.find((o) => o.id === LEGACY_MODE_ID);
      if (mode && mode.type === "select") mode.currentValue = String(value);
      return;
    }

    const tagged = typeof value === "boolean"
      ? { type: "boolean" as const, value }
      : { type: "id" as const, value };
    const res = await this.conn.agent.request(M.agent.session.setConfigOption, {
      sessionId: this.id,
      configId,
      ...tagged,
    });
    this.announced.configOptions = res.configOptions ?? this.announced.configOptions;
  }

  close() {
    // Los comandos que lanzó el agente son procesos aparte y no mueren con él:
    // sin esto, cerrar una conversación con un `npm run dev` dentro deja el
    // servidor corriendo sin nadie que lo mire.
    this.terminals.releaseAll();
    try { this.conn.close(); } catch { /* ya estaba cerrada */ }
    try { this.child.kill(); } catch { /* ya murió */ }
  }
}
