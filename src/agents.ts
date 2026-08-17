import { spawn } from "node:child_process";

/**
 * Corre un comando resolviendo el PATH como lo vería el usuario, no el
 * mínimo que le llega a una app lanzada desde el Dock o el Explorador.
 *
 * En macOS y Linux eso importa: una app GUI no hereda `.zshrc`/`.bash_profile`,
 * así que sin una shell de login e interactiva (`-lic`) binarios instalados en
 * `~/.local/bin` —como éste— no aparecen aunque `which` los encuentre en una
 * Terminal normal. Es el mismo problema que resolvió `findClaude` en
 * `ingest-skill.ts`.
 *
 * En Windows no aplica igual: el PATH de usuario lo fija el registro y
 * cualquier proceso hijo lo hereda sin depender de un perfil que solo se lea
 * en sesiones interactivas, así que basta con PowerShell sin perfil.
 *
 * **`spawn`, no `execFile`.** `execFile` siempre deja el stdin del hijo como
 * una tubería abierta que nunca se cierra, y zsh en modo interactivo (`-i`,
 * necesario para el PATH) tiene un hook de restaurar sesión que se queda
 * esperando a que ese stdin mande EOF — nunca llega, y el proceso cuelga
 * hasta el timeout. `spawn` sí deja fijar `stdio`, así que el stdin del hijo
 * se cierra (`"ignore"`) desde el arranque y ese hook ve EOF de inmediato.
 */
function runInUserShell(command: string, timeoutMs: number): Promise<{ stdout: string; ok: boolean }> {
  const win = process.platform === "win32";
  const shell = win ? "powershell.exe" : (process.env.SHELL ?? "/bin/zsh");
  const args = win ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-lic", command];
  return new Promise((resolve) => {
    const child = spawn(shell, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, ok });
    };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(false); }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}

export interface AgentModel { id: string; label: string }

/**
 * El catálogo de modelos que `agy` tiene disponibles AHORA mismo, según su
 * propio backend — no una lista fija en el código que se desactualiza en
 * cuanto Google agrega o retira un modelo.
 *
 * `agy models` imprime `id<TAB>etiqueta` por línea a stdout, y un
 * "Fetching..." de progreso a stderr que se descarta solo. Tarda ~2s porque
 * agy lo resuelve contra su backend — por eso es una llamada bajo demanda, no
 * algo que corra en cada carga de la página. Si `agy` no está instalado, no
 * hay red, o tarda de más, se devuelve `null` y quien llama cae a una lista
 * fija.
 */
export async function agyModels(): Promise<AgentModel[] | null> {
  const { stdout, ok } = await runInUserShell("agy models", 12_000);
  if (!ok) return null;
  const models = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, ...rest] = line.split("\t");
      return { id: (id ?? "").trim(), label: rest.join("\t").trim() };
    })
    .filter((m) => m.id && m.label);
  return models.length ? models : null;
}

interface CodexCatalogue {
  models?: {
    slug?: unknown;
    display_name?: unknown;
    visibility?: unknown;
  }[];
}

/**
 * Reduce la respuesta de `codex debug models` a lo único que necesita la UI.
 *
 * El catálogo crudo también contiene instrucciones internas muy extensas; no
 * deben viajar al navegador. `visibility: list` replica lo que el propio CLI
 * considera elegible y evita mostrar aliases ocultos o retirados.
 */
export function parseCodexModels(stdout: string): AgentModel[] | null {
  try {
    const catalogue = JSON.parse(stdout) as CodexCatalogue;
    const seen = new Set<string>();
    const models = (catalogue.models ?? [])
      .filter((m) => m.visibility === "list")
      .map((m) => ({
        id: typeof m.slug === "string" ? m.slug.trim() : "",
        label: typeof m.display_name === "string" ? m.display_name.trim() : "",
      }))
      .filter((m) => m.id && m.label && !seen.has(m.id) && !!seen.add(m.id));
    return models.length ? models : null;
  } catch {
    return null;
  }
}

/** Catálogo que reconoce la instalación local de Codex en este momento. */
export async function codexModels(): Promise<AgentModel[] | null> {
  const { stdout, ok } = await runInUserShell("codex debug models", 12_000);
  return ok ? parseCodexModels(stdout) : null;
}

/**
 * El binario que hay que encontrar en el PATH para cada agente.
 *
 * La clave es el id que usa la interfaz (`components/agent-session.ts` arma el
 * comando con los mismos ids) y el valor es el ejecutable de verdad. Los dos
 * coinciden en tres de los cuatro casos y NO en Antigravity, que se instala
 * como `agy`: por eso esto es una tabla y no `id === binario`.
 */
export const AGENT_BINARIES = {
  claude: "claude",
  antigravity: "agy",
  opencode: "opencode",
  codex: "codex",
} as const;

export type AgentId = keyof typeof AGENT_BINARIES;

/** Ruta del ejecutable de cada agente, o `null` si no está en el PATH. */
export type AgentPaths = Record<AgentId, string | null>;

const NOT_FOUND: AgentPaths = { claude: null, antigravity: null, opencode: null, codex: null };

/**
 * Qué agentes están instalados en esta máquina, en **una sola** invocación de
 * shell para los cuatro.
 *
 * Uno por agente sería lo obvio y cuesta cuatro veces más de lo que parece: en
 * macOS y Linux cada sondeo levanta una zsh de login e interactiva (`-lic`,
 * necesario para ver el PATH real — ver `runInUserShell`), y eso significa leer
 * `.zshrc` entero cuatro veces. Con un `.zshrc` cargado de plugins son varios
 * segundos, y esto corre mientras el usuario mira el paso de configuración del
 * asistente. Un bucle dentro de la MISMA shell paga el arranque una vez.
 *
 * El bucle termina siempre en 0 aunque no encuentre nada; quién falta se lee de
 * la salida, no del código de salida. Un fallo de verdad —no hay shell, se agotó
 * el tiempo— devuelve los cuatro en `null`, que es lo honesto: no se pudo
 * comprobar, y la interfaz no debe afirmar que falten.
 */
export async function detectAgents(): Promise<AgentPaths> {
  const win = process.platform === "win32";
  const names = Object.values(AGENT_BINARIES);

  const command = win
    ? `foreach ($b in ${names.map((n) => `'${n}'`).join(",")}) { ` +
      `$c = Get-Command $b -ErrorAction SilentlyContinue; ` +
      `Write-Output ("{0}\`t{1}" -f $b, $(if ($c) { $c.Source } else { "" })) }`
    : `for b in ${names.join(" ")}; do printf '%s\\t%s\\n' "$b" "$(command -v "$b" 2>/dev/null)"; done`;

  const { stdout, ok } = await runInUserShell(command, 12_000);
  return ok ? parseAgentPaths(stdout, win) : { ...NOT_FOUND };
}

/**
 * Convierte la salida `binario<TAB>ruta` en el mapa por id de agente.
 *
 * Separado de `detectAgents` para poder probarlo: lo de arriba levanta una
 * shell de login y no se puede ejercitar en CI, pero todo lo que puede salir
 * mal de verdad está aquí.
 *
 * Lo que descarta, y por qué cada cosa:
 *
 *  - **Líneas sin tabulador.** Una shell interactiva imprime lo suyo antes de
 *    obedecer — zsh con la restauración de sesión activada suelta un
 *    «Restored session: …» que llega mezclado con los resultados. No tiene
 *    tabulador, así que su «ruta» sale vacía y cae por la regla siguiente.
 *  - **Rutas no absolutas.** Es como se ve un binario que no está: `command -v`
 *    no imprime nada y queda la cadena vacía. En Windows además filtra lo que
 *    `Get-Command` resuelve y no se puede lanzar en una terminal — alias y
 *    funciones de PowerShell, que devuelven un nombre en vez de una ruta.
 *  - **Binarios que no son de ningún agente.** El mapa se arma recorriendo
 *    `AGENT_BINARIES`, no la salida, así que nada que aparezca de más entra.
 */
export function parseAgentPaths(stdout: string, win = process.platform === "win32"): AgentPaths {
  const found = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const [name, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    const absolute = win ? /^[a-zA-Z]:[\\/]/.test(path) : path.startsWith("/");
    if (name?.trim() && absolute) found.set(name.trim(), path);
  }

  return Object.fromEntries(
    Object.entries(AGENT_BINARIES).map(([id, bin]) => [id, found.get(bin) ?? null]),
  ) as AgentPaths;
}
