export interface TerminalTarget { id: string; title: string }

let lastFocused: string | null = null;
let workspace: { targets: () => TerminalTarget[]; activate: (id: string) => void } | null = null;
const pending = new Map<string, string[]>();
const senders = new Map<string, (text: string) => boolean>();

export function markTerminalFocused(id: string) { lastFocused = id; }
export function lastFocusedTerminal() { return lastFocused; }

export function registerTerminalWorkspace(value: typeof workspace) {
  workspace = value;
  return () => { if (workspace === value) workspace = null; };
}

export function terminalTargets() { return workspace?.targets() ?? []; }

export function registerTerminalSender(id: string, sender: (text: string) => boolean) {
  senders.set(id, sender);
  return () => { if (senders.get(id) === sender) senders.delete(id); };
}

/** Queue input and activate the terminal tab. TerminalPane flushes it once connected. */
export function queueTerminalInput(text: string, requestedId?: string) {
  const targets = terminalTargets();
  const id = requestedId ?? (lastFocused && targets.some((target) => target.id === lastFocused) ? lastFocused : null);
  if (!id) return false;
  if (senders.get(id)?.(text)) return true;
  pending.set(id, [...(pending.get(id) ?? []), text]);
  workspace?.activate(id);
  return true;
}

export function takeTerminalInput(id: string) {
  const values = pending.get(id) ?? [];
  pending.delete(id);
  return values;
}
