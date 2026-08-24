import { spawn, type ChildProcess } from "node:child_process";
import type * as acp from "@agentclientprotocol/sdk";

/**
 * Terminales del CLIENTE: los comandos que el agente pide ejecutar corren
 * aquí, en un proceso que la app posee, y su salida se ve en vivo.
 *
 * ## Por qué esto no necesita node-pty
 *
 * Porque no hay nada que emular. Una pty existe para engañar a un programa
 * interactivo —un editor, una TUI, un prompt de shell— haciéndole creer que
 * hay una persona al otro lado: le da tamaño de pantalla, señales de trabajo,
 * modo crudo. Aquí no hay nada de eso. `terminal/create` trae `command` y
 * `args` ya separados, el proceso no es interactivo, y lo único que se quiere
 * de él es lo que escriba. Eso es `child_process.spawn` y una tubería.
 *
 * Es también lo que hace el cliente de referencia (`obsidian-agent-client`),
 * que implementa la capacidad entera sin una sola dependencia nativa.
 *
 * ## Por qué implementarla, si el agente puede ejecutar por su cuenta
 *
 * Puede: si el cliente no anuncia `terminal`, el agente lanza el comando él
 * mismo y manda la salida como bloques `content` cuando termina. Funciona,
 * pero la salida llega de golpe y al final. Con la capacidad anunciada, el
 * proceso es nuestro: se ve escribiendo, se puede matar, y el `terminalId`
 * queda embebido en la llamada a herramienta para pintarlo donde toca.
 *
 * Se renderizan las dos rutas —ver `components/AgentChat.tsx`—, porque cuál
 * use cada agente no lo decide esta app.
 */

/** Cuánta salida se retiene por terminal si el agente no pide otra cosa. */
const DEFAULT_BYTE_LIMIT = 1_000_000;

interface Term {
  child: ChildProcess;
  /** Salida cruda en bytes, no en texto: ver `truncateUtf8`. */
  buffer: Buffer;
  limit: number;
  truncated: boolean;
  exit: acp.TerminalExitStatus | null;
  /** Se resuelven cuando el proceso muere; `terminal/wait_for_exit` espera aquí. */
  waiters: ((status: acp.TerminalExitStatus) => void)[];
}

/**
 * Recorta a los últimos `limit` bytes sin partir un carácter por la mitad.
 *
 * El protocolo obliga a recortar por el PRINCIPIO —lo viejo es lo que sobra—
 * y a que el resultado siga siendo texto válido aunque eso deje algún byte
 * por debajo del límite. De ahí que el búfer se guarde como `Buffer` y no
 * como `string`: acumular decodificando trocearía cualquier carácter
 * multibyte que caiga entre dos lecturas de la tubería —un acento, un emoji,
 * una caja de dibujo— y lo dejaría como `` para siempre. En bytes el corte
 * ocurre una sola vez, aquí, y con la información necesaria para hacerlo bien.
 *
 * En UTF-8 los bytes de continuación son `10xxxxxx` (0x80–0xBF); avanzar
 * mientras se vean deja el cursor en el arranque de un carácter completo.
 */
export function truncateUtf8(buf: Buffer, limit: number): { buf: Buffer; truncated: boolean } {
  if (buf.length <= limit) return { buf, truncated: false };
  let start = buf.length - limit;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return { buf: buf.subarray(start), truncated: true };
}

/**
 * Los terminales vivos de UNA sesión.
 *
 * Por sesión y no global porque el ciclo de vida es el de la sesión: cuando
 * la conversación se cierra, todo lo que lanzó tiene que morir con ella. Un
 * registro global obligaría a llevar la cuenta de quién es dueño de qué para
 * poder limpiarlo, que es la contabilidad que este diseño evita.
 */
export interface TerminalRegistryOptions {
  /** Directorio por defecto cuando la petición no trae uno. Normalmente el vault. */
  cwd: string;
  /**
   * Entorno base de los comandos. Lo inyecta quien construye el registro —
   * `AcpSession`, con el mismo `agentEnv()` que ya limpió para el agente— en
   * vez de leerlo aquí: sin eso los dos módulos se importarían mutuamente, y
   * además la política de qué variables se filtran es una sola, no dos.
   */
  env: NodeJS.ProcessEnv;
  /** Cada trozo de salida, en cuanto llega. Es lo que hace posible verlo en vivo. */
  onChunk: (terminalId: string, chunk: string) => void;
}

export class TerminalRegistry {
  private readonly terms = new Map<string, Term>();
  private readonly opts: TerminalRegistryOptions;
  private next = 0;

  constructor(opts: TerminalRegistryOptions) {
    this.opts = opts;
  }

  create(params: acp.CreateTerminalRequest): acp.CreateTerminalResponse {
    const id = `term-${++this.next}`;
    const env: NodeJS.ProcessEnv = { ...this.opts.env };
    for (const v of params.env ?? []) env[v.name] = v.value;

    /*
     * `shell: false` (el default) es deliberado: `command` y `args` llegan ya
     * separados por el protocolo, así que pasarlos por una shell solo
     * añadiría una capa que reinterpreta comillas, `$VAR` y `;` sobre
     * argumentos que el agente ya dio por resueltos. Es la diferencia entre
     * ejecutar lo que pidió y ejecutar lo que su texto parezca decir.
     */
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? this.opts.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const term: Term = {
      child,
      buffer: Buffer.alloc(0),
      limit: params.outputByteLimit ?? DEFAULT_BYTE_LIMIT,
      truncated: false,
      exit: null,
      waiters: [],
    };
    this.terms.set(id, term);

    // stdout y stderr se entrelazan en un solo búfer, como los vería una
    // terminal de verdad: separarlos reordenaría el mensaje de error respecto
    // de la línea que lo provocó, que es justo lo que se quiere leer junto.
    const append = (data: Buffer) => {
      const joined = Buffer.concat([term.buffer, data]);
      const cut = truncateUtf8(joined, term.limit);
      term.buffer = cut.buf;
      term.truncated = term.truncated || cut.truncated;
      this.opts.onChunk(id, data.toString("utf8"));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    const settle = (status: acp.TerminalExitStatus) => {
      if (term.exit) return;
      term.exit = status;
      for (const w of term.waiters) w(status);
      term.waiters.length = 0;
    };
    child.on("exit", (code, signal) => settle({ exitCode: code, signal }));
    // ENOENT y compañía: el proceso nunca arrancó, así que `exit` no llega.
    // Sin esto, `terminal/wait_for_exit` se queda esperando para siempre a un
    // comando que no existe — y el agente con él.
    child.on("error", (e) => {
      append(Buffer.from(`${e.message}\n`, "utf8"));
      settle({ exitCode: 127, signal: null });
    });

    return { terminalId: id };
  }

  output(terminalId: string): acp.TerminalOutputResponse {
    const term = this.get(terminalId);
    return {
      output: term.buffer.toString("utf8"),
      truncated: term.truncated,
      exitStatus: term.exit,
    };
  }

  waitForExit(terminalId: string): Promise<acp.WaitForTerminalExitResponse> {
    const term = this.get(terminalId);
    if (term.exit) return Promise.resolve(term.exit);
    return new Promise((resolve) => term.waiters.push(resolve));
  }

  /** Mata el proceso pero NO olvida el terminal: su salida se sigue pudiendo leer. */
  kill(terminalId: string): void {
    const term = this.get(terminalId);
    try { term.child.kill("SIGTERM"); } catch { /* ya murió */ }
  }

  release(terminalId: string): void {
    const term = this.terms.get(terminalId);
    if (!term) return;
    this.terms.delete(terminalId);
    try { term.child.kill("SIGTERM"); } catch { /* ya murió */ }
    // Al soltar sin haber muerto, quien esperara el final se quedaría colgado.
    for (const w of term.waiters) w({ exitCode: null, signal: "SIGTERM" });
    term.waiters.length = 0;
  }

  /** Todo lo que quede vivo al cerrar la sesión. */
  releaseAll(): void {
    for (const id of [...this.terms.keys()]) this.release(id);
  }

  /*
   * Un id desconocido es un error del protocolo, no un caso vacío: significa
   * que el agente usó un terminal que ya soltó, o uno que nunca creó.
   * Devolver salida vacía lo escondería y el agente seguiría creyendo que
   * espera a algo.
   */
  private get(terminalId: string): Term {
    const term = this.terms.get(terminalId);
    if (!term) throw new Error(`Terminal desconocida: ${terminalId}`);
    return term;
  }
}
