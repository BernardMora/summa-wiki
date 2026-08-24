"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ACP_PRESETS, presetById } from "@/src/acp/presets.ts";

/**
 * El harness por omisión, repartido a los componentes de cliente.
 *
 * Lo elige el usuario en el onboarding (`settings.ai.agent`) y viaja por
 * contexto desde el layout raíz, igual que el idioma: el servidor ya lo sabe
 * al renderizar, y pedirlo por `fetch` desde el cliente significaría un primer
 * render con el harness equivocado — que en un chat no es cosmético, porque
 * ese render ya abre el WebSocket que arranca el proceso del agente.
 *
 * Existe para que "preguntarle a un agente" sea UNA acción y no una elección
 * repetida: la decisión de con quién se habla se toma una vez, en el
 * onboarding, y se cambia dentro del chat o volviendo a la configuración.
 */

/**
 * Con qué harness se habla cuando no hay ninguno elegido.
 *
 * El primero del registro, no una constante escrita aparte: poner un agente al
 * principio de `ACP_PRESETS` es la decisión de cuál es el principal, y tener
 * que acordarse de cambiar una segunda constante es cómo se acaba con un valor
 * por omisión que ya no existe.
 */
export const FALLBACK_AGENT = ACP_PRESETS[0]!.id;

interface DefaultAgent {
  agent: string;
  /** Persists the choice and updates every open chat, without a reload. */
  setAgent: (agent: string) => Promise<void>;
}

const Ctx = createContext<DefaultAgent>({ agent: FALLBACK_AGENT, setAgent: async () => {} });

/**
 * `agent` es lo que hay guardado en la máquina, tal cual: puede ser `null`
 * (el usuario siguió sin IA) o un id que ya no existe (Gemini CLI se quitó del
 * registro el 2026-08-21). Los dos casos se resuelven aquí, en un solo sitio,
 * para que nadie más tenga que preguntárselo.
 */
export function DefaultAgentProvider({ agent, children }: { agent: string | null; children: React.ReactNode }) {
  /*
   * The server value seeds state instead of being read on every render,
   * because this can now change WITHOUT a navigation: the star in the harness
   * menu writes it. Left as a plain prop, a chat opened after that change
   * would still open with the old default until the next full reload — the
   * setting would look like it had not taken.
   */
  const [current, setCurrent] = useState(() => (agent && presetById(agent) ? agent : FALLBACK_AGENT));

  const setAgent = useCallback(async (next: string) => {
    if (!presetById(next)) return;
    // Optimistic: the write is local (a file in the app's data dir), and a
    // star that waits on a round trip to fill in reads as a click that missed.
    setCurrent(next);
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: next }),
    }).catch(() => { /* Offline is not a case here; the server is local. */ });
  }, []);

  const value = useMemo(() => ({ agent: current, setAgent }), [current, setAgent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The harness a new chat opens with. */
export function useDefaultAgent(): string {
  return useContext(Ctx).agent;
}

/** Changes it, for the star in the harness menu. */
export function useSetDefaultAgent(): (agent: string) => Promise<void> {
  return useContext(Ctx).setAgent;
}
