import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Abrir la terminal DEL USUARIO con un comando dentro.
 *
 * ## Por qué esto en vez de una terminal incrustada
 *
 * Iniciar sesión con un agente es lo único que exigía emular una terminal
 * dentro de la app, y emularla costaba `node-pty`: un módulo nativo de 63 MB
 * con binarios por plataforma, `electron-rebuild`, un `postinstall` que
 * repara permisos del `spawn-helper`, y una complicación permanente para
 * firmar y notarizar el paquete de macOS. Todo eso para una pantalla que se ve
 * como mucho una vez por máquina.
 *
 * Aquí el proceso interactivo corre donde ya sabe correr —la terminal que el
 * usuario ya tiene— y la app se limita a lanzarlo y a volver a preguntar
 * después. No es una degradación inventada para ahorrarse una dependencia: es
 * lo que el propio ecosistema hace. El método de autenticación que anuncia
 * OpenCode se describe, literalmente, como *«Run `opencode auth login` in the
 * terminal»*.
 *
 * ## Lo que esto NO promete
 *
 * Abrir la terminal es una comodidad, no el mecanismo. El mecanismo es el
 * comando, que siempre se le enseña a la persona para que lo copie. Si aquí
 * falla algo —un escritorio Linux sin ninguna terminal conocida, una política
 * que impide lanzar procesos— el camino sigue abierto y la interfaz solo
 * pierde un botón. Por eso esto devuelve un booleano y no lanza.
 */

/** Un comando listo para que lo corra una persona, con su entorno. */
export interface AuthCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/**
 * El comando, en una línea, tal como se teclea.
 *
 * Se entrecomilla lo que lo necesite y nada más: una ruta con espacios
 * —`/Applications/My Agent/bin/x`— pega roto sin comillas, y entrecomillarlo
 * todo produce una línea que nadie quiere leer. Las variables van delante
 * porque es la forma que funciona igual en bash, zsh y fish.
 */
export function shellLine(auth: AuthCommand): string {
  const quote = (value: string) => (/^[A-Za-z0-9_\-./:=@]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);
  const assignments = Object.entries(auth.env).map(([key, value]) => `${key}=${quote(value)}`);
  return [...assignments, quote(auth.command), ...auth.args.map(quote)].join(" ");
}

/** Igual, para `cmd.exe`, que no entiende ni las comillas simples ni `VAR=x`. */
function windowsLine(auth: AuthCommand): string {
  const quote = (value: string) => (/[\s&|<>^"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const sets = Object.entries(auth.env).map(([key, value]) => `set ${key}=${value} && `).join("");
  return sets + [quote(auth.command), ...auth.args.map(quote)].join(" ");
}

/**
 * Lanza el comando en la terminal del sistema. `false` si no se pudo.
 *
 * En macOS se escribe un `.command` temporal en vez de pasar el comando por
 * argumento: `open -a Terminal` recibe UN archivo, no una línea de shell, y un
 * archivo además resuelve de una vez el entorno, el directorio de trabajo y el
 * entrecomillado. Se marca ejecutable porque Terminal.app no abre lo que no lo
 * es, y se deja una pausa al final para que la ventana no se cierre encima del
 * mensaje de error si algo falla.
 */
export async function openInSystemTerminal(auth: AuthCommand): Promise<boolean> {
  try {
    if (process.platform === "darwin") return macos(auth);
    if (process.platform === "win32") return windows(auth);
    return linux(auth);
  } catch {
    return false;
  }
}

function detach(command: string, args: string[]): boolean {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

function macos(auth: AuthCommand): boolean {
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "summa-auth-")), "sign-in.command");
  const body = [
    "#!/bin/sh",
    `cd ${shellQuote(auth.cwd)} || exit 1`,
    ...Object.entries(auth.env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    shellLine({ ...auth, env: {} }),
    'printf "\\n[Summa Wiki] Sign-in finished. You can close this window.\\n"',
  ].join("\n");
  fs.writeFileSync(script, body + "\n", { mode: 0o700 });
  return detach("open", ["-a", "Terminal", script]);
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

function windows(auth: AuthCommand): boolean {
  // `start ""` — el primer argumento de `start` es el TÍTULO de la ventana, así
  // que sin la cadena vacía se traga el comando y abre una consola pelada.
  return detach("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", windowsLine(auth)]);
}

/**
 * Linux no tiene una terminal; tiene doce. Se prueban por orden de probabilidad
 * y se para en la primera que exista — `x-terminal-emulator` primero porque en
 * Debian y derivados es el alias que apunta a la que el usuario eligió.
 */
function linux(auth: AuthCommand): boolean {
  const line = shellLine(auth);
  const inner = `cd ${shellQuote(auth.cwd)}; ${line}; printf '\\n[Summa Wiki] Sign-in finished.\\n'; exec $SHELL`;
  const candidates: [string, string[]][] = [
    ["x-terminal-emulator", ["-e", "sh", "-c", inner]],
    ["gnome-terminal", ["--", "sh", "-c", inner]],
    ["konsole", ["-e", "sh", "-c", inner]],
    ["xfce4-terminal", ["-e", `sh -c ${shellQuote(inner)}`]],
    ["alacritty", ["-e", "sh", "-c", inner]],
    ["kitty", ["sh", "-c", inner]],
    ["xterm", ["-e", "sh", "-c", inner]],
  ];
  for (const [command, args] of candidates) {
    if (!onPath(command)) continue;
    try { return detach(command, args); } catch { /* la siguiente */ }
  }
  return false;
}

/** `PATH` a mano: `which` sería otro proceso por candidato, y hay siete. */
function onPath(command: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch { /* no está aquí */ }
  }
  return false;
}
