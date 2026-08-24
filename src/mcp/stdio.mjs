/**
 * Puente de stdio a HTTP para el servidor MCP de la app.
 *
 *   <node> src/mcp/stdio.mjs <url>
 *
 * ## Para quién es
 *
 * Para el agente que NO anuncia `mcpCapabilities.http`. Comprobado contra los
 * cuatro adaptadores instalables hoy: Claude Code, Codex y OpenCode anuncian
 * `http: true`; Hermes 0.20.5 no anuncia ninguna capacidad de MCP, y por
 * contrato eso significa que solo habla el transporte de stdio, que es el que
 * todo agente debe soportar. Sin este archivo, el agente por omisión de la app
 * sería el único que no ve las herramientas del wiki.
 *
 * ## Por qué reenvía en vez de servir
 *
 * Porque el servidor de verdad tiene que estar DENTRO de la app: las
 * herramientas de interfaz —abrir una nota, enfocar el grafo— necesitan
 * hablarle a la ventana abierta, y un proceso hijo lanzado por el agente no
 * tiene forma de hacerlo. Así que aquí no hay ninguna lógica que pueda
 * discrepar de la del servidor: se copian bytes.
 *
 * Se escribe en `.mjs` y sin importar nada del proyecto a propósito. Lo lanza
 * el agente, no la app, y puede tocarle cualquier Node —o el binario de
 * Electron en modo Node dentro del paquete—; un `.ts` dependería de que quien
 * lo lance pase `--experimental-strip-types`, y eso no lo controlamos.
 */

const url = process.argv[2];
if (!url) {
  process.stderr.write("summa-wiki mcp: falta la URL\n");
  process.exit(2);
}

const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");

/**
 * Un mensaje por línea, que es el encuadre de stdio en MCP.
 *
 * El búfer se acumula entre trozos porque un `data` de stdin no respeta las
 * líneas: parte un mensaje largo por la mitad tan a gusto como trae tres
 * juntos. Tratar cada trozo como un mensaje funciona hasta el primer
 * `tools/list` grande, y falla entonces.
 */
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (line) void forward(line);
  }
});
process.stdin.on("end", () => process.exit(0));

async function forward(line) {
  let id = null;
  try { id = JSON.parse(line).id ?? null; } catch { /* el servidor dirá que no se pudo leer */ }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: line,
    });
    // 202 = era una notificación y no hay nada que devolver.
    if (res.status === 202) return;
    if (!res.ok) {
      if (id !== null) write({ jsonrpc: "2.0", id, error: { code: -32000, message: `HTTP ${res.status}` } });
      return;
    }
    const text = await res.text();
    if (text.trim()) process.stdout.write(text.trim() + "\n");
  } catch (error) {
    // Que la app se haya cerrado no puede tirar al agente: se le contesta un
    // error normal y sigue su turno sin las herramientas del wiki.
    if (id !== null) write({ jsonrpc: "2.0", id, error: { code: -32000, message: String(error) } });
  }
}
