import { test } from "node:test";
import assert from "node:assert/strict";
import type * as acp from "@agentclientprotocol/sdk";
import type { AcpServerMessage } from "../src/acp/wire.ts";
import { reduceAll, EMPTY, showsDiagnostics, blockText, rawOutputText, splitFences, toRows } from "../components/acp-transcript.ts";
import { truncateUtf8, TerminalRegistry } from "../src/acp/terminal.ts";
import { fromLegacy, LEGACY_MODEL_ID } from "../src/acp/session.ts";
import { summarize } from "../lib/acpSessions.ts";

/**
 * Lo que se puede probar del chat sin navegador ni agente.
 *
 * Toda la lógica que puede fallar de verdad vive en dos funciones puras —el
 * pliegue de la conversación y el troceo de bloques de código— más el recorte
 * del búfer de terminal. El resto es JSX y una conexión, que no se prueban
 * aquí.
 */

const text = (t: string): acp.ContentBlock => ({ type: "text", text: t });
const chunk = (t: string): AcpServerMessage =>
  ({ t: "update", update: { sessionUpdate: "agent_message_chunk", content: text(t) } });

const READY: AcpServerMessage = {
  t: "ready", agent: "hermes", agentName: "Hermes Agent", agentDetail: "hermes-agent 0.20.5", sessionId: "s1", model: null,
  configOptions: [], availableCommands: [], imageInput: true, canList: false,
};

test("los trozos consecutivos se pegan en un solo mensaje", () => {
  const state = reduceAll([READY, chunk("Hola"), chunk(", "), chunk("mundo")]);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0]!.kind, "message");
  assert.equal((state.items[0] as { text: string }).text, "Hola, mundo");
});

/**
 * Pensar y hablar llegan como eventos DISTINTOS, así que el pensamiento se
 * puede plegar aparte sin reconocer ninguna marca en el texto. Es la mitad de
 * lo que se ganaba al dejar la pty: por una terminal esto eran secuencias ANSI
 * de color y adivinar dónde empieza y acaba.
 */
test("el pensamiento no se mezcla con la respuesta", () => {
  const think: AcpServerMessage =
    { t: "update", update: { sessionUpdate: "agent_thought_chunk", content: text("a ver") } };
  const state = reduceAll([READY, think, chunk("listo")]);
  assert.deepEqual(state.items.map((i) => i.kind), ["thought", "message"]);
});

/**
 * `tool_call_update` trae SOLO lo que cambió, y `null` en este protocolo
 * significa «sin cambios», no «vacío». Escribirlo borraría el título de la
 * herramienta en cuanto llegara el primer cambio de estado — que es siempre.
 */
test("una actualización de herramienta se funde y no borra lo que no manda", () => {
  const call: AcpServerMessage = {
    t: "update",
    update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Leer nota.md", kind: "read", status: "pending" },
  };
  const done: AcpServerMessage = {
    t: "update",
    update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", title: null },
  };
  const state = reduceAll([READY, call, done]);
  assert.equal(state.items.length, 1);
  const tool = state.items[0] as { call: acp.ToolCall };
  assert.equal(tool.call.title, "Leer nota.md");
  assert.equal(tool.call.status, "completed");
  assert.equal(tool.call.kind, "read");
});

/**
 * El caso de reengancharse a una conversación cuyo principio ya se recortó del
 * historial: llega la actualización de algo que nunca se anunció. Mejor una
 * tarjeta con lo que se sepa que un hueco silencioso.
 */
test("una actualización huérfana crea la tarjeta en vez de perderse", () => {
  const state = reduceAll([READY, {
    t: "update",
    update: { sessionUpdate: "tool_call_update", toolCallId: "t9", status: "failed" },
  }]);
  assert.equal(state.items.length, 1);
  assert.equal((state.items[0] as { call: acp.ToolCall }).call.status, "failed");
});

/** El plan se reemplaza entero cada vez, por spec: nunca se acumulan dos. */
test("el plan se reemplaza, no se acumula", () => {
  const plan = (n: number): AcpServerMessage => ({
    t: "update",
    update: {
      sessionUpdate: "plan",
      entries: Array.from({ length: n }, (_, i) => ({ content: `paso ${i}`, priority: "medium", status: "pending" })),
    },
  });
  const state = reduceAll([READY, plan(2), plan(3)]);
  assert.equal(state.items.filter((i) => i.kind === "plan").length, 1);
  assert.equal((state.items[0] as { entries: unknown[] }).entries.length, 3);
});

/**
 * La propiedad de la que depende reengancharse: el servidor reproduce la
 * conversación entera y esto la vuelve a plegar. Replegar N mensajes de golpe
 * tiene que dar EXACTAMENTE el mismo estado que haberlos recibido de uno en
 * uno, o volver a una pestaña mostraría algo distinto de lo que se estaba
 * viendo.
 */
test("reproducir da el mismo estado que recibir en vivo", () => {
  const stream: AcpServerMessage[] = [
    READY,
    { t: "sent", text: "hola" },
    chunk("qué"), chunk(" tal"),
    { t: "turn", stopReason: "end_turn" },
  ];
  const live = stream.reduce((s, m) => reduceAll([m], s), EMPTY);
  assert.deepEqual(reduceAll(stream), live);
});

test("un turno en curso deja el chat ocupado y su final lo libera", () => {
  const busy = reduceAll([READY, { t: "sent", text: "hola" }]);
  assert.equal(busy.status, "busy");
  assert.equal(reduceAll([{ t: "turn", stopReason: "end_turn" }], busy).status, "ready");
});

test("authentication methods replace an opaque startup failure", () => {
  const methods: acp.AuthMethod[] = [
    { id: "chat-gpt", name: "ChatGPT" },
    { id: "browser", name: "Browser login", type: "terminal", args: ["login"] },
  ];
  const auth = reduceAll([{ t: "auth-required", message: "Login required", methods, required: true }]);
  assert.equal(auth.status, "auth");
  assert.deepEqual(auth.auth?.methods, methods);
  assert.equal(auth.auth?.required, true);

  const running = reduceAll([{ t: "authenticating", methodId: "browser", terminal: false }], auth);
  assert.equal(running.status, "authenticating");
  assert.equal(running.manualAuth, null);
});

/**
 * Un método interactivo se hace FUERA de la app: se muestra el comando y se
 * espera a la persona. El estado vuelve a `auth` y no se queda en
 * `authenticating`, porque la app no está haciendo nada — y dejarlo ahí
 * deshabilitaría los botones que hacen falta para reintentar.
 */
test("an interactive sign-in shows the command and stays actionable", () => {
  const state = reduceAll([
    { t: "auth-required", message: "Login required", methods: [], required: true },
    { t: "authenticating", methodId: "claude-ai-login", terminal: true },
    { t: "auth-manual", methodId: "claude-ai-login", command: "/bin/agent --cli auth login", opened: true },
  ]);
  assert.equal(state.status, "auth");
  assert.equal(state.manualAuth?.command, "/bin/agent --cli auth login");
  assert.equal(state.manualAuth?.opened, true);
});

test("the command still reaches the user when the terminal could not be opened", () => {
  // El botón de abrir es una comodidad; el comando es el mecanismo. Un
  // escritorio sin ninguna terminal conocida no puede cerrar el camino.
  const state = reduceAll([
    { t: "auth-manual", methodId: "m", command: "agent auth login", opened: false },
  ]);
  assert.equal(state.manualAuth?.opened, false);
  assert.equal(state.manualAuth?.command, "agent auth login");
});

/**
 * Un fallo al ARRANCAR deja la sesión inservible; uno a mitad de turno no. Se
 * distinguen por si el agente llegó a contestar `initialize` — sin eso no hay
 * con quién seguir hablando, y la caja de escribir tiene que quedar cerrada.
 */
test("un fallo de arranque y uno de turno no dejan el chat igual", () => {
  const noStart = reduceAll([{ t: "error", message: "No se encontró \"hermes\"", install: "brew install hermes" }]);
  assert.equal(noStart.status, "failed");

  const midTurn = reduceAll([READY, { t: "error", message: "se cayó la red" }]);
  assert.equal(midTurn.status, "ready");
});

/**
 * Con dos ventanas abiertas sobre la misma conversación, la que no contestó
 * tiene que cerrar ESE diálogo y no cualquiera — si no, contestar un permiso
 * haría desaparecer otro que sigue esperando.
 */
test("cerrar un permiso solo cierra el suyo", () => {
  const ask = (requestId: string): AcpServerMessage => ({
    t: "permission", requestId,
    request: { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Borrar" }, options: [] },
  });
  const open = reduceAll([READY, ask("perm-2")]);
  assert.equal(reduceAll([{ t: "permission-done", requestId: "perm-1", optionId: "x" }], open).permission?.requestId, "perm-2");
  assert.equal(reduceAll([{ t: "permission-done", requestId: "perm-2", optionId: "x" }], open).permission, null);
});

test("la salida de cada terminal se acumula por id", () => {
  const out = (terminalId: string, chunk: string): AcpServerMessage => ({ t: "terminal", terminalId, chunk });
  const state = reduceAll([READY, out("term-1", "a"), out("term-2", "z"), out("term-1", "b")]);
  assert.deepEqual(state.terminals, { "term-1": "ab", "term-2": "z" });
});

/**
 * Un `sessionUpdate` que esta versión no conoce no es un error: el protocolo
 * crece, y romperse ante uno nuevo obligaría a actualizar la app cada vez que
 * un agente adopte algo del spec.
 */
test("un update desconocido se ignora sin romper nada", () => {
  const weird = { t: "update", update: { sessionUpdate: "cosa_del_futuro" } } as unknown as AcpServerMessage;
  const state = reduceAll([READY, weird, chunk("sigo aquí")]);
  assert.equal(state.items.length, 1);
});

test("blockText saca el texto de cada clase de bloque", () => {
  assert.equal(blockText({ type: "text", text: "hola" }), "hola");
  assert.equal(blockText({ type: "resource_link", uri: "file:///n.md", name: "n" }), "file:///n.md");
  assert.equal(blockText({ type: "image", data: "x", mimeType: "image/png" }), "");
});

test("sent and replayed images remain attached to the user message", () => {
  const image = { id: "pasted-1", mimeType: "image/png" as const, data: "aGVsbG8=", size: 5 };
  const sent = reduceAll([READY, { t: "sent", text: "inspect this", images: [image] }]);
  const sentItem = sent.items[0] as Extract<(typeof sent.items)[number], { kind: "user" }>;
  assert.deepEqual(sentItem.images, [image]);

  const replayed = reduceAll([READY, {
    t: "update",
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    },
  }]);
  const replayedItem = replayed.items[0] as Extract<(typeof replayed.items)[number], { kind: "user" }>;
  assert.equal(replayedItem.text, "");
  assert.equal(replayedItem.images[0]?.mimeType, "image/png");
  assert.equal(replayedItem.images[0]?.size, 5);
});

/**
 * El fallo que atrapa: un ``` mencionado a mitad de un párrafo abriendo un
 * bloque falso que se come el resto del mensaje. Pasa — los agentes explican
 * cómo escribir markdown.
 */
test("solo una cerca a principio de línea abre un bloque", () => {
  const parts = splitFences("usa ``` para citar código\ny ya");
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.code, false);
});

test("un bloque cercado sale aparte, con su lenguaje", () => {
  const parts = splitFences("antes\n```ts\nconst a = 1;\n```\ndespués");
  assert.deepEqual(parts.map((p) => p.code), [false, true, false]);
  assert.equal(parts[1]!.lang, "ts");
  assert.equal(parts[1]!.text, "const a = 1;");
});

/**
 * Un bloque sin cerrar es el caso NORMAL mientras el turno llega: se pinta
 * como código hasta donde va. Esperar al cierre haría que el código apareciera
 * de golpe al final en vez de escribiéndose.
 */
test("un bloque a medio llegar ya se pinta como código", () => {
  const parts = splitFences("mira:\n```sh\nnpm test");
  assert.equal(parts[1]!.code, true);
  assert.equal(parts[1]!.text, "npm test");
});

/**
 * El recorte del búfer de terminal parte de bytes, no de texto: acumular
 * decodificando trocearía cualquier carácter multibyte que caiga entre dos
 * lecturas de la tubería. Aquí se comprueba lo que exige el protocolo — cortar
 * por el principio y no dejar medio carácter, aunque eso deje menos bytes de
 * los pedidos.
 */
test("el recorte no parte un carácter por la mitad", () => {
  // "áé" son 4 bytes; pedir 3 tiene que soltar la á entera, no medio byte.
  const cut = truncateUtf8(Buffer.from("áé", "utf8"), 3);
  assert.equal(cut.truncated, true);
  assert.equal(cut.buf.toString("utf8"), "é");
});

test("por debajo del límite no se toca nada", () => {
  const buf = Buffer.from("hola", "utf8");
  const cut = truncateUtf8(buf, 100);
  assert.equal(cut.truncated, false);
  assert.equal(cut.buf, buf);
});

/**
 * La capacidad de terminal, ejercitada de verdad: se lanza un proceso, se
 * captura lo que escribe y se espera su final.
 *
 * Vale la pena probarla aunque en la práctica casi no se use —ni Hermes ni
 * OpenCode la usan, ejecutan por su cuenta y reportan por `content`— porque el
 * cliente la ANUNCIA, y un agente que la tome al pie de la letra tiene que
 * encontrarla funcionando. Anunciar una capacidad que no responde deja al
 * agente llamando a un hueco.
 */
test("un comando del cliente captura su salida y su final", async () => {
  const chunks: string[] = [];
  const registry = new TerminalRegistry({
    cwd: process.cwd(),
    env: process.env,
    onChunk: (_id, chunk) => chunks.push(chunk),
  });

  // `process.execPath` y no `echo`: el mismo comando tiene que valer en
  // Windows, donde `echo` es una función de la shell y no un binario.
  const { terminalId } = registry.create({
    sessionId: "s1",
    command: process.execPath,
    args: ["-e", "process.stdout.write('hola'); process.stderr.write('|aviso')"],
  });

  const exit = await registry.waitForExit(terminalId);
  assert.equal(exit.exitCode, 0);

  const out = registry.output(terminalId);
  assert.equal(out.truncated, false);
  // stdout y stderr comparten búfer, como los vería una terminal de verdad.
  assert.ok(out.output.includes("hola"));
  assert.ok(out.output.includes("|aviso"));
  assert.ok(chunks.join("").length > 0);

  registry.release(terminalId);
});

/**
 * Un comando que no existe: `spawn` no emite `exit`, solo `error`. Sin
 * atenderlo, `terminal/wait_for_exit` se queda esperando para siempre — y el
 * agente con él, sin nada que lo diga.
 */
test("un comando inexistente termina en vez de colgar al agente", async () => {
  const registry = new TerminalRegistry({ cwd: process.cwd(), env: process.env, onChunk: () => {} });
  const { terminalId } = registry.create({ sessionId: "s1", command: "no-existe-este-binario-jamas" });
  const exit = await registry.waitForExit(terminalId);
  assert.equal(exit.exitCode, 127);
  assert.ok(registry.output(terminalId).output.length > 0);
});

/**
 * Un id desconocido es un error del protocolo —el agente usó un terminal que
 * ya soltó, o uno que nunca creó—, no un caso vacío. Devolver salida vacía lo
 * escondería y el agente seguiría creyendo que espera a algo.
 */
test("un terminal soltado deja de existir", () => {
  const registry = new TerminalRegistry({ cwd: process.cwd(), env: process.env, onChunk: () => {} });
  const { terminalId } = registry.create({ sessionId: "s1", command: process.execPath, args: ["-e", ""] });
  registry.release(terminalId);
  assert.throws(() => registry.output(terminalId), /Terminal desconocida/);
});

/**
 * El error de «no está instalado» tiene que llevar las DOS salidas: el comando
 * para instalarlo y el atajo de npx. Si falta la segunda, la interfaz no pinta
 * el botón — y este es el fallo que se ve al abrir un chat con Codex o Claude
 * Code recién estrenada la app.
 */
test("un binario ausente ofrece instalar y también ejecutar sin instalar", () => {
  const state = reduceAll([{
    t: "error",
    message: 'No se encontró "codex-acp" en el PATH',
    install: "npm install -g @agentclientprotocol/codex-acp@latest",
    npx: "npx -y @agentclientprotocol/codex-acp",
  }]);
  const err = state.items[0] as { install?: string; npx?: string };
  assert.match(err.install!, /^npm install -g/);
  assert.match(err.npx!, /^npx -y/);
  assert.equal(state.status, "failed");
});

/**
 * Reintentar limpia la pantalla: lo que había era el error de que faltaba el
 * binario, y dejarlo encima del arranque nuevo diría que sigue fallando. El
 * contador de claves NO se reinicia, o el primer item del intento nuevo
 * reutilizaría la clave de uno recién desmontado.
 */
test("relanzar borra el error anterior sin reciclar claves", () => {
  const failed = reduceAll([{ t: "error", message: "falta", npx: "npx -y x" }]);
  const again = reduceAll([{ t: "restarting" }], failed);
  assert.deepEqual(again.items, []);
  assert.equal(again.status, "starting");
  assert.ok(again.seq >= failed.seq);

  const after = reduceAll([{ t: "error", message: "otra vez" }], again);
  assert.notEqual(after.items[0]!.key, failed.items[0]!.key);
});

/**
 * Un `ready` después de un error levanta la sesión.
 *
 * Es exactamente lo que pasa al reintentar con npx, y el fallo que atrapa era
 * reproducible: la interfaz se quedaba en «falló» con el agente ya corriendo y
 * la caja de escribir muerta.
 */
test("reintentar con éxito sale del estado de fallo", () => {
  const failed = reduceAll([{ t: "error", message: "falta", npx: "npx -y x" }]);
  assert.equal(failed.status, "failed");
  assert.equal(reduceAll([READY], failed).status, "ready");
});

/**
 * Pero un `ready` NO interrumpe un turno en curso: al reengancharse en mitad
 * de uno, el `ready` sintetizado llega antes que el `sent` que lo abrió, y
 * marcar «listo» ahí habilitaría el botón de mandar mientras el agente
 * escribe.
 */
test("un ready no cancela un turno en curso", () => {
  const busy = reduceAll([READY, { t: "sent", text: "hola" }]);
  assert.equal(reduceAll([READY], busy).status, "busy");
});

/**
 * El tercer camino de salida, que el protocolo no define: `rawOutput`.
 *
 * El adaptador de Codex deja ahí la salida de sus comandos y no manda
 * `content` ninguno. Sin este respaldo, un `ls` que sí corrió se pinta como
 * una tarjeta vacía. Al ser `unknown` en el esquema, lo que se puede hacer es
 * probar las formas que se han visto de verdad y, si no, enseñar el JSON —
 * cualquier cosa antes que nada.
 */
test("rawOutput da texto legible en las formas que se ven en la práctica", () => {
  assert.equal(rawOutputText("hola"), "hola");
  assert.equal(rawOutputText({ formatted_output: "total 8\n." }), "total 8\n.");
  assert.equal(rawOutputText({ stdout: "ok" }), "ok");
  // Nada que reconocer: el JSON enseña algo en vez de nada.
  assert.match(rawOutputText({ raro: 1 }), /raro/);
  // Vacío es vacío: la interfaz no debe pintar un desplegable sin contenido.
  assert.equal(rawOutputText(undefined), "");
  assert.equal(rawOutputText(null), "");
  assert.equal(rawOutputText({ output: "" }), '{\n  "output": ""\n}');
});

/**
 * Reintentar tras instalar el paquete tiene que dejar la pantalla limpia.
 *
 * El fallo que esto acompaña vivía en el servidor —una entrada muerta que se
 * reproducía para siempre— pero el lado del cliente también tiene que
 * cooperar: si `restarting` no borrase el error, el usuario vería el mismo
 * mensaje encima de una sesión que ya arrancó bien.
 */
test("tras reinstalar, un relanzamiento con éxito no deja rastro del error", () => {
  const failed = reduceAll([{
    t: "error", message: "falta", code: "agent-not-found", command: "codex-acp",
    install: "npm i -g x", npx: "npx -y x",
  }]);
  assert.equal(failed.status, "failed");

  const relaunched = reduceAll([{ t: "restarting" }, READY], failed);
  assert.equal(relaunched.status, "ready");
  assert.deepEqual(relaunched.items, []);
});

/**
 * stderr is kept always and shown almost never.
 *
 * Every agent writes routine noise there — Claude Code one `[session/query]`
 * line per turn, Hermes two dozen plugin `[INFO]` lines at startup — so a panel
 * that shows up in healthy conversations teaches you to ignore it, and then it
 * gets ignored on the day it holds the only explanation.
 */
test("diagnostics stay hidden while the session is healthy", () => {
  const healthy = reduceAll([
    { t: "ready", agent: "a", agentName: "A", agentDetail: "", sessionId: "s", configOptions: [], availableCommands: [], model: null, imageInput: false, canList: false },
    { t: "stderr", text: "[session/query] sessionId=235f resume=none apiType=native\n" },
    { t: "sent", text: "hola" },
    { t: "turn", stopReason: "end_turn" },
  ]);
  assert.equal(healthy.stderr.length > 0, true, "the log is still collected");
  assert.equal(showsDiagnostics(healthy), false, "but nothing asks to be read");
});

test("diagnostics appear, already populated, the moment something breaks", () => {
  // The log was accumulating from the start, so the panel opens with the
  // explanation inside instead of waiting for the failure to happen again.
  const base = reduceAll([{ t: "stderr", text: "credential file missing\n" }]);
  assert.equal(showsDiagnostics(base), false);

  const failures: AcpServerMessage[] = [
    { t: "auth-required", message: "Login required", methods: [], required: true },
    { t: "closed", error: "pipe closed" },
  ];
  for (const failure of failures) {
    const broken = reduceAll([failure], base);
    assert.equal(showsDiagnostics(broken), true, `${failure.t} should surface the log`);
    assert.match(broken.stderr, /credential file missing/);
  }
});

test("a mid-turn failure surfaces diagnostics even though the session stays usable", () => {
  // Status remains "ready" here — the error item is what gives it away.
  const state = reduceAll([
    { t: "ready", agent: "a", agentName: "A", agentDetail: "", sessionId: "s", configOptions: [], availableCommands: [], model: null, imageInput: false, canList: false },
    { t: "stderr", text: "tool crashed\n" },
    { t: "error", message: "Tool call failed" },
  ]);
  assert.notEqual(state.status, "failed");
  assert.equal(showsDiagnostics(state), true);
});

test("an empty log never draws an empty panel", () => {
  assert.equal(showsDiagnostics(reduceAll([{ t: "closed", error: "gone" }])), false);
});

/*
 * Tool-call runs, folded. What matters is that grouping is decided ONLY by
 * adjacency and length, and that a group's key is the first call's — the
 * disclosure must not remount as later calls land in the same run.
 */
const tool = (id: string, kind: acp.ToolKind): AcpServerMessage =>
  ({ t: "update", update: { sessionUpdate: "tool_call", toolCallId: id, title: id, kind, status: "completed" } });

test("una racha de llamadas se pliega en una fila, y una sola no", () => {
  const one = reduceAll([READY, chunk("hola"), tool("a", "read")]);
  assert.deepEqual(toRows(one.items).map((r) => r.row), ["item", "item"]);

  const many = reduceAll([READY, chunk("hola"), tool("a", "read"), tool("b", "execute"), tool("c", "execute")]);
  const rows = toRows(many.items);
  assert.deepEqual(rows.map((r) => r.row), ["item", "tools"]);
  assert.equal(rows[1]!.row === "tools" && rows[1]!.items.length, 3);
});

test("un mensaje entre dos llamadas parte la racha en dos", () => {
  const state = reduceAll([READY, tool("a", "read"), tool("b", "read"), chunk("a medias"), tool("c", "execute"), tool("d", "execute")]);
  assert.deepEqual(toRows(state.items).map((r) => r.row), ["tools", "item", "tools"]);
});

test("la clave del grupo no cambia cuando llegan más llamadas a la misma racha", () => {
  const first = toRows(reduceAll([READY, tool("a", "read"), tool("b", "read")]).items);
  const later = toRows(reduceAll([READY, tool("a", "read"), tool("b", "read"), tool("c", "execute")]).items);
  assert.equal(first[0]!.key, later[0]!.key);
});

/*
 * The legacy `models` block, promoted to a real control. The regression this
 * guards is the one that shipped: a picker rendered as inert text because the
 * probe used the wrong method name.
 */
test("varios modelos por la API vieja salen como desplegable, no como texto", () => {
  const res = {
    sessionId: "s1",
    modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }, { id: "yolo", name: "Yolo" }] },
    models: {
      currentModelId: "anthropic:opus",
      availableModels: [
        { modelId: "anthropic:opus", name: "Anthropic · opus" },
        { modelId: "openai:gpt", name: "OpenAI · gpt" },
      ],
    },
  } as unknown as acp.NewSessionResponse;
  const { options, model } = fromLegacy(res);
  const picker = options.find((o) => o.id === LEGACY_MODEL_ID);
  assert.ok(picker, "falta el desplegable de modelo");
  assert.equal(picker!.type, "select");
  assert.equal(picker!.type === "select" && picker!.options.length, 2);
  assert.equal(picker!.type === "select" && picker!.currentValue, "anthropic:opus");
  // Sin texto al lado: sería el mismo dato dos veces.
  assert.equal(model, null);
});

test("un solo modelo se queda como texto: no es una elección", () => {
  const res = {
    sessionId: "s1",
    models: { currentModelId: "only", availableModels: [{ modelId: "only", name: "El único" }] },
  } as unknown as acp.NewSessionResponse;
  const { options, model } = fromLegacy(res);
  assert.equal(options.find((o) => o.id === LEGACY_MODEL_ID), undefined);
  assert.deepEqual(model, { id: "only", label: "El único" });
});


/* ------------------------------------------------- conversaciones anteriores */

/**
 * La lista se pide al abrir el menú y llega por el mismo socket que todo lo
 * demás, así que el reductor tiene que aceptarla en cualquier momento — no
 * solo antes del primer mensaje.
 */
test("la lista de conversaciones entra sin tocar la transcripción", () => {
  const state = reduceAll([
    READY, chunk("hola"),
    { t: "sessions", sessions: [{ sessionId: "a", title: "Una", updatedAt: "2026-08-20T10:00:00Z" }] },
  ]);
  assert.equal(state.sessions?.length, 1);
  assert.equal(state.items.length, 1);
});

/**
 * `null` y `[]` NO son lo mismo: uno es «no se ha preguntado» y el otro «no
 * hay ninguna». Con un solo valor, el menú diría «no hay conversaciones»
 * durante el viaje de ida y vuelta — la respuesta contraria dicha con
 * seguridad.
 */
test("sin preguntar es null, y preguntado sin resultados es una lista vacía", () => {
  assert.equal(reduceAll([READY]).sessions, null);
  assert.deepEqual(reduceAll([READY, { t: "sessions", sessions: [] }]).sessions, []);
});

/**
 * Cargar una conversación borra la pantalla, y el `ready` que confirma la
 * carga llega DETRÁS de los mensajes reproducidos. Si el borrado se llevara
 * `canList`, el botón del historial desaparecería justo mientras se usa.
 */
test("cargar borra la transcripción pero no el botón que la cargó", () => {
  const ready: AcpServerMessage = { ...READY, canList: true };
  const state = reduceAll([
    ready, chunk("de la conversación anterior"),
    { t: "restarting", reason: "load" },
  ]);
  assert.equal(state.items.length, 0, "la transcripción vieja sigue ahí");
  assert.equal(state.canList, true, "el botón del historial se perdió");
  assert.equal(state.loading, true);
});

/** Y el `ready` del final apaga el aviso de carga y caduca la lista. */
test("el ready del final de la carga cierra el estado de carga", () => {
  const ready: AcpServerMessage = { ...READY, canList: true };
  const state = reduceAll([
    ready,
    { t: "sessions", sessions: [{ sessionId: "a", title: "Una", updatedAt: "" }] },
    { t: "restarting", reason: "load" },
    chunk("la conversación reproducida"),
    ready,
  ]);
  assert.equal(state.loading, false);
  assert.equal(state.status, "ready");
  assert.equal(state.items.length, 1);
  // La lista era de ANTES de cargar e incluía la conversación que ahora está
  // abierta; volver a abrir el menú la pide otra vez.
  assert.equal(state.sessions, null);
});

/**
 * Relanzar el agente (el reintento con npx) sigue empezando de cero: no es una
 * carga, y el `reason` es lo único que las distingue.
 */
test("relanzar no se confunde con cargar", () => {
  const state = reduceAll([{ ...READY, canList: true }, chunk("x"), { t: "restarting" }]);
  assert.equal(state.loading, false);
});

/**
 * Codex manda como título el PRIMER MENSAJE ENTERO — cuatrocientos caracteres
 * en una conversación real. Sin recortar, cada fila de la lista traería un
 * texto que nadie va a leer.
 */
test("los títulos kilométricos se recortan antes de salir por el socket", () => {
  const long = "a".repeat(400);
  const out = summarize({ sessionId: "s", cwd: "/v", title: long, updatedAt: "2026-08-20T10:00:00Z" });
  assert.ok(out.title.length <= 120, `salieron ${out.title.length} caracteres`);
  assert.ok(out.title.endsWith("…"));
  assert.equal(out.sessionId, "s");
});

/** Los saltos de línea de un prompt pegado harían filas de varios renglones. */
test("el título se aplana a una línea", () => {
  const out = summarize({ sessionId: "s", cwd: "/v", title: "  dos\n\nlíneas  ", updatedAt: null });
  assert.equal(out.title, "dos líneas");
  // Un agente que no fecha sus sesiones no debe producir un `undefined` que la
  // interfaz tenga que volver a comprobar.
  assert.equal(out.updatedAt, "");
});
