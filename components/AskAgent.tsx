"use client";
import type { AcpPromptResource } from "@/src/acp/wire.ts";
import { newChatId, openInWorkspace, rememberChatAgent } from "./Tabs.tsx";
import { useT } from "./I18n";
import { useDefaultAgent } from "./DefaultAgent.tsx";
import { runInNewChat } from "./AgentChat.tsx";

/**
 * Abrir un chat sobre esta nota, con el harness por omisión.
 *
 * Antes desplegaba el registro entero de agentes. Se quitó por lo mismo que se
 * quitó el selector de la barra superior (ver `AgentMenu`): elegir harness no
 * es parte de preguntar algo — se eligió una vez en el onboarding y se cambia
 * dentro del chat, sin perder la conversación. El menú además se recortaba
 * dentro del artículo, que es lo que hizo visible el problema de fondo:
 * un desplegable de siete opciones colgando de un botón que vive en cada nota.
 */
export default function AskAgent({
  label, prompt, getPrompt, resource,
}: {
  label: string;
  prompt?: string;
  getPrompt?: () => string;
  resource?: AcpPromptResource;
}) {
  const t = useT();
  const agent = useDefaultAgent();
  return <button className="newbtn askagent" type="button" onClick={() => {
    const id = newChatId();
    rememberChatAgent(id, agent);
    runInNewChat(id, getPrompt?.() ?? prompt ?? "", undefined, resource ? [resource] : undefined);
    openInWorkspace(id, t("chat.tabTitle"), true);
  }}>{label}</button>;
}
