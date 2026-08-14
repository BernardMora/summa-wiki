import { useEffect, useState } from "react";

/**
 * Los parámetros con los que arranca una sesión del agente.
 *
 * **No se guardan en ningún sitio.** Son argumentos de arranque de UNA sesión
 * de Claude Code, no preferencias de esta app: la configuración permanente del
 * modelo vive en Claude Code, que es de donde sale el default, y duplicarla
 * aquí crearía una segunda fuente de verdad que se desincroniza en cuanto el
 * usuario cambie la primera. Vale doble para los permisos: saltárselos no
 * debería quedar pegajoso entre corridas.
 *
 * El archivo se llama `agent-session.ts` en kebab y no `agentSession.ts`: el
 * componente hermano es `AgentSession.tsx`, y en macOS —sistema de archivos
 * insensible a mayúsculas— los dos nombres son el MISMO archivo. TypeScript lo
 * detecta y se niega a compilar. Misma familia de trampa que el NFD de los
 * acentos que rompió seis enlaces en la Fase 7.
 *
 * Compartido entre el asistente de creación y la ingesta suelta, que ofrecen
 * exactamente la misma decisión y no deberían poder describirla distinto.
 */

/**
 * Alias y no ids completos (`opus`, no `claude-opus-5`): el CLI los resuelve a
 * la última versión de esa familia, así que la elección no se queda vieja
 * cuando salga el siguiente modelo.
 */
export const MODELS: Record<string, { id: string; label: string; hint: string }[]> = {
  claude: [
    { id: "", label: "El de tu CLI", hint: "Lo que ya tengas configurado en Claude Code." },
    { id: "opus", label: "Opus", hint: "El mejor criterio con notas ambiguas. Más lento y más caro." },
    { id: "sonnet", label: "Sonnet", hint: "Equilibrado. Suficiente para material que ya viene ordenado." },
    { id: "haiku", label: "Haiku", hint: "El más rápido y barato. Para lotes grandes y clasificación simple." },
  ],
  antigravity: [
    { id: "", label: "El de tu CLI", hint: "Lo que ya tengas configurado en Antigravity." },
    { id: "pro", label: "Pro", hint: "Para tareas de alto razonamiento y notas complejas." },
    { id: "flash", label: "Flash", hint: "Rápido y eficiente para tareas sencillas." },
  ],
  opencode: [
    { id: "", label: "El de tu CLI", hint: "Lo que ya tengas configurado en OpenCode." },
    { id: "pro", label: "Pro", hint: "Modelo complejo y de alto rendimiento." },
    { id: "flash", label: "Flash", hint: "Modelo ágil para volúmenes grandes." },
  ],
};

/**
 * El default acepta ediciones sin preguntar porque repartir son cientos de
 * movimientos y confirmarlos uno por uno haría inviable la función, pero sigue
 * pidiendo permiso para todo lo demás. El bypass existe porque es la máquina
 * del usuario; lo que no puede es estar sin etiquetar.
 */
export const PERMS: Record<string, { id: string; flag: string; label: string; hint: string }[]> = {
  claude: [
    {
      id: "acceptEdits",
      flag: "--permission-mode acceptEdits",
      label: "Aceptar ediciones",
      hint: "Mueve y edita archivos sin preguntar. Para lo demás pide permiso.",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
      label: "No preguntar nada",
      hint: "Sin ninguna confirmación, para todo.",
    },
  ],
  antigravity: [
    {
      id: "acceptEdits",
      flag: "--mode=accept-edits",
      label: "Aceptar ediciones",
      hint: "Escribe archivos sin preguntar. Los comandos de shell se siguen deteniendo a pedir permiso.",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
      label: "No preguntar nada",
      hint: "Sin ninguna confirmación, para todo.",
    },
  ],
  opencode: [
    {
      id: "acceptEdits",
      flag: "--yes",
      label: "Aceptar ediciones",
      hint: "Acepta los cambios automáticamente.",
    },
    {
      id: "bypass",
      flag: "--dangerously-skip-permissions",
      label: "No preguntar nada",
      hint: "Sin ninguna confirmación, para todo.",
    },
  ],
};

/**
 * `agy` no acepta el prompt como argumento posicional: sin `-p` arranca la TUI
 * interactiva y se queda esperando, ignorando el texto — por eso no mandaba
 * nada. `-p` (alias `--print`/`--prompt`) es su modo headless: corre una vez,
 * imprime a stdout y termina solo. https://antigravity.google/docs/cli/headless
 *
 * `claude` sí toma el prompt posicional como primer mensaje de una sesión
 * interactiva, que es lo que la terminal incrustada espera (se puede seguir
 * escribiendo después). `agy` en cambio no se queda a escuchar más una vez que
 * termina — es un solo tiro, no una conversación.
 */
export function agentCommand(agent: string, model: string, perm: string, skill = "/vault-ingest"): string {
  const binary = agent === "antigravity" ? "agy" : agent === "opencode" ? "opencode" : "claude";
  const perms = PERMS[agent] || PERMS.claude;
  return [
    binary,
    model && `--model ${model}`,
    perms.find((p) => p.id === perm)?.flag,
    agent === "antigravity" ? `-p '${skill}'` : `'${skill}'`,
  ].filter(Boolean).join(" ");
}

/**
 * Los modelos a mostrar para `agent`: el catálogo en vivo si se pudo pedir
 * (por ahora solo `agy` lo ofrece — ver `src/agents.ts`), o si no la lista
 * fija de arriba.
 *
 * Se pide una sola vez por montaje — cambiar de agente y volver a Antigravity
 * no repite la llamada — y en silencio: si falla, no hay red, o `agy` no está
 * instalado, `models` sigue siendo la lista fija y no se nota más que en que
 * las opciones son menos específicas.
 */
export function useAgyModels(agent: string) {
  const [live, setLive] = useState<{ id: string; label: string }[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (agent !== "antigravity" || live || loading) return;
    setLoading(true);
    fetch("/api/agents/models?agent=antigravity")
      .then((r) => r.json())
      .then((d) => setLive(Array.isArray(d.models) && d.models.length ? d.models : null))
      .catch(() => setLive(null))
      .finally(() => setLoading(false));
  }, [agent, live, loading]);

  const fallback = MODELS[agent] || MODELS.claude;
  const models = agent === "antigravity" && live
    ? [fallback[0], ...live.map((m) => ({ ...m, hint: "Del catálogo en vivo de agy." }))]
    : fallback;

  return { models, loading: agent === "antigravity" && loading && !live };
}
