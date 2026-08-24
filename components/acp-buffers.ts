export interface OpenNoteBuffer { id: string; content: string }
export interface AgentFileWrite extends OpenNoteBuffer { mtimeMs: number }

const buffers = new Map<string, string>();
const bufferListeners = new Set<(buffer: OpenNoteBuffer) => void>();
const writeListeners = new Set<(write: AgentFileWrite) => void>();

export function publishOpenNote(id: string, content: string) {
  buffers.set(id, content);
  const buffer = { id, content };
  bufferListeners.forEach((listener) => listener(buffer));
}

export function openNoteBuffers(): OpenNoteBuffer[] {
  return [...buffers].map(([id, content]) => ({ id, content }));
}

export function closeOpenNote(id: string) {
  buffers.delete(id);
}

export function subscribeOpenNotes(listener: (buffer: OpenNoteBuffer) => void) {
  bufferListeners.add(listener);
  return () => { bufferListeners.delete(listener); };
}

export function publishAgentFileWrite(write: AgentFileWrite) {
  buffers.set(write.id, write.content);
  writeListeners.forEach((listener) => listener(write));
}

export function subscribeAgentFileWrites(listener: (write: AgentFileWrite) => void) {
  writeListeners.add(listener);
  return () => { writeListeners.delete(listener); };
}
