/**
 * Prueba de humo de la capa ACP contra un agente REAL.
 *
 * No es un test de `tests/`: levanta un proceso externo y necesita una cuenta
 * con sesión iniciada, así que no puede correr en CI. Es lo que se ejecuta a
 * mano para comprobar que el transporte sigue vivo después de tocar
 * `src/acp/`, o para diagnosticar un agente que no arranca.
 *
 *   node --experimental-strip-types scripts/acp-smoke.mjs [agente] [vault]
 *
 * `agente` es un id de `ACP_PRESETS` (opencode por defecto, porque es el que
 * habla ACP de fábrica y no necesita adaptador). Imprime lo que el agente
 * anuncia de sí mismo —capacidades, modelos, comandos de barra— y luego un
 * turno completo, que es donde se ve si el streaming llega tipado.
 */
import { AcpSession } from "../src/acp/session.ts";
import { ACP_PRESETS } from "../src/acp/presets.ts";

const agent = process.argv[2] ?? "opencode";
const cwd = process.argv[3] ?? process.cwd();

if (!ACP_PRESETS.some((p) => p.id === agent)) {
  console.error(`Agente desconocido: ${agent}`);
  console.error(`Conocidos: ${ACP_PRESETS.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const seen = new Set();
let text = "";

const session = await AcpSession.start({
  agent,
  cwd,
  onEvent: (e) => {
    if (e.kind === "update") {
      seen.add(e.update.sessionUpdate);
      if (e.update.sessionUpdate === "agent_message_chunk") {
        const chunk = e.update.content?.text ?? "";
        text += chunk;
        process.stdout.write(chunk);
      }
    }
    // El permiso se auto-acepta AQUÍ y solo aquí: en la app lo decide la
    // persona. Esta prueba necesita poder correr sin nadie mirando.
    if (e.kind === "permission") {
      const pick = e.request.options.find((o) => o.kind === "allow_once") ?? e.request.options[0];
      console.log(`\n[permiso] ${e.request.toolCall?.title} -> ${pick.name}`);
      e.respond(pick.optionId);
    }
    if (e.kind === "stderr") process.stderr.write(`[${agent}] ${e.text}`);
    if (e.kind === "closed") console.log(`\n[conexión cerrada]${e.error ? " " + e.error : ""}`);
  },
});

console.log(`agente     ${session.init.agentInfo?.name ?? agent} ${session.init.agentInfo?.version ?? ""}`);
console.log(`protocolo  v${session.init.protocolVersion}`);
console.log(`auth       ${(session.init.authMethods ?? []).map((m) => m.id).join(", ") || "ninguno"}`);

const id = await session.newSession(cwd);
console.log(`sesión     ${id}`);

for (const opt of session.configOptions) {
  const n = opt.type === "select" ? ` (${opt.options?.length ?? 0} opciones)` : "";
  console.log(`  opción   ${opt.id}=${JSON.stringify(opt.currentValue)}${n}`);
}

console.log("\n--- turno ---");
const stop = await session.prompt("Reply with exactly: ACP transport works. Nothing else.");
console.log(`\n\nstopReason  ${stop.stopReason}`);
console.log(`updates     ${[...seen].join(", ")}`);
console.log(`comandos    ${session.availableCommands.length} anunciados`);

session.close();
// La conexión cierra de forma asíncrona y no hay nada más que esperar; sin
// esto el proceso se queda vivo por el hijo aunque ya esté matado.
process.exit(text.trim() ? 0 : 1);
