import type { AcpPromptResource } from "@/src/acp/wire.ts";

export interface ChatTarget { id: string; title: string }

let lastFocused: string | null = null;
let workspace: { targets: () => ChatTarget[]; activate: (id: string) => void } | null = null;
const pending = new Map<string, {text?: string, resource?: AcpPromptResource}[]>();
const senders = new Map<string, (text?: string, resource?: AcpPromptResource) => boolean>();

export function markChatFocused(id: string) { lastFocused = id; }
export function lastFocusedChat() { return lastFocused; }

export function registerChatWorkspace(value: typeof workspace) {
  workspace = value;
  return () => { if (workspace === value) workspace = null; };
}

export function chatTargets() { return workspace?.targets() ?? []; }

export function registerChatSender(id: string, sender: (text?: string, resource?: AcpPromptResource) => boolean) {
  senders.set(id, sender);
  return () => { if (senders.get(id) === sender) senders.delete(id); };
}

export function queueChatInput(requestedId?: string, text?: string, resource?: AcpPromptResource) {
  const targets = chatTargets();
  const id = requestedId ?? (lastFocused && targets.some((target) => target.id === lastFocused) ? lastFocused : targets[0]?.id);
  if (!id) return false;
  if (senders.get(id)?.(text, resource)) {
    workspace?.activate(id);
    return true;
  }
  pending.set(id, [...(pending.get(id) ?? []), { text, resource }]);
  workspace?.activate(id);
  return true;
}

export function takeChatInput(id: string) {
  const values = pending.get(id) ?? [];
  pending.delete(id);
  return values;
}
