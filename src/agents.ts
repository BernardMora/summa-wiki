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

export interface AgyModel { id: string; label: string }

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
export async function agyModels(): Promise<AgyModel[] | null> {
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
