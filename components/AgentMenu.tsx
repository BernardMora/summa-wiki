"use client";
import { newChatId, openInWorkspace } from "./Tabs.tsx";
import { useT } from "./I18n";

/**
 * Iniciar una conversación con un agente desde la barra superior.
 *
 * The button immediately opens a new chat tab. The picker has been deprecated,
 * as the user will select or interact with the agent from within the chat window
 * directly.
 */
export default function AgentMenu() {
  const t = useT();

  function startChat() {
    const id = newChatId();
    openInWorkspace(id, t("chat.tabTitle"), true);
  }

  return (
    <div className="cfgwrap">
      <button
        className="themebtn"
        onClick={startChat}
        title={t("masthead.aiTitle")}
        aria-label={t("masthead.aiTitle")}
        data-tour="agent-menu"
      >
        {/* Filled straight-edged sparkles remain legible at this 13px size. */}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M6.2 1 L7.75 5.05 L11.8 6.6 L7.75 8.15 L6.2 12.2 L4.65 8.15 L0.6 6.6 L4.65 5.05 Z" />
          <path d="M12.7 9.6 L13.5 11.7 L15.6 12.5 L13.5 13.3 L12.7 15.4 L11.9 13.3 L9.8 12.5 L11.9 11.7 Z" />
        </svg>
      </button>
    </div>
  );
}
