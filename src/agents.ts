import { spawn } from "node:child_process";
import { ACP_PRESETS } from "./acp/presets.ts";

/**
 * Entorno limpio para todo lo que esta app lanza: shells de sondeo, agentes y
 * los comandos que ellos piden ejecutar.
 *
 * Se hereda casi todo —hace falta `HOME`, `PATH` y las credenciales del
 * usuario— y se quitan dos familias:
 *
 * - **`npm_*`, y `npm_config_prefix` sobre todo.** No es higiene: es un fallo
 *   que costó una tarde. npm exporta su configuración al entorno de los
 *   scripts que corre, así que un servidor arrancado con `npm run dev` o
 *   `npm run desktop` lleva dentro `npm_config_prefix`. Y **nvm se niega a
 *   cargar** cuando esa variable existe: imprime «nvm is not compatible with
 *   the "npm_config_prefix" environment variable» y aborta. La shell de sondeo
 *   heredaba la variable, nvm no arrancaba, y `~/.nvm/versions/node/<v>/bin`
 *   no llegaba nunca al PATH — así que TODO binario instalado con
 *   `npm install -g` bajo nvm resultaba invisible. En la interfaz se veía como
 *   «claude-agent-acp no está instalado» con el paquete instalado y
 *   funcionando desde cualquier terminal. Solo mordía a los binarios de nvm:
 *   `hermes`, `opencode` y `bunx` viven en otro sitio y nunca fallaron, lo que
 *   hacía el patrón más difícil de leer.
 *
 * - **`CLAUDE_CODE_*`.** Si el servidor se arrancó desde dentro de una sesión
 *   de Claude Code, `CLAUDE_CODE_CHILD_SESSION` hace que el agente lanzado se
 *   crea sesión hija y desactive el guardado de transcripciones: un fallo que
 *   no parece un fallo.
 *
 * Se copia y se BORRA en vez de construir un objeto vacío: Next amplía
 * `ProcessEnv` para exigir `NODE_ENV`, así que un `{}` recién hecho no tipa por
 * mucho que se rellene. Y es más honesto — lo que se hereda es todo, y lo
 * excepcional queda en una sola lista visible.
 */
export function cleanEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of Object.keys(env)) {
    if (k.startsWith("CLAUDE_CODE_") || k.toLowerCase().startsWith("npm_")) delete env[k];
  }
  return env;
}

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
export function runInUserShell(command: string, timeoutMs: number): Promise<{ stdout: string; ok: boolean }> {
  const win = process.platform === "win32";
  const shell = win ? "powershell.exe" : (process.env.SHELL ?? "/bin/zsh");
  const args = win ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-lic", command];
  return new Promise((resolve) => {
    // `cleanEnv` y no `process.env`: ver arriba. Sin esto, el sondeo no ve los
    // binarios de nvm cuando al servidor lo lanzó npm.
    const child = spawn(shell, args, { stdio: ["ignore", "pipe", "pipe"], env: cleanEnv() });
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

/** ACP command paths keyed by the preset's stable id. */
export type AcpAgentPaths = Record<string, string | null>;

/**
 * ACP adapters and commands the app can launch.
 *
 * Ids and executables come directly from `ACP_PRESETS`, so adding an agent
 * does not require updating a second detection table.
 */
export async function detectAcpAgents(): Promise<AcpAgentPaths> {
  const win = process.platform === "win32";
  const names = [...new Set(ACP_PRESETS.flatMap((preset) => [
    preset.command,
    ...(preset.requires ?? []),
    ...Object.values(preset.envFrom ?? {}),
  ]))];
  const command = win
    ? `foreach ($b in ${names.map((n) => `'${n}'`).join(",")}) { ` +
      `$c = Get-Command $b -ErrorAction SilentlyContinue; ` +
      `Write-Output ("{0}\`t{1}" -f $b, $(if ($c) { $c.Source } else { "" })) }`
    : `for b in ${names.join(" ")}; do printf '%s\\t%s\\n' "$b" "$(command -v "$b" 2>/dev/null)"; done`;

  const { stdout, ok } = await runInUserShell(command, 12_000);
  return ok ? parsePresetPaths(stdout, win) : emptyCommandPaths(
    Object.fromEntries(ACP_PRESETS.map((preset) => [preset.id, preset.command])),
  );
}

/** A preset is installed only when its command and wrapped harnesses exist. */
export function parsePresetPaths(stdout: string, win = process.platform === "win32"): AcpAgentPaths {
  const commands = Object.fromEntries(
    ACP_PRESETS.flatMap((preset) => [preset.command, ...(preset.requires ?? []), ...Object.values(preset.envFrom ?? {})])
      .map((command) => [command, command]),
  );
  const paths = parseCommandPaths(stdout, commands, win);
  return Object.fromEntries(ACP_PRESETS.map((preset) => {
    const dependencies = [...(preset.requires ?? []), ...Object.values(preset.envFrom ?? {})];
    const ready = paths[preset.command] && dependencies.every((command) => paths[command]);
    return [preset.id, ready ? paths[preset.command] : null];
  }));
}

function emptyCommandPaths(commands: Record<string, string>): AcpAgentPaths {
  return Object.fromEntries(Object.keys(commands).map((id) => [id, null]));
}

/** Generic parser used by the ACP registry and pinned by tests. */
export function parseCommandPaths(
  stdout: string,
  commands: Record<string, string>,
  win = process.platform === "win32",
): AcpAgentPaths {
  const found = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const [name, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    const absolute = win ? /^[a-zA-Z]:[\\/]/.test(path) : path.startsWith("/");
    if (name?.trim() && absolute) found.set(name.trim(), path);
  }
  return Object.fromEntries(
    Object.entries(commands).map(([id, binary]) => [id, found.get(binary) ?? null]),
  );
}
