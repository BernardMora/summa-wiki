import { shellLine } from "../src/acp/launchTerminal.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResolvedPath, agentEnv } from "../src/acp/session.ts";
import { ACP_PRESETS, presetById, installCommand, installDocsUrl, npxArgs, type AcpPreset } from "../src/acp/presets.ts";

/**
 * Lo que se puede probar sin un agente instalado.
 *
 * Arrancar una sesión de verdad levanta un proceso externo y necesita una
 * cuenta con sesión iniciada; en CI no hay ninguna de las dos cosas. Pero los
 * fallos reales de esta capa no están en el protocolo —de eso se encarga el
 * SDK— sino en lo de siempre: resolver el PATH como lo vería el usuario y no
 * filtrarle al agente un entorno contaminado.
 */

test("se queda con la primera ruta absoluta", () => {
  assert.equal(parseResolvedPath("/Users/u/.opencode/bin/opencode\n", false), "/Users/u/.opencode/bin/opencode");
});

/**
 * La regresión que ya mordió en `src/agents.ts`: una zsh de login e interactiva
 * imprime lo suyo ANTES de obedecer, y ese ruido llega por el mismo stdout.
 */
test("el ruido de una shell interactiva no se confunde con una ruta", () => {
  const out = ["Restored session: Wed Aug 20 21:00:00", "/usr/local/bin/hermes"].join("\n");
  assert.equal(parseResolvedPath(out, false), "/usr/local/bin/hermes");
});

test("un binario ausente deja stdout vacío y da null", () => {
  assert.equal(parseResolvedPath("", false), null);
  assert.equal(parseResolvedPath("\n\n  \n", false), null);
});

/**
 * En Windows `Get-Command` resuelve además alias y funciones de PowerShell, que
 * devuelven un nombre y no una ruta. Lanzarlos con `spawn` falla, así que no
 * cuentan como encontrado.
 */
test("en Windows solo cuenta una ruta con letra de unidad", () => {
  assert.equal(parseResolvedPath("C:\\Users\\u\\bin\\codex-acp.cmd", true), "C:\\Users\\u\\bin\\codex-acp.cmd");
  assert.equal(parseResolvedPath("codex-acp", true), null);
});

/**
 * `CLAUDE_CODE_CHILD_SESSION` es el que muerde: si el servidor se arrancó desde
 * dentro de una sesión de Claude Code, el agente lanzado se cree sesión hija y
 * desactiva el guardado de transcripciones — un fallo que no parece fallo.
 */
test("el entorno del agente sale limpio de CLAUDE_CODE_ y npm_", () => {
  const env = agentEnv({
    NODE_ENV: "test",
    HOME: "/Users/u",
    PATH: "/usr/bin",
    CLAUDE_CODE_CHILD_SESSION: "1",
    npm_lifecycle_event: "dev",
    npm_execpath: "/usr/lib/npm",
    ANTHROPIC_API_KEY: "sk-x",
  } as NodeJS.ProcessEnv);

  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.npm_lifecycle_event, undefined);
  assert.equal(env.npm_execpath, undefined);
  // Las credenciales del usuario SÍ pasan: el agente corre con su cuenta, y
  // quitarlas rompería justo el caso normal.
  assert.equal(env.ANTHROPIC_API_KEY, "sk-x");
  assert.equal(env.HOME, "/Users/u");
});

test("los ids del registro son únicos", () => {
  const ids = ACP_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

/**
 * La afirmación que sostiene el plan de migración: la mayoría habla ACP de
 * fábrica. Si alguna vez deja de ser cierto, que se entere una prueba y no el
 * texto de onboarding, que promete cuántas cosas hay que instalar.
 *
 * Antigravity entró el 2026-08-21 y es el tercero: su CLI no tiene modo ACP,
 * así que necesita `agy-acp`. Es además el único adaptador de TERCEROS —los
 * otros dos los publica la organización de ACP—, y por eso la prueba de abajo
 * exige que todo adaptador venga de npm: es lo que permite ofrecerlo sin
 * instalarlo y, sobre todo, nombrar exactamente qué paquete se ejecuta.
 */
test("solo Claude Code, Codex y Antigravity necesitan un adaptador aparte", () => {
  const adapters = ACP_PRESETS.filter((p) => p.adapter).map((p) => p.id);
  assert.deepEqual(adapters.sort(), ["antigravity", "claude-code", "codex"]);
});

/**
 * Un adaptador tiene que decir de dónde sale: o es un paquete de npm —y
 * entonces se puede ofrecer sin instalarlo— o trae un comando de instalación.
 * No vale ninguno de los dos y, sobre todo, no valen los dos a la vez: si
 * hubiera `npm`, `installCommand` lo prefiere y el `install` escrito a mano
 * quedaría muerto sin que nadie lo note.
 */
test("todo adaptador dice de dónde sale, por npm o por instalador", () => {
  for (const p of ACP_PRESETS.filter((x) => x.adapter)) {
    assert.ok(p.npm || p.install, `${p.id} es adaptador y no dice cómo conseguirlo`);
    assert.ok(!(p.npm && p.install), `${p.id} tiene dos orígenes y uno se ignoraría`);
  }
});

/**
 * El fallo que esta prueba existe para atrapar: un preset cuyo comando arranca
 * la TUI del agente en vez de su modo ACP. No falla al lanzarlo — el proceso
 * vive, dibuja su interfaz en un stdout que nadie mira, y la sesión se queda
 * colgada esperando una respuesta a `initialize` que no va a llegar. Es
 * exactamente lo que hace `gemini` sin `--experimental-acp`.
 *
 * La invariante NO es "los nativos llevan args": `vibe-acp` es un binario ACP
 * dedicado que viene incluido con Mistral Vibe, así que no necesita ninguno. Lo
 * que debe cumplirse siempre es que la entrada a ACP esté declarada de UNA de
 * las dos formas — el binario ya lo es, o los argumentos lo ponen ahí.
 */
test("todo preset declara cómo se entra en modo ACP", () => {
  for (const p of ACP_PRESETS) {
    const binaryIsAcp = p.command.endsWith("-acp");
    assert.ok(
      binaryIsAcp || p.args.length > 0,
      `${p.id} lanzaría la TUI: ni su binario es ACP ni sus args lo ponen en ese modo`,
    );
  }
});

test("presetById encuentra y no inventa", () => {
  assert.equal(presetById("hermes")?.command, "hermes");
  assert.equal(presetById("no-existe"), undefined);
});

/**
 * Windows bajo WSL usa el instalador de Unix a propósito: ahí el binario vive
 * dentro de la distribución de Linux, y el `iex` de PowerShell instalaría algo
 * que el agente no va a poder lanzar.
 */
test("el comando de instalación distingue Windows nativo de WSL", () => {
  const hermes = presetById("hermes")!;
  assert.match(installCommand(hermes, true), /irm/);
  assert.match(installCommand(hermes, false), /curl/);

  /*
   * Sin variante de Windows, se cae al de Unix en vez de quedarse sin comando.
   *
   * Con un preset inventado y no con uno de la tabla: la versión anterior de
   * esta prueba usaba `gemini`, y se rompió el día que Gemini salió del
   * registro. Lo que se comprueba es el COMPORTAMIENTO de `installCommand`, y
   * no debe depender de que exista hoy un agente con esa forma.
   */
  const sinWindows: AcpPreset = {
    id: "x", name: "X", logo: "/harnesses/x.svg", docs: "https://example.com/x",
    command: "x", args: [], adapter: false,
    install: { default: "curl x | bash" },
  };
  assert.equal(installCommand(sinWindows, true), "curl x | bash");
});

/**
 * Nadie se queda sin comando de instalación, en ninguna plataforma. Es lo que
 * ve el usuario cuando falta el binario, y una cadena vacía ahí es peor que el
 * error: el mensaje dice «instálalo con» y no dice con qué.
 */
test("todo preset sabe cómo instalarse en las dos plataformas", () => {
  for (const p of ACP_PRESETS) {
    assert.ok(installCommand(p, false).length > 0, `${p.id} sin comando en Unix`);
    assert.ok(installCommand(p, true).length > 0, `${p.id} sin comando en Windows`);
  }
});

/**
 * El aviso de «no está instalado» ofrece este enlace, y un enlace que no abre
 * nada es peor que ninguno: quien llega ahí ya tuvo un fallo. Se comprueba la
 * forma —https y absoluta—, no que responda: la prueba no toca la red.
 */
test("todo preset lleva una guía de instalación abrible", () => {
  for (const p of ACP_PRESETS) {
    assert.match(installDocsUrl(p), /^https:\/\/\S+$/, `${p.id} sin guía usable`);
  }
});

/**
 * Antigravity es el único al que le falta OTRA cosa: corre por `bunx`, así que
 * lo que no está instalado es Bun. Mandarlo a la página de Antigravity a
 * instalar Bun es mandarlo al sitio equivocado, y el comando que se le ofrece
 * —el instalador de Bun— dejaría de cuadrar con la guía de al lado.
 */
test("la guía apunta a lo que de verdad falta", () => {
  const antigravity = presetById("antigravity")!;
  assert.match(installDocsUrl(antigravity), /bun\.sh/);
  assert.match(installCommand(antigravity, false), /bun\.sh/);
});

/**
 * `installDocs` existe para desviar. Uno que repita `docs` es un campo que no
 * hace nada y que la próxima persona tendrá que leer para descubrirlo.
 */
test("installDocs solo está cuando desvía", () => {
  for (const p of ACP_PRESETS) {
    if (p.installDocs === undefined) continue;
    assert.notEqual(p.installDocs, p.docs, `${p.id} repite docs sin motivo`);
  }
});

/**
 * El camino de npx existe solo para los que vienen del registro de npm — los
 * demás se instalan con un script de shell y npx no puede hacer nada con
 * ellos. Y el paquete va SIN versión: con `@latest`, npx consulta la red en
 * cada arranque en vez de usar su caché, que es justo lo que este camino
 * pretende evitar.
 */
test("solo los adaptadores de npm pueden correr con npx", () => {
  for (const p of ACP_PRESETS) {
    const args = npxArgs(p);
    if (!p.npm) { assert.equal(args, null, `${p.id} no viene de npm`); continue; }
    assert.equal(args![0], "-y");
    assert.equal(args![1], p.npm);
    assert.ok(!p.npm.includes("@latest"), `${p.id} fijaría la red en cada arranque`);
    // Instalar sí lleva versión: se decide una vez, no en cada arranque.
    assert.match(installCommand(p, false), /@latest$/);
  }
});

/**
 * Un adaptador que no encuentra el CLI que envuelve se descarga el suyo, y esa
 * descarga puede fallar: `antigravity-acp` intenta bajar `agy` de una URL que
 * hoy da 404. Se recupera, pero paga una llamada a la red en cada arranque y
 * deja un aviso alarmante en el diagnóstico. `envFrom` lo evita diciéndole
 * dónde está el binario que el usuario ya tiene.
 */
test("Antigravity le dice al adaptador dónde está agy", () => {
  assert.equal(presetById("antigravity")?.envFrom?.AGY_BIN, "agy");
});

/**
 * Gemini CLI salió del registro el 2026-08-21: contra una cuenta de
 * particulares, Google responde que el cliente ya no está soportado y la
 * sesión muere en `session/new`. Que lo diga una prueba y no solo un
 * comentario — volver a añadirlo sin comprobar que autentica es el error fácil.
 */
test("Gemini CLI ya no se ofrece", () => {
  assert.equal(presetById("gemini"), undefined);
});


/**
 * Hermes ya no necesita la frase de «se configura fuera»: manda sus modelos.
 *
 * Esta prueba y `configHint` nacieron con horas de diferencia y de una
 * conclusión equivocada — que Hermes no anunciaba nada— porque la fase 1 solo
 * miró `configOptions`. Manda doce modelos y tres modos por la API vieja. Se
 * deja el campo en el tipo porque otro agente puede necesitarlo, pero Hermes
 * ya no lo usa y la prueba lo fija para que nadie lo devuelva por costumbre.
 */
test("Hermes anuncia sus modelos y no necesita pista externa", () => {
  assert.equal(presetById("hermes")?.configHint, undefined);
});

/**
 * Sign-in moved out of the app, so the command shown to the user IS the
 * mechanism. If it does not paste cleanly, there is no fallback behind it.
 */
test("the sign-in command survives spaces, quotes and env vars", () => {
  assert.equal(
    shellLine({ command: "/usr/local/bin/agent", args: ["--cli", "auth", "login"], env: {}, cwd: "/v" }),
    "/usr/local/bin/agent --cli auth login",
  );

  // A path with spaces is the normal case on macOS and Windows, not an edge one.
  assert.equal(
    shellLine({ command: "/Applications/My Agent/bin/x", args: ["a b"], env: {}, cwd: "/v" }),
    "'/Applications/My Agent/bin/x' 'a b'",
  );

  // Env goes in front, which is the form bash, zsh and fish all accept.
  assert.equal(
    shellLine({ command: "/bin/x", args: [], env: { TOKEN: "a b" }, cwd: "/v" }),
    "TOKEN='a b' /bin/x",
  );

  // An embedded single quote must not end the quoting and let the rest run.
  assert.equal(
    shellLine({ command: "/bin/x", args: ["it's"], env: {}, cwd: "/v" }),
    `/bin/x 'it'\\''s'`,
  );
});
