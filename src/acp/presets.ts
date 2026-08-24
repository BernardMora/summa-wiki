/**
 * Qué agentes sabe lanzar la app, y con qué comando.
 *
 * **Esta tabla sustituye a cinco.** El camino viejo (`src/agents.ts` +
 * `components/agent-session.ts`) tenía que saber, por cada CLI: su binario, la
 * sintaxis de `--model`, las banderas de permiso, y si reanudar era una bandera
 * o un subcomando. Cuatro tablas paralelas que se desincronizaban, y cuyos
 * fallos eran silenciosos: `opencode` acepta banderas que no conoce y las
 * ignora, así que una bandera copiada de Claude Code producía un botón que
 * prometía no preguntar y preguntaba igual.
 *
 * Con ACP nada de eso se declara aquí. El agente **anuncia** sus modelos y sus
 * modos en `session/new` (`configOptions`), pide permiso por
 * `session/request_permission`, y reanuda por `session/load`. Lo único que
 * sigue siendo conocimiento local es cómo se arranca el proceso.
 *
 * ## Adaptador o nativo
 *
 * Solo dos de los siete necesitan un paquete aparte: Claude Code y Codex se
 * envuelven con un adaptador (`claude-agent-acp`, `codex-acp`). Los otros cinco
 * hablan ACP de fábrica, como subcomando o bandera. La dirección del ecosistema
 * es hacia lo nativo, así que esta superficie encoge con el tiempo en vez de
 * crecer — razón de más para no volver a construir una tabla de banderas.
 */

/** Dónde conseguir un agente que no está instalado. */
export interface AcpInstallHint {
  /** Comando para macOS y Linux. */
  default: string;
  /** Solo cuando Windows nativo necesita otro (no WSL, que usa `default`). */
  nativeWindows?: string;
}

export interface AcpPreset {
  /** Id estable. Es la clave del registro y lo que guarda la configuración. */
  id: string;
  /** Nombre propio. No se traduce. */
  name: string;
  /** Logo shipped with the app, never requested from the network at runtime. */
  logo: string;
  /** Installation and authentication documentation for the agent or adapter. */
  docs: string;
  /** Ejecutable a resolver en el PATH del usuario. */
  command: string;
  /** Argumentos que lo ponen en modo ACP. Vacío cuando el binario ya lo es. */
  args: string[];
  /** Additional user commands required by an adapter. */
  requires?: string[];
  /**
   * `true` cuando el comando es un adaptador aparte del CLI del agente.
   *
   * Lo usa el onboarding para decir la verdad sobre cuántas cosas hay que
   * instalar: para `opencode` basta el CLI, para Claude Code hacen falta el CLI
   * (para la sesión iniciada) y además el adaptador.
   */
  adapter: boolean;
  /**
   * Paquete npm que provee `command`. Solo los adaptadores lo tienen.
   *
   * Es lo que habilita el camino de `npx`: cuando el binario no está en el
   * PATH, se puede ofrecer ejecutarlo sin instalar nada, porque npm lo baja a
   * su caché la primera vez y lo reutiliza después. Con los demás no se puede
   * — se instalan con un script de shell, no desde el registro de npm.
   *
   * **Sin versión.** El `@latest` se le pone al comando de instalación
   * (`installCommand`), donde el usuario decide una vez y para siempre; para
   * npx sería lo contrario de lo que se quiere: obliga a consultar la red en
   * cada arranque en vez de usar lo que ya está en caché.
   */
  npm?: string;
  /**
   * Variables de entorno cuyo valor es **la ruta de un binario del usuario**.
   * La clave es la variable; el valor, el comando a resolver en su PATH.
   *
   * Existe por un caso concreto y recurrente: un adaptador que no encuentra el
   * CLI que envuelve intenta descargarse el suyo. `antigravity-acp` lo hace, y
   * la descarga da 404 — así que en cada arranque se paga una llamada a la red
   * para nada y el panel de diagnóstico se llena de un aviso alarmante sobre
   * un fallo del que ya se recuperó. Decirle dónde está el binario que el
   * usuario YA tiene lo evita entero, y de paso garantiza que el agente corre
   * con la versión que el usuario instaló y no con otra que se bajó por su
   * cuenta.
   *
   * Se resuelve con el mismo sondeo por shell de login que el comando
   * principal, porque tiene el mismo problema: `agy` vive en `~/.local/bin`.
   * Si no se encuentra, no se define la variable y el adaptador hace lo que
   * hiciera antes.
   */
  envFrom?: Record<string, string>;
  /**
   * Comando con el que se configura el agente FUERA de la app.
   *
   * Solo para los que no anuncian NADA: ni `configOptions` ni las APIs viejas
   * `models`/`modes`. Sin esto, un panel sin controles se ve averiado sin
   * estarlo, y ésta es la frase que falta.
   *
   * Hoy no lo usa nadie. Se escribió para Hermes, sobre la conclusión —falsa—
   * de que su modelo solo se elegía con `hermes model`: lo anuncia por la API
   * vieja, que es lo que la fase 1 no miró. Se conserva porque el caso es real
   * y volverá a aparecer.
   */
  configHint?: string;
  /**
   * Cómo instalarlo a mano. Opcional porque los que vienen de npm no lo
   * necesitan: su comando se deriva de `npm` y así los dos no pueden discrepar.
   */
  install?: AcpInstallHint;
  /**
   * The page that explains how to INSTALL it, when that is not `docs`.
   *
   * `docs` is the entry point to a project's documentation, which is what the
   * onboarding wants. The missing-agent notice wants something narrower, and
   * for most vendors it is a different address: Kiro's `docs` covers its ACP
   * mode, and OpenCode has no install page at all — the instructions are an
   * anchor on its front page.
   *
   * It also covers the case where what is missing is not the harness:
   * Antigravity fails because Bun is not installed, and sending someone to
   * Antigravity's own site to install Bun sends them to the wrong place.
   *
   * Defaults to `docs`, which is right when the two coincide.
   */
  installDocs?: string;
}

/**
 * Los agentes conocidos, en orden de aparición en la interfaz.
 *
 * Añadir uno es **una entrada aquí**. Compárese con lo que costaba antes:
 * tocar `AGENT_BINARIES`, `MODELS`, `PERMS`, `CONVERSATION_PERMS`, `RESUME` y
 * `INSTALL`, y acertar en las seis.
 */
export const ACP_PRESETS: readonly AcpPreset[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    logo: "/harnesses/claude-code.svg",
    docs: "https://code.claude.com/docs/en/getting-started",
    command: "claude-agent-acp",
    args: [],
    requires: ["claude"],
    adapter: true,
    npm: "@agentclientprotocol/claude-agent-acp",
  },
  {
    id: "codex",
    name: "Codex",
    logo: "/harnesses/codex.svg",
    docs: "https://learn.chatgpt.com/docs/codex/cli",
    command: "codex-acp",
    args: [],
    requires: ["codex"],
    adapter: true,
    npm: "@agentclientprotocol/codex-acp",
  },
  {
    id: "opencode",
    name: "OpenCode",
    logo: "/harnesses/opencode.svg",
    docs: "https://opencode.ai/en/docs",
    // Su documentación no tiene página de instalación propia: las instrucciones
    // viven en un ancla de la portada.
    installDocs: "https://opencode.ai/en/docs/#install",
    command: "opencode",
    args: ["acp"],
    adapter: false,
    install: {
      default: "curl -fsSL https://opencode.ai/install | bash",
      nativeWindows: "npm install -g opencode-ai",
    },
  },
  /*
   * Antigravity, en el sitio que ocupaba Gemini CLI.
   *
   * **Gemini CLI se quitó el 2026-08-21 porque ya no autentica.** Contra una
   * cuenta de Gemini Code Assist para particulares, el servidor de Google
   * responde «This client is no longer supported […] migrate to the
   * Antigravity suite of products» y la sesión muere en `session/new`.
   * Comprobado con la 0.53.0. Un agente en el menú que no puede arrancar no es
   * una opción, es una trampa. (Para volver: `gemini --experimental-acp`, con
   * `adapter: false`; la bandera es obligatoria o arranca su TUI y no contesta
   * nunca a `initialize`.)
   *
   * ## Por qué `bunx` y no un binario
   *
   * Antigravity no habla ACP: su CLI (1.1.15) no tiene subcomando `acp` ni
   * bandera equivalente — lo más cercano es `--output-format stream-json`, que
   * es otro protocolo. Hacen falta terceros, y el 2026-08-21 había dos. Se
   * probaron los dos, de punta a punta:
   *
   * - **`agy-acp`** (Apache-2.0, ~3.3k descargas/mes). Corre con Node, que era
   *   la ventaja. **0.5.1 y 0.5.2 mueren con SIGSEGV** en el primer
   *   `session/prompt` — trae `better-sqlite3` y `node-pty`, dos módulos
   *   nativos. **1.0.0-alpha.0** ya no se cae, pero arma mal la lista de
   *   modelos: `agy models` imprime `id<TAB>etiqueta` y el adaptador no parte
   *   por el tabulador, así que manda `--model "gemini-3.7-flash-high\tGemini
   *   3.7 Flash"` y agy rechaza cada turno. (Es el mismo formato que
   *   `agyModels()` sí parte bien en `src/agents.ts`.)
   * - **`antigravity-acp`** (MIT). Completó el turno a la primera. Su pega es
   *   el runtime: su binario arranca con `#!/usr/bin/env bun`.
   *
   * De ahí `bunx`: hace explícito que **la dependencia de verdad es Bun**, y
   * deja que el mensaje de «no está instalado» diga eso y no algo que el
   * usuario no pueda arreglar. Lanzarlo como `antigravity-acp` a secas fallaría
   * con un `env: bun: No such file or directory` que no explica nada, y el
   * atajo de npx tampoco serviría — npx lo baja y sigue sin poder ejecutarlo.
   *
   * Por eso este preset no lleva `npm`: el camino de «ejecutar sin instalar»
   * no aplica cuando lo que falta es un intérprete.
   *
   * ⚠ Es el único adaptador de terceros de la tabla —`claude-agent-acp` y
   * `codex-acp` los publica la organización de ACP— y lo mantiene una sola
   * persona. Lo estable sería escribir el adaptador aquí sobre
   * `agy --input-format stream-json`: sin terceros en la cadena de confianza,
   * sin Bun, sin módulos nativos, y con el parseo de modelos que esta base de
   * código ya tiene bien. Ver `docs/acp-migration.md`.
   */
  {
    id: "antigravity",
    name: "Antigravity",
    logo: "/harnesses/antigravity.ico",
    docs: "https://antigravity.google/docs/cli/install/",
    command: "bunx",
    args: ["antigravity-acp"],
    requires: ["agy"],
    adapter: true,
    // Sin esto el adaptador intenta bajarse su propio `agy` en cada arranque
    // y falla con un 404; ver `envFrom`.
    envFrom: { AGY_BIN: "agy" },
    install: {
      default: "curl -fsSL https://bun.sh/install | bash",
      nativeWindows: 'powershell -c "irm bun.sh/install.ps1 | iex"',
    },
    // What is missing here is the interpreter, not the agent — see the note
    // above on why this preset runs through `bunx`.
    installDocs: "https://bun.sh/docs/installation",
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    logo: "/harnesses/hermes.ico",
    docs: "https://hermes-agent.nousresearch.com/docs/",
    installDocs: "https://hermes-agent.nousresearch.com/docs/getting-started/installation",
    command: "hermes",
    args: ["acp"],
    adapter: false,
    install: {
      default: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      nativeWindows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    },
  },
  {
    id: "kiro",
    name: "Kiro",
    logo: "/harnesses/kiro.ico",
    docs: "https://kiro.dev/docs/cli/acp/",
    // `docs` apunta al modo ACP, que es lo que a esta app le importa de Kiro;
    // a quien todavía no lo tiene instalado eso no le sirve de nada.
    installDocs: "https://kiro.dev/docs/getting-started/installation/",
    command: "kiro-cli",
    args: ["acp"],
    adapter: false,
    install: {
      default: "curl -fsSL https://cli.kiro.dev/install | bash",
      nativeWindows: "irm 'https://cli.kiro.dev/install.ps1' | iex",
    },
  },
  {
    id: "mistral-vibe",
    name: "Mistral Vibe",
    logo: "/harnesses/mistral-vibe.svg",
    docs: "https://docs.mistral.ai/getting-started/quickstarts/vibe-code/install-cli",
    command: "vibe-acp",
    args: [],
    adapter: false,
    install: {
      default: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
      nativeWindows: "uv tool install mistral-vibe",
    },
  },
];

export const presetById = (id: string): AcpPreset | undefined =>
  ACP_PRESETS.find((p) => p.id === id);

/**
 * Where to send someone whose install failed.
 *
 * Kept next to the table rather than inlined at the call site so that adding a
 * preset whose real dependency is something else is a one-field decision here,
 * and not a condition somewhere in a component.
 */
export const installDocsUrl = (preset: AcpPreset): string => preset.installDocs ?? preset.docs;

/**
 * Where to get Node.js.
 *
 * The `npx` shortcut is the only path in the app that needs a runtime the user
 * has to install from somewhere other than an agent's own site, so the address
 * lives here with the rest of the external facts instead of inside the view
 * that happens to render it today.
 */
export const NODE_DOWNLOAD = "https://nodejs.org/en/download";

/**
 * El comando de instalación para esta plataforma.
 *
 * Windows bajo WSL usa el de Unix a propósito: ahí el binario vive dentro de la
 * distribución de Linux, y ofrecer el `iex` de PowerShell instalaría algo que
 * el agente no va a poder lanzar.
 */
export function installCommand(preset: AcpPreset, nativeWindows: boolean): string {
  // Se deriva de `npm` cuando lo hay, en vez de repetir la cadena en la tabla:
  // el nombre del paquete se usa también para el camino de npx, y dos copias
  // del mismo dato acaban discrepando.
  if (preset.npm) return `npm install -g ${preset.npm}@latest`;
  return (nativeWindows && preset.install?.nativeWindows) || preset.install?.default || "";
}

/**
 * Cómo lanzarlo con npx, sin instalar nada — o `null` si no viene de npm.
 *
 * `-y` evita la pregunta de confirmación que npx hace la primera vez: aquí no
 * hay una terminal donde contestarla, así que sin ella el proceso se quedaría
 * esperando en silencio para siempre. La decisión ya la tomó el usuario al
 * pulsar el botón que lleva a esto.
 */
export function npxArgs(preset: AcpPreset): string[] | null {
  return preset.npm ? ["-y", preset.npm, ...preset.args] : null;
}
