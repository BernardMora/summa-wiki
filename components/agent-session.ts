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
      flag: "--yes",
      label: "agent.acceptEdits",
      hint: "agent.yesHint",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
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

export function agentCommand(agent: string, model: string, perm: string, skill = "/vault-ingest"): string {
  const binary = agent === "antigravity" ? "agy"
    : agent === "opencode" ? "opencode"
    : agent === "codex" ? "codex"
    : "claude";
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
 */
export const AGENTS: { id: AgentPickId; name: string; blurb: MessageKey }[] = [
  { id: "claude", name: "Claude Code", blurb: "setup.agentClaude" },
  { id: "antigravity", name: "Antigravity CLI", blurb: "setup.agentAntigravity" },
  { id: "opencode", name: "OpenCode", blurb: "setup.agentOpencode" },
  { id: "codex", name: "Codex", blurb: "setup.agentCodex" },
];

export type AgentPickId = "claude" | "antigravity" | "opencode" | "codex";
