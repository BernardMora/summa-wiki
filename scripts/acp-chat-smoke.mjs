/**
 * Prueba de humo del chat completo contra un agente REAL, sin navegador.
 *
 * Recorre la cadena entera del lado del servidor —registro de sesiones,
 * capacidad de terminal del cliente, protocolo de `wire.ts`— y pliega lo que
 * sale con el MISMO reductor que usa la interfaz, así que lo que imprime es lo
 * que se vería en pantalla. Lo único que no toca es el WebSocket y el JSX.
 *
 *   node --experimental-strip-types scripts/acp-chat-smoke.mjs [agente] [cwd]
 *
 * Pide a propósito un comando de shell y una edición: son las dos cosas que la
 * fase 2 tenía que hacer legibles sin una pty abierta.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, promptSession, answerPermission, killAcpSession, relaunch } from "../lib/acpSessions.ts";
import { reduce, EMPTY } from "../components/acp-transcript.ts";

const agent = process.argv[2] ?? "hermes";
// Un directorio de usar y tirar: el agente va a escribir en él.
const cwd = process.argv[3] ?? mkdtempSync(join(tmpdir(), "acp-smoke-"));
const owned = !process.argv[3];
if (owned) writeFileSync(join(cwd, "nota.md"), "# Nota\n\nUna línea.\n");

const id = "smoke";
const entry = openSession(id, agent, cwd);
// `--npx` fuerza el camino sin instalar, que es el único disponible para los
// adaptadores cuando no están en el PATH.
if (process.argv.includes("--npx")) setTimeout(() => relaunch(entry, true), 1_500);

let state = EMPTY;
entry.listeners.add((message) => {
  state = reduce(state, message);
  if (message.t === "stderr") return;
  // El permiso se auto-acepta AQUÍ y solo aquí: en la app lo decide la persona.
  if (message.t === "permission") {
    const pick = message.request.options.find((o) => o.kind === "allow_always")
      ?? message.request.options.find((o) => o.kind === "allow_once")
      ?? message.request.options[0];
    console.log(`[permiso] ${message.request.toolCall?.title ?? ""} -> ${pick?.name}`);
    if (pick) answerPermission(entry, message.requestId, pick.optionId);
  }
});

const listo = await new Promise((resolve) => {
  const started = Date.now();
  const tick = setInterval(() => {
    if (state.status === "ready") { clearInterval(tick); resolve(true); }
    if (state.status === "failed" && !process.argv.includes("--npx")) { clearInterval(tick); resolve(false); }
    if (Date.now() - started > 120_000) { clearInterval(tick); resolve(false); }
  }, 100);
});

if (!listo) {
  for (const item of state.items) if (item.kind === "error") console.error(`error: ${item.message}`);
  process.exit(1);
}

console.log(`agente     ${state.agentName}`);
console.log(`opciones   ${state.configOptions.map((o) => `${o.id}(${o.type})`).join(", ") || "ninguna"}`);
console.log(`comandos   ${state.commands.length}`);
console.log(`cwd        ${cwd}\n`);

await promptSession(entry, [
  "Do exactly two things, then stop.",
  "1. Run the shell command `ls -la` in the working directory.",
  "2. Append the line 'Otra línea.' to nota.md.",
].join(" "));

console.log("--- transcripción ---");
for (const item of state.items) {
  if (item.kind === "user") console.log(`\n> ${item.text}`);
  else if (item.kind === "message") console.log(`\n${item.text}`);
  else if (item.kind === "thought") console.log(`\n(pensando: ${item.text.slice(0, 60)}…)`);
  else if (item.kind === "plan") console.log(`\n[plan] ${item.entries.map((e) => e.content).join(" · ")}`);
  else if (item.kind === "error") console.log(`\n[error] ${item.message}`);
  else {
    console.log(`\n[${item.call.kind ?? "other"} ${item.call.status ?? "?"}] ${item.call.title}`);
    for (const content of item.call.content ?? []) {
      if (content.type === "diff") console.log(`  diff ${content.path} (${(content.oldText ?? "").length} -> ${content.newText.length} car.)`);
      if (content.type === "terminal") console.log(`  terminal ${content.terminalId}: ${(state.terminals[content.terminalId] ?? "").split("\n").length} líneas`);
      if (content.type === "content" && content.content.type === "text") console.log(`  content: ${content.content.text.slice(0, 80).replace(/\n/g, " ")}…`);
    }
    if (!(item.call.content ?? []).length) {
      console.log(`  (sin content) rawOutput=${item.call.rawOutput === undefined ? "no" : JSON.stringify(item.call.rawOutput).slice(0, 120)}`);
    }
  }
}

const terminales = Object.keys(state.terminals);
console.log(`\n--- resumen ---`);
console.log(`parada     ${state.stopReason}`);
console.log(`items      ${state.items.length}`);
console.log(`terminales ${terminales.length ? terminales.join(", ") : "ninguna (el agente ejecutó por su cuenta)"}`);
console.log(`diffs      ${state.items.filter((i) => i.kind === "tool" && (i.call.content ?? []).some((c) => c.type === "diff")).length}`);
if (state.usage) console.log(`contexto   ${state.usage.used}/${state.usage.size}`);
if (state.stderr) console.log(`\n--- stderr del agente ---\n${state.stderr.slice(-2000)}`);

killAcpSession(id);
if (owned) rmSync(cwd, { recursive: true, force: true });
process.exit(0);
