import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/lib/i18n.ts";

/**
 * Los parámetros con los que arranca una sesión del agente.
 *
 * **No se guardan en ningún sitio.** Son argumentos de arranque de UNA sesión
 * de Claude Code, no preferencias de esta app: la configuración permanente del
 * modelo vive en Claude Code, que es de donde sale el default, y duplicarla
 * aquí crearía una segunda fuente de verdad que se desincroniza en cuanto el
 * usuario cambie la primera. Vale doble para los permisos: saltárselos no
 * debería quedar pegajoso entre corridas.
 *
 * El archivo se llama `agent-session.ts` en kebab y no `agentSession.ts`: el
 * componente hermano es `AgentSession.tsx`, y en macOS —sistema de archivos
 * insensible a mayúsculas— los dos nombres son el MISMO archivo. TypeScript lo
 * detecta y se niega a compilar. Misma familia de trampa que el NFD de los
 * acentos que rompió seis enlaces en la Fase 7.
 *
 * Compartido entre el asistente de creación y la ingesta suelta, que ofrecen
 * exactamente la misma decisión y no deberían poder describirla distinto.
 */

/**
 * Alias y no ids completos (`opus`, no `claude-opus-5`): el CLI los resuelve a
 * la última versión de esa familia, así que la elección no se queda vieja
 * cuando salga el siguiente modelo.
 */
/**
 * `hint` es una CLAVE del diccionario, no texto.
 *
 * Este módulo no es un componente y no puede llamar a `useT()`; traduce quien
 * lo pinta. Guardar la clave y no la cadena es además lo correcto: estas tablas
 * viven en memoria mientras la app está abierta, y con el texto ya resuelto se
 * quedarían en el idioma que hubiera al cargar el módulo.
 *
 * `label` NO es una clave, y la asimetría es deliberada: «Opus», «Haiku» y
 * «gemini-3.7-flash» son nombres propios y no se traducen. El único rótulo que
 * sí es prosa —«el de tu CLI»— lleva `labelKey` aparte, y por eso los modelos
 * que llegan del catálogo en vivo de `agy` pueden entrar en la misma lista sin
 * inventarles una clave que nunca existiría en el diccionario.
 */
/** Una opción de modelo, venga de la tabla de abajo o del catálogo en vivo. */
export interface ModelChoice {
  id: string;
  /** Nombre propio del modelo. Vacío cuando el rótulo es prosa: ver `labelKey`. */
  label: string;
  /** Solo el «el de tu CLI», que sí es prosa y sí se traduce. */
  labelKey?: MessageKey;
  hint: MessageKey;
}

export const MODELS: Record<string, ModelChoice[]> = {
  claude: [
    { id: "", label: "", labelKey: "agent.cliDefault", hint: "agent.cliDefaultClaude" },
    { id: "opus", label: "Opus", hint: "agent.opusHint" },
    { id: "sonnet", label: "Sonnet", hint: "agent.sonnetHint" },
    { id: "haiku", label: "Haiku", hint: "agent.haikuHint" },
  ],
  /*
   * Solo el default: aquí NO se inventan modelos.
   *
   * Había un «Pro» y un «Flash» escritos a mano, y ninguno de los dos existe
   * como id para `agy` —su catálogo real son `gemini-3.7-flash-high`,
   * `gemini-3.6-flash-medium` y demás—, así que elegirlos armaba un
   * `--model pro` que el CLI rechaza. Los nombres de esa lista salieron de
   * suponer cómo se llamarían, no de preguntárselo al CLI.
   *
   * La lista de verdad la trae `useAgentModels` de `agy models`. Cuando no se
   * puede (sin sesión iniciada, sin `agy` instalado) queda solo esta opción,
   * que es la honesta: el CLI usa el modelo que ya tenga configurado.
   */
  antigravity: [
    { id: "", label: "", labelKey: "agent.cliDefault", hint: "agent.cliDefaultAntigravity" },
  ],
  codex: [
    { id: "", label: "", labelKey: "agent.cliDefault", hint: "agent.cliDefaultCodex" },
  ],
  opencode: [
    { id: "", label: "", labelKey: "agent.cliDefault", hint: "agent.cliDefaultOpencode" },
    { id: "pro", label: "Pro", hint: "agent.proHint" },
    { id: "flash", label: "Flash", hint: "agent.flashHint" },
  ],
};

/**
 * El default acepta ediciones sin preguntar porque repartir son cientos de
 * movimientos y confirmarlos uno por uno haría inviable la función, pero sigue
 * pidiendo permiso para todo lo demás. El bypass existe porque es la máquina
 * del usuario; lo que no puede es estar sin etiquetar.
 */
export const PERMS: Record<string, { id: string; flag: string; label: MessageKey; hint: MessageKey }[]> = {
  claude: [
    {
      id: "acceptEdits",
      flag: "--permission-mode acceptEdits",
      label: "agent.acceptEdits",
      hint: "agent.acceptEditsHint",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
      label: "agent.askNothing",
      hint: "agent.askNothingHint",
    },
  ],
  antigravity: [
    {
      id: "acceptEdits",
      flag: "--mode=accept-edits",
      label: "agent.acceptEdits",
      hint: "agent.acceptEditsAg",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
      label: "agent.askNothing",
      hint: "agent.askNothingHint",
    },
  ],
  codex: [
    {
      id: "acceptEdits",
      flag: "--sandbox workspace-write --ask-for-approval on-request",
      label: "agent.acceptEdits",
      hint: "agent.acceptEditsCodex",
    },
    {
      id: "bypass",
      // Este flujo arranca la TUI `codex`, no `codex exec` ni otro harness.
      // En la CLI interactiva esta es la bandera documentada que quita AMBAS
      // barreras. `--ask-for-approval never` solo quita preguntas y conserva
      // el sandbox, así que no cumpliría el significado ni el aviso de esta UI.
      flag: "--dangerously-bypass-approvals-and-sandbox",
      label: "agent.askNothing",
      hint: "agent.askNothingHint",
    },
  ],
  opencode: [
    {
      id: "acceptEdits",
      // OJO: `--yes` NO existe en opencode 1.18.18. Su parser (yargs sin
      // `.strict()`) acepta cualquier bandera desconocida y la ignora, así que
      // esto no falla — simplemente no hace nada, y la tarjeta promete algo que
      // no ocurre. La única bandera real de auto-aprobación es `--auto`, que es
      // la de abajo; opencode no tiene el punto intermedio que este id nombra.
      // Sin arreglar a propósito: elegir entre dejar la tarjeta sin efecto o
      // darle el mismo `--auto` que a «no preguntar» —y quedarse con dos
      // etiquetas distintas para el mismo comportamiento— es una decisión de
      // producto, no un typo que se corrija de paso.
      flag: "--yes",
      label: "agent.acceptEdits",
      hint: "agent.yesHint",
    },
    {
      id: "bypass",
      // `--dangerously-skip-permissions` es de Claude Code y de `agy`, no de
      // opencode: aquí se ignoraba en silencio y «no preguntar» seguía
      // preguntando. Verificado contra `opencode --help` (1.18.18): la bandera
      // es `--auto`, «auto-approve permissions that are not explicitly denied».
      flag: "--auto",
      label: "agent.askNothing",
      hint: "agent.askNothingHint",
    },
  ],
};

/**
 * `agy` no acepta el prompt como argumento posicional: sin `-p` arranca la TUI
 * interactiva y se queda esperando, ignorando el texto — por eso no mandaba
 * nada. `-p` (alias `--print`/`--prompt`) es su modo headless: corre una vez,
 * imprime a stdout y termina solo. https://antigravity.google/docs/cli/headless
 *
 * `claude` sí toma el prompt posicional como primer mensaje de una sesión
 * interactiva, que es lo que la terminal incrustada espera (se puede seguir
 * escribiendo después). `agy` en cambio no se queda a escuchar más una vez que
 * termina — es un solo tiro, no una conversación.
 */
const shellArg = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * El ejecutable de cada agente.
 *
 * Sale de `INSTALL`, que ya lo tenía para poder nombrar lo que falta («falta
 * `agy`») con el nombre correcto. Una segunda tabla escrita aquí se
 * desincronizaría el día que un CLI se renombre, y el síntoma sería el peor
 * posible: el sondeo de instalación mirando un binario y el comando lanzando
 * otro, o sea un botón habilitado que no puede funcionar.
 */
const agentBinary = (agent: string) => INSTALL[agent]?.binary ?? "claude";

export function agentCommand(agent: string, model: string, perm: string, skill = "/vault-ingest"): string {
  const binary = agentBinary(agent);
  const perms = PERMS[agent] || PERMS.claude;
  const prompt = agent === "codex" && skill.startsWith("/") ? `$${skill.slice(1)}` : skill;
  return [
    binary,
    model && `--model ${shellArg(model)}`,
    perms.find((p) => p.id === perm)?.flag,
    agent === "antigravity" ? `-p ${shellArg(prompt)}` : shellArg(prompt),
  ].filter(Boolean).join(" ");
}

/**
 * Los dos niveles de permiso del menú de «iniciar conversación».
 *
 * Tabla aparte de `PERMS` y no dos renglones más dentro de ella, porque
 * describen situaciones distintas. `PERMS` son los permisos de una TAREA que la
 * app manda a hacer —repartir cientos de archivos— y por eso su piso es
 * `acceptEdits`: preguntar por cada movimiento haría inviable la función. Aquí
 * no hay tarea. El usuario abre una conversación y decide él qué pedir, así que
 * el piso correcto es el contrario, el del CLI sin tocar, que pregunta.
 *
 * **Cada bandera está verificada contra el `--help` del binario instalado**
 * (2026-08-16: claude, agy, codex 0.147.0, opencode 1.18.18). Ninguna se dedujo
 * por analogía con otro CLI, y esa disciplina no es celo: `opencode` ignora en
 * SILENCIO las banderas que no conoce —no falla, no avisa— así que una copiada
 * de Claude Code produce un botón que promete no preguntar y pregunta igual.
 * Es justo el bug que había en `PERMS.opencode`.
 *
 * Por qué «preguntando» va vacío en dos de los cuatro: ni `opencode` ni `agy`
 * tienen bandera para exigir que pregunte, porque preguntar ya es lo que hacen
 * sin argumentos. Escribir algo ahí sería inventarlo. En `claude` y `codex` sí
 * la hay y sí se pone, y la diferencia importa: el rótulo promete que va a
 * preguntar, y sin bandera lo que manda es lo que el usuario tenga configurado
 * en su CLI — que puede ser justo lo contrario.
 */
export const CONVERSATION_PERMS: Record<string, { id: string; flag: string; label: MessageKey; hint: MessageKey }[]> = {
  claude: [
    // `manual` de entre los seis valores de `--permission-mode` (acceptEdits,
    // auto, bypassPermissions, manual, dontAsk, plan): el único que garantiza
    // lo que dice la etiqueta pase lo que pase en la config del usuario.
    { id: "ask", flag: "--permission-mode manual", label: "agent.askAlways", hint: "agent.askAlwaysHint" },
    { id: "bypass", flag: "--dangerously-skip-permissions", label: "agent.askNothing", hint: "agent.askNothingHint" },
  ],
  antigravity: [
    // `--mode` solo acepta `accept-edits` y `plan`; no hay un modo «pregunta
    // por todo» que pedir, porque es el de por defecto.
    { id: "ask", flag: "", label: "agent.askAlways", hint: "agent.askAlwaysDefault" },
    { id: "bypass", flag: "--dangerously-skip-permissions", label: "agent.askNothing", hint: "agent.askNothingHint" },
  ],
  codex: [
    // `untrusted` es, textualmente, «only run trusted commands (ls, cat, sed)
    // without asking». De los tres valores de `-a` es el que corresponde a
    // preguntar; `on-request` deja que decida el modelo y `never` no pregunta.
    { id: "ask", flag: "--ask-for-approval untrusted", label: "agent.askAlways", hint: "agent.askAlwaysHint" },
    { id: "bypass", flag: "--dangerously-bypass-approvals-and-sandbox", label: "agent.askNothing", hint: "agent.askNothingHint" },
  ],
  opencode: [
    { id: "ask", flag: "", label: "agent.askAlways", hint: "agent.askAlwaysDefault" },
    { id: "bypass", flag: "--auto", label: "agent.askNothing", hint: "agent.askNothingHint" },
  ],
};

/**
 * El comando que abre una conversación: el binario, el nivel de permiso, y
 * nada más.
 *
 * **Sin prompt, y ahí está toda la diferencia con `agentCommand`.** Aquel manda
 * una tarea concreta (`/vault-ingest`) y por eso tiene que lidiar con que cada
 * CLI reciba el texto a su manera — el `-p` de `agy`, el `$skill` de Codex.
 * Aquí no hay texto que entregar: se abre la TUI y el usuario escribe. Eso
 * también es lo que hace que `agy` encaje sin caso especial, porque el `-p` que
 * necesitaba era precisamente para el prompt que aquí no existe.
 */
export function conversationCommand(agent: string, perm: string): string {
  const perms = CONVERSATION_PERMS[agent] || CONVERSATION_PERMS.claude;
  return [agentBinary(agent), perms.find((p) => p.id === perm)?.flag]
    .filter(Boolean)
    .join(" ");
}

/**
 * Inicia el agente elegido con una primera pregunta visible en su terminal.
 * Se usa en recorridos guiados donde abrir una TUI vacía escondería la parte
 * importante: cómo el agente lee y conecta el contexto del vault.
 */
export function promptCommand(agent: string, model: string, prompt: string): string {
  const perms = CONVERSATION_PERMS[agent] || CONVERSATION_PERMS.claude;
  const askFlag = perms.find((p) => p.id === "ask")?.flag;
  return [
    agentBinary(agent),
    model && `--model ${shellArg(model)}`,
    askFlag,
    agent === "antigravity" ? `-p ${shellArg(prompt)}` : shellArg(prompt),
  ].filter(Boolean).join(" ");
}

/**
 * Reanudar una conversación que ya existe.
 *
 * **Sin nivel de permiso, y es una decisión, no un olvido.** Reanudar admite
 * cualquiera —el CLI acepta las mismas banderas que al arrancar—, pero
 * cualquier bandera que pusiéramos aquí PISARÍA la del hilo que se retoma. No
 * ponerla es lo que deja que la conversación siga con los permisos que ya
 * traía, que es justo lo que uno espera al reanudar; imponer un nivel sería
 * cambiarle las reglas a una conversación a medio camino, y encima sin decirlo.
 *
 * (Que hay estado que conservar está comprobado: los transcripts de Claude
 * guardan un `permissionMode` por mensaje. Lo que NO se comprobó es que
 * `--resume` lo reaplique — y esa duda es un argumento más para no meter
 * bandera: sea lo que sea que haga el CLI con ese dato, es asunto suyo, y lo
 * único seguro es que una bandera nuestra lo anularía.)
 *
 * Los cuatro CLIs no ofrecen lo mismo y el rótulo lo dice en vez de disimularlo:
 * `claude --resume` y `codex resume` abren su propio selector de conversaciones;
 * `agy` y `opencode` solo saben seguir la última (`--continue`) — sus subcomandos
 * de sesión listan y borran, no eligen. Un botón que dijera «Reanudar» en los
 * cuatro sería mentira en dos: quien lo pulsa en OpenCode esperaría escoger y se
 * encontraría ya dentro de la última conversación.
 *
 * `arg` y no `flag` porque en Codex es un SUBCOMANDO (`codex resume`), no una
 * bandera. Verificado con `codex resume --help`, que además documenta el
 * `--last` para saltarse el selector.
 */
export const RESUME: Record<string, { arg: string; label: MessageKey; hint: MessageKey }> = {
  claude: { arg: "--resume", label: "agent.resumePick", hint: "agent.resumePickHint" },
  antigravity: { arg: "--continue", label: "agent.resumeLast", hint: "agent.resumeLastHint" },
  codex: { arg: "resume", label: "agent.resumePick", hint: "agent.resumePickHint" },
  opencode: { arg: "--continue", label: "agent.resumeLast", hint: "agent.resumeLastHint" },
};

export function resumeCommand(agent: string): string {
  const entry = RESUME[agent] ?? RESUME.claude;
  return `${agentBinary(agent)} ${entry.arg}`;
}

/**
 * Los modelos a mostrar para `agent`: el catálogo en vivo de `agy` o Codex si
 * se pudo pedir, o si no la lista fija de arriba.
 *
 * Se pide una sola vez por agente y montaje. Si falla, no hay red, o el CLI no
 * está instalado, queda el default del CLI, que sigue siendo una opción válida.
 */
export function useAgentModels(agent: string) {
  const [live, setLive] = useState<Record<string, { id: string; label: string }[] | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  /*
   * Qué agentes YA se preguntaron, hayan respondido lo que hayan respondido.
   *
   * Un ref y no estado: es justo lo que no debe provocar un render, porque el
   * render es lo que volvía a disparar el efecto. La versión anterior se
   * guardaba con `if (live || loading) return` y las dos son insuficientes,
   * porque un intento FALLIDO deja `live` en null y `loading` en false — el
   * mismo estado exacto que antes de intentarlo. El efecto no podía distinguir
   * «todavía no he preguntado» de «pregunté y no había nada», así que volvía a
   * preguntar, y como `loading` estaba en las dependencias, cada vuelta lo
   * cambiaba dos veces y agendaba la siguiente: un bucle cerrado, una petición
   * cada ~250 ms mientras la pantalla estuviera abierta.
   *
   * Se dispara con `agy` instalado pero sin sesión iniciada: el comando
   * imprime «Please sign in…», sale con código 0, y el parser no encuentra
   * ninguna línea `id<TAB>label` — un fallo que no parece fallo.
   */
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!["antigravity", "codex"].includes(agent) || asked.current.has(agent)) return;
    asked.current.add(agent);
    setLoading((old) => ({ ...old, [agent]: true }));
    fetch(`/api/agents/models?agent=${encodeURIComponent(agent)}`)
      .then((r) => r.json())
      .then((d) => setLive((old) => ({
        ...old,
        [agent]: Array.isArray(d.models) && d.models.length ? d.models : null,
      })))
      .catch(() => setLive((old) => ({ ...old, [agent]: null })))
      .finally(() => setLoading((old) => ({ ...old, [agent]: false })));
  }, [agent]);

  const fallback = MODELS[agent] || MODELS.claude;
  const current = live[agent];
  const models: ModelChoice[] = current
    ? [fallback[0], ...current.map((m) => ({
        ...m,
        hint: (agent === "codex" ? "agent.liveCatalogueCodex" : "agent.liveCatalogue") as MessageKey,
      }))]
    : fallback;

  return { models, loading: !!loading[agent] && !current };
}

/**
 * Dónde conseguir cada agente cuando no está instalado.
 *
 * `command` es opcional **a propósito**: solo lo llevan los agentes que se
 * publican como paquete de npm y cuyo nombre se puede afirmar sin adivinar.
 * Antigravity se instala desde su propia web, y escribir aquí un `npm i -g`
 * inventado sería peor que no ofrecer comando — el usuario lo pega, falla, y
 * ahora tiene dos problemas.
 */
export const INSTALL: Record<string, { binary: string; url: string; command?: string }> = {
  claude: {
    binary: "claude",
    url: "https://claude.com/claude-code",
    command: "npm install -g @anthropic-ai/claude-code",
  },
  antigravity: {
    binary: "agy",
    url: "https://antigravity.google/docs/cli",
  },
  opencode: {
    binary: "opencode",
    url: "https://opencode.ai",
    command: "npm install -g opencode-ai",
  },
  codex: {
    binary: "codex",
    url: "https://developers.openai.com/codex/cli",
    command: "npm install -g @openai/codex",
  },
};

/**
 * Qué agentes están instalados, sondeado una vez por montaje.
 *
 * `null` mientras no se sabe, y ese tercer estado es el que hace que la interfaz
 * no mienta: entre que se abre la pantalla y contesta el servidor pasa un
 * segundo largo —hay que levantar una shell de login— y durante ese rato pintar
 * «no instalado» acusaría en falso a todo el mundo. Sin datos no se dice nada.
 *
 * Si el sondeo falla entero se queda en `null` para siempre, con el mismo
 * efecto: la pantalla se comporta como antes de que esto existiera, que es el
 * peor caso aceptable.
 */
export function useInstalledAgents(enabled = true) {
  const [agents, setAgents] = useState<Record<string, string | null> | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    /*
     * `enabled` en false cuando quien nos usa YA tiene el dato de su padre.
     * Los hooks no se pueden llamar condicionalmente, así que la condición va
     * dentro: sin esto, un `<AgentSession>` al que el asistente ya le pasó
     * `installed` levantaría una segunda shell de login para preguntar
     * exactamente lo mismo, y son ~2 s cada una.
     */
    if (!enabled || asked.current) return;
    asked.current = true;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? null))
      .catch(() => setAgents(null));
  }, [enabled]);

  /**
   * `true` instalado, `false` no, `null` todavía no se sabe. Tres estados y no
   * dos porque quien lo pinta tiene que poder distinguir «falta» de «aún no he
   * mirado», y un booleano colapsa justo esos dos.
   */
  const installed = (agent: string): boolean | null =>
    agents === null ? null : !!agents[agent];

  return { agents, installed };
}

/**
 * Los agentes que ofrece el asistente, en orden de aparición.
 *
 * Una tabla y no cuatro botones escritos a mano: la versión anterior repetía el
 * mismo `<button>` cuatro veces y añadir la insignia de «instalado» habría sido
 * el mismo cambio copiado cuatro veces, que es exactamente como una de las
 * cuatro se queda sin él.
 *
 * `name` no es una clave del diccionario porque son nombres propios; `blurb` sí
 * lo es porque es prosa. Misma asimetría que en `ModelChoice`.
 *
 * `icon` apunta a `public/providers/`, NO a los servidores de cada proveedor.
 * Las URLs remotas funcionaban en desarrollo y fallaban justo donde importa:
 * esta es una app de escritorio para un vault local, así que el menú se abría
 * sin iconos en un avión o detrás de un firewall, y cada apertura mandaba
 * cuatro peticiones a terceros —con IP y hora— desde una app que por lo demás
 * no habla con nadie. Un vault privado no debería avisar a Google cada vez que
 * alguien mira la lista de agentes.
 *
 * PNG de 48 px y no el SVG original: son 7 KB los cuatro, se pintan a 14 px con
 * sitio de sobra hasta 3x, y evitan que un SVG de un tercero —que puede traer
 * su propio CSS o rutas raras— entre al bundle. Rasterizados desde la fuente
 * oficial de cada proyecto; para actualizarlos, volver a bajarla y reescalar.
 */
export const AGENTS: { id: AgentPickId; name: string; blurb: MessageKey; icon: string }[] = [
  { id: "claude", name: "Claude Code", blurb: "setup.agentClaude", icon: "/providers/claude.png" },
  { id: "antigravity", name: "Antigravity CLI", blurb: "setup.agentAntigravity", icon: "/providers/antigravity.png" },
  { id: "opencode", name: "OpenCode", blurb: "setup.agentOpencode", icon: "/providers/opencode.png" },
  { id: "codex", name: "Codex", blurb: "setup.agentCodex", icon: "/providers/codex.png" },
];

export type AgentPickId = "claude" | "antigravity" | "opencode" | "codex";
