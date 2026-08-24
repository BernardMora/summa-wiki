"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Installation state for commands declared by the single ACP registry.
 *
 * `null` means "not known yet", not "missing". The probe starts a login shell
 * to see the user's real PATH, so the UI preserves that third state while the
 * probe runs.
 */
export function useInstalledAcpAgents(enabled = true) {
  const [agents, setAgents] = useState<Record<string, string | null> | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    fetch("/api/agents")
      .then((response) => response.json())
      .then((data) => setAgents(data.acpAgents ?? null))
      .catch(() => setAgents(null));
  }, [enabled]);

  const installed = (agent: string): boolean | null =>
    agents === null ? null : Boolean(agents[agent]);

  return { agents, installed };
}
