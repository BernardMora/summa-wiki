import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentPaths, AGENT_BINARIES } from "../src/agents.ts";

/**
 * El sondeo de agentes no se puede probar de punta a punta: levanta una shell
 * de login del usuario, y en CI no hay ninguno de los cuatro CLIs instalado.
 * Lo que sí se puede probar —y donde están todos los fallos reales— es el
 * parseo de lo que esa shell devuelve.
 */

test("una salida limpia se reparte por id de agente", () => {
  const out = [
    "claude\t/usr/local/bin/claude",
    "agy\t/home/u/.local/bin/agy",
    "opencode\t/home/u/.opencode/bin/opencode",
    "codex\t/home/u/.local/bin/codex",
  ].join("\n");

  assert.deepEqual(parseAgentPaths(out, false), {
    claude: "/usr/local/bin/claude",
    // `agy`, no `antigravity`: el id de la interfaz y el binario NO coinciden,
    // y es justo el caso que un mapa ingenuo se salta.
    antigravity: "/home/u/.local/bin/agy",
    opencode: "/home/u/.opencode/bin/opencode",
    codex: "/home/u/.local/bin/codex",
  });
});

test("un binario ausente deja la ruta vacía y da null", () => {
  const out = "claude\t/usr/local/bin/claude\nagy\t\nopencode\t\ncodex\t";
  const paths = parseAgentPaths(out, false);
  assert.equal(paths.claude, "/usr/local/bin/claude");
  assert.equal(paths.antigravity, null);
  assert.equal(paths.opencode, null);
  assert.equal(paths.codex, null);
});

/**
 * La regresión que motivó separar esta función. Una zsh interactiva imprime su
 * propio ruido antes de obedecer, y esa línea llega mezclada con los resultados
 * en el mismo stdout.
 */
test("el ruido de una shell interactiva no se cuela", () => {
  const out = [
    "Restored session: Sun Aug 16 18:02:57 PDT 2026",
    "claude\t/usr/local/bin/claude",
    "agy\t",
    "opencode\t",
    "codex\t",
  ].join("\n");
  assert.deepEqual(parseAgentPaths(out, false), {
    claude: "/usr/local/bin/claude",
    antigravity: null,
    opencode: null,
    codex: null,
  });
});

test("una ruta relativa se rechaza: no se puede lanzar", () => {
  assert.equal(parseAgentPaths("claude\tclaude", false).claude, null);
  assert.equal(parseAgentPaths("claude\t./claude", false).claude, null);
});

test("en Windows valen las rutas con letra de unidad y nada más", () => {
  const win = parseAgentPaths("claude\tC:\\Users\\u\\AppData\\npm\\claude.cmd", true);
  assert.equal(win.claude, "C:\\Users\\u\\AppData\\npm\\claude.cmd");

  // `Get-Command` también resuelve alias y funciones de PowerShell: devuelven
  // un nombre, no una ruta, y lanzarlos desde la terminal incrustada falla.
  assert.equal(parseAgentPaths("claude\tclaude", true).claude, null);

  // Una ruta de Unix en modo Windows tampoco: si eso llega, algo se cruzó.
  assert.equal(parseAgentPaths("claude\t/usr/local/bin/claude", true).claude, null);
});

test("una salida vacía deja los cuatro en null, no lanza", () => {
  assert.deepEqual(parseAgentPaths("", false), {
    claude: null, antigravity: null, opencode: null, codex: null,
  });
});

test("cada id declarado tiene binario, y el mapa cubre los cuatro", () => {
  const ids = Object.keys(AGENT_BINARIES);
  assert.deepEqual(ids.sort(), ["antigravity", "claude", "codex", "opencode"]);
  assert.deepEqual(Object.keys(parseAgentPaths("", false)).sort(), ids.sort());
});
