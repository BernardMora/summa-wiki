"use client";
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from "react";
import { marked, type Token, type MarkedToken } from "marked";
import type * as acp from "@agentclientprotocol/sdk";
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
  MAX_CHAT_IMAGES,
  type AcpClientMessage,
  type AcpPromptImage,
  type AcpPromptResource,
  type AcpServerMessage,
} from "@/src/acp/wire.ts";
import { ACP_PRESETS, NODE_DOWNLOAD, installDocsUrl, presetById } from "@/src/acp/presets.ts";
import { chatAgentOf, chatSessionId, rememberChatAgent } from "./Tabs.tsx";
import { useDefaultAgent, useSetDefaultAgent } from "./DefaultAgent.tsx";
import { EMPTY, reduce, toRows, blockText, rawOutputText, type ChatItem, type ChatState, type ToolItem } from "./acp-transcript.ts";
import { useLocale, useT } from "./I18n";
import { openNoteBuffers, publishAgentFileWrite, subscribeOpenNotes } from "./acp-buffers.ts";
import { publishUiAction } from "./acp-ui.ts";
import { markChatFocused, registerChatSender, takeChatInput } from "./chatBridge.ts";

/**
 * La conversación con un agente, dentro de la app.
 *
 * Es lo que sustituye a la terminal incrustada como superficie principal. La
 * diferencia no es cosmética: por una pty llegaban secuencias ANSI de las que
 * había que ADIVINAR qué pasaba —si estaba pidiendo permiso, qué archivo tocó,
 * qué modelos tenía—, y aquí llega tipado. En concreto:
 *
 * - **El permiso es un diálogo de verdad.** El camino viejo pasaba banderas
 *   (`--dangerously-skip-permissions`, `--yes`) y esperaba que el CLI las
 *   respetara; opencode ignoraba la suya en silencio, así que la interfaz
 *   prometía no preguntar y preguntaba. Ahora el agente pide y la persona
 *   contesta, y no hay forma de que eso se desincronice.
 * - **Los modelos los anuncia el agente.** No hay ninguna tabla de modelos en
 *   esta app, así que no puede quedarse vieja. Ver `configOptions`.
 * - **Los diffs son protocolo**, no texto que haya que reconocer.
 *
 * La sesión NO vive aquí: vive en el servidor (`lib/acpSessions.ts`) y esta
 * conexión solo la mira. Cambiar de pestaña o recargar no interrumpe un turno.
 */

/**
 * Con qué harness abre un chat que no dice cuál quiere: el que el usuario
 * eligió en el onboarding. Vive en `components/DefaultAgent.tsx`, que también
 * resuelve el caso de que no eligiera ninguno.
 */

interface Props {
  /**
   * Id de la PESTAÑA. Estable, y no es lo mismo que la sesión: bajo una
   * pestaña hay una sesión por cada harness con el que se ha hablado
   * (`<pestaña>::<agente>`). Lo que se dirige a "este chat" —el prompt
   * pendiente, el bridge de `@menciones`, la × que lo cierra— se dirige a la
   * pestaña; lo que habla con UN agente usa la sesión.
   */
  tabId: string;
  /**
   * Fija el harness y esconde el selector.
   *
   * Lo usa el asistente de ingesta, que ya tiene su propio selector como paso
   * del asistente: dos selectores en pantalla contradiciéndose sería peor que
   * cualquiera de los dos. Ahí `tabId` ya identifica la sesión concreta.
   */
  agent?: string;
  /** Directorio de trabajo del agente. Por defecto, el vault del servidor. */
  cwd?: string;
  /** Optional first turn used by guided flows such as vault ingestion. */
  initialPrompt?: string;
  onTurnComplete?: () => void;
}

const PENDING_CHAT_KEY = "wiki.pendingChat";
const SENT_CHAT_KEY = "wiki.sentInitialChat";
interface PendingChat { prompt: string; cwd?: string; resources?: AcpPromptResource[] }

function promptImageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPromptImage(file: File): Promise<AcpPromptImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the pasted image"));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      const comma = url.indexOf(",");
      if (comma < 0) return reject(new Error("The pasted image did not produce a data URL"));
      resolve({
        id: promptImageId(),
        name: file.name || undefined,
        mimeType: file.type as AcpPromptImage["mimeType"],
        data: url.slice(comma + 1),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function promptImageSource(image: AcpPromptImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** Queue the first turn for a chat that may open after a full navigation. */
export function runInNewChat(id: string, prompt: string, cwd?: string, resources?: AcpPromptResource[]) {
  try {
    const all = JSON.parse(sessionStorage.getItem(PENDING_CHAT_KEY) || "{}") as Record<string, PendingChat>;
    all[id] = { prompt, ...(cwd ? { cwd } : {}), ...(resources?.length ? { resources } : {}) };
    sessionStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(all));
  } catch { /* Private browsing may deny storage; the chat still opens empty. */ }
}

function takePendingChat(id: string): PendingChat | null {
  try {
    const all = JSON.parse(sessionStorage.getItem(PENDING_CHAT_KEY) || "{}") as Record<string, PendingChat>;
    const pending = all[id] ?? null;
    delete all[id];
    sessionStorage.setItem(PENDING_CHAT_KEY, JSON.stringify(all));
    return pending;
  } catch { return null; }
}

function initialPromptWasSent(id: string): boolean {
  try {
    const sent = JSON.parse(sessionStorage.getItem(SENT_CHAT_KEY) || "[]") as string[];
    return sent.includes(id);
  } catch { return false; }
}

function rememberInitialPrompt(id: string) {
  try {
    const sent = JSON.parse(sessionStorage.getItem(SENT_CHAT_KEY) || "[]") as string[];
    if (!sent.includes(id)) sent.push(id);
    sessionStorage.setItem(SENT_CHAT_KEY, JSON.stringify(sent.slice(-100)));
  } catch { /* The in-memory guard still covers this mount. */ }
}

export default function AgentChat({ tabId, agent: forced, cwd, initialPrompt, onTurnComplete }: Props) {
  const t = useT();
  /**
   * El harness seleccionado.
   *
   * Se lee de `localStorage` en el inicializador y no en un efecto: leerlo
   * después dejaría un primer render con el harness por omisión, y ese render
   * ya abre un WebSocket — o sea, arranca un proceso de agente que nadie pidió
   * cada vez que se restaura una pestaña.
   */
  const fallbackAgent = useDefaultAgent();
  const [agent, setAgent] = useState(() => forced ?? chatAgentOf(tabId, fallbackAgent));

  /**
   * La conversación con ESTE harness. Cambiar de harness cambia el id, así que
   * el efecto del socket se vuelve a correr y engancha la otra conversación —
   * que sigue viva en el servidor, con su turno a medias si lo tenía.
   */
  const id = forced ? tabId : chatSessionId(tabId, agent);

  const [state, setState] = useState<ChatState>(EMPTY);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<AcpPromptImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pending] = useState(() => takePendingChat(tabId));
  const [resources, setResources] = useState<AcpPromptResource[]>(() => pending?.resources ?? []);
  const firstPrompt = initialPrompt ?? pending?.prompt;
  const workingDirectory = cwd ?? pending?.cwd;
  const socket = useRef<WebSocket | null>(null);
  const draftHighlight = useRef<HTMLDivElement | null>(null);
  const initialSent = useRef(initialPromptWasSent(tabId));

  useEffect(() => {
    return registerChatSender(tabId, (text, resource) => {
      if (text) setDraft((d) => d + text);
      if (resource) {
        setResources((current) => current.some((item) => item.id === resource.id) ? current : [...current, resource]);
        setDraft((current) => `${current}@${resource.title} `);
      }
      return true;
    });
  }, [tabId]);

  useEffect(() => {
    const queued = takeChatInput(tabId);
    if (queued.length > 0) {
      setDraft((d) => d + queued.map((q) => q.text || "").join("") + queued.filter((q) => q.resource).map((q) => `@${q.resource!.title} `).join(""));
      setResources((current) => {
        let next = [...current];
        for (const q of queued) {
          if (q.resource && !next.some((item) => item.id === q.resource!.id)) {
            next.push(q.resource);
          }
        }
        return next;
      });
    }
  }, [tabId]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Puerto principal + 1. Era +2 mientras la terminal integrada ocupaba el
    // +1; al retirarse (fase 6) el hueco no se deja. Ver server.ts.
    const port = Number(location.port || (location.protocol === "https:" ? 443 : 80)) + 1;
    const q = new URLSearchParams({ id, agent });
    if (workingDirectory) q.set("cwd", workingDirectory);
    const ws = new WebSocket(`${proto}//${location.hostname}:${port}/api/acp?${q}`);
    socket.current = ws;

    /*
     * El estado se reconstruye desde cero en cada conexión, incluida la
     * segunda que abre StrictMode en desarrollo. Es correcto porque el
     * servidor reproduce la conversación entera al conectarse y el pliegue es
     * puro: replegar N mensajes da el mismo estado que haberlos recibido en
     * vivo. Por eso esto no necesita el registro fuera de React que sí hacía
     * falta cuando lo que había detrás era una pty — ahí la doble conexión
     * abría dos shells de verdad; aquí las dos miran la misma sesión, que ya
     * existía.
     */
    setState(EMPTY);

    /*
     * Todo manejador comprueba que ESTE socket siga siendo el vigente.
     *
     * Sin la comprobación, el doble montaje de StrictMode dejaba el chat
     * muerto nada más abrirlo: el efecto 1 se limpia y cierra su socket, pero
     * su `onclose` llega DESPUÉS de que el efecto 2 haya montado el suyo, y
     * escribía `status: "closed"` sobre el estado del segundo. En pantalla:
     * el agente contestaba `initialize`, se veía su nombre y su consumo de
     * contexto, y la caja de escribir estaba deshabilitada. No es un problema
     * solo de desarrollo — pasa igual cada vez que el efecto se vuelve a
     * correr, o sea al cambiar de agente o de directorio.
     */
    const live = () => socket.current === ws;
    ws.onmessage = (e) => {
      if (!live()) return;
      const message = JSON.parse(e.data as string) as AcpServerMessage;
      if (message.t === "file-written") publishAgentFileWrite(message);
      if (message.t === "ui") publishUiAction(message.action);
      setState((prev) => reduce(prev, message));
    };
    ws.onclose = () => {
      if (!live()) return;
      setState((prev) => (prev.status === "failed" ? prev : { ...prev, status: "closed" }));
    };

    const sendBuffer = (buffer: { id: string; content: string }) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "buffer", ...buffer } satisfies AcpClientMessage));
    };
    ws.onopen = () => openNoteBuffers().forEach(sendBuffer);
    const unsubscribe = subscribeOpenNotes(sendBuffer);
    return () => { unsubscribe(); if (socket.current === ws) socket.current = null; ws.close(); };
  }, [id, agent, workingDirectory]);

  const send = useCallback((message: AcpClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === ws?.OPEN) ws?.send(JSON.stringify(message));
  }, []);

  const submit = useCallback(() => {
    const text = draft.trim();
    if ((!text && !images.length) || state.status !== "ready" || (images.length > 0 && !state.imageInput)) return;
    send({ t: "prompt", text, resources, images });
    setDraft("");
    setResources([]);
    setImages([]);
    setImageError(null);
  }, [draft, images, resources, state.imageInput, state.status, send]);

  const addPastedImages = useCallback(async (files: File[]) => {
    setImageError(null);
    if (state.status !== "starting" && !state.imageInput) {
      setImageError(t("chat.imagesUnsupported"));
      return;
    }

    const accepted: File[] = [];
    let nextCount = images.length;
    let nextBytes = images.reduce((sum, image) => sum + image.size, 0);
    let error: string | null = null;

    for (const file of files) {
      if (!CHAT_IMAGE_MIME_TYPES.has(file.type)) {
        error ??= t("chat.imageUnsupportedFormat");
        continue;
      }
      if (file.size > MAX_CHAT_IMAGE_BYTES) {
        error ??= t("chat.imageTooLarge", { max: String(MAX_CHAT_IMAGE_BYTES / 1024 / 1024) });
        continue;
      }
      if (nextCount >= MAX_CHAT_IMAGES) {
        error ??= t("chat.imageTooMany", { max: String(MAX_CHAT_IMAGES) });
        continue;
      }
      if (nextBytes + file.size > MAX_CHAT_IMAGE_TOTAL_BYTES) {
        error ??= t("chat.imagesTooLarge", { max: String(MAX_CHAT_IMAGE_TOTAL_BYTES / 1024 / 1024) });
        continue;
      }
      accepted.push(file);
      nextCount += 1;
      nextBytes += file.size;
    }

    try {
      const loaded = await Promise.all(accepted.map(readPromptImage));
      if (loaded.length) setImages((current) => [...current, ...loaded]);
    } catch {
      error ??= t("chat.imageReadFailed");
    }
    setImageError(error);
  }, [images, state.imageInput, state.status, t]);

  const pasteImages = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    void addPastedImages(files);
  }, [addPastedImages]);

  useEffect(() => {
    if (!firstPrompt || initialSent.current || state.status !== "ready") return;
    initialSent.current = true;
    rememberInitialPrompt(tabId);
    send({ t: "prompt", text: firstPrompt, resources });
    setResources([]);
  }, [firstPrompt, id, state.status, send]);

  useEffect(() => {
    if (state.stopReason) onTurnComplete?.();
  }, [state.stopReason, onTurnComplete]);

  return (
    <div className="chat" data-tour="agent-chat" onFocus={() => markChatFocused(tabId)} onClick={() => markChatFocused(tabId)}>
      <Transcript
        state={state}
        agent={agent}
        onRetry={(viaNpx) => send({ t: "retry", viaNpx })}
        onAuthenticate={(methodId) => send({ t: "authenticate", methodId })}
        onLaunchAuth={(methodId) => send({ t: "auth-launch", methodId })}
      />

      {state.permission && (
        <PermissionDialog
          request={state.permission.request}
          onPick={(optionId) => send({ t: "permission", requestId: state.permission!.requestId, optionId })}
        />
      )}

      {/*
        * Los comandos que el agente anuncia, que hasta ahora se guardaban y no
        * se pintaban en ningún sitio. Es la mitad de lo que la TUI de Hermes
        * enseña de arranque —`/model`, `/tools`, `/context`, `/compress`— y sin
        * esto no había forma de saber que existían, ni de usarlos.
        */}
      <Commands
        commands={state.commands}
        draft={draft}
        onPick={(name) => setDraft(`/${name} `)}
      />

      <Mentions
        draft={draft}
        selected={resources}
        onPick={(resource, from, to) => {
          setDraft((current) => `${current.slice(0, from)}@${resource.title} ${current.slice(to)}`);
          setResources((current) => current.some((item) => item.id === resource.id) ? current : [...current, resource]);
        }}
      />

      <div className="chatbox">
        {/*
          * El botón de mandar vive DENTRO del campo, no al lado: la caja crece
          * con el texto, y un botón hermano se quedaba anclado abajo mientras
          * el campo subía. Por eso `.chatcomposer` envuelve a los dos.
          */}
        <div className="chatcomposer">
        {images.length > 0 && (
          <div className="chatattachments" aria-label={t("chat.attachedImages")}>
            {images.map((image, index) => (
              <figure key={image.id} className="chatattachment">
                <img src={promptImageSource(image)} alt={t("chat.imageAttachment", { n: String(index + 1) })} />
                <button
                  type="button"
                  title={t("chat.removeImage")}
                  aria-label={t("chat.removeImage")}
                  onClick={() => {
                    setImages((current) => current.filter((candidate) => candidate.id !== image.id));
                    setImageError(null);
                  }}
                >×</button>
              </figure>
            ))}
          </div>
        )}
        {imageError && <p className="chatattachmenterror" role="alert">{imageError}</p>}
        <div className="chatinput">
          <div ref={draftHighlight} className="chatinputhighlight" aria-hidden="true"><HighlightMentions text={draft} /></div>
          <textarea
            value={draft}
            placeholder={state.status === "starting" ? t("chat.starting") : t("chat.placeholder")}
            disabled={["auth", "authenticating", "failed", "closed"].includes(state.status)}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={pasteImages}
            onScroll={(e) => {
              if (draftHighlight.current) draftHighlight.current.scrollTop = e.currentTarget.scrollTop;
            }}
            /*
             * Enter manda; Shift+Enter parte la línea. Es la convención de
             * cualquier chat, y aquí además no hay ambigüedad — a diferencia de
             * la terminal, donde qué byte mandar dependía del proceso que
             * estuviera al frente y hubo que decidirlo en el servidor.
            */
            onKeyDown={(e) => {
              // An open completion picker owns Enter, Tab, and ↑/↓.
              if (e.defaultPrevented) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />
        </div>
        {/*
          * The settings live INSIDE the field, under the text, and there is no
          * bar at the top any more. Two reasons, and neither is fashion:
          *
          * - Everything on that bar answers a question you ask WHILE writing
          *   the prompt — which harness, which model, how much effort, how
          *   much context is left. At the top it sat as far from the caret as
          *   the panel allows, and you had to leave what you were typing to
          *   reach it.
          * - It was the only thing between the tab strip and the transcript.
          *   Gone, the conversation starts at the edge of the pane, which is
          *   the only element on screen that is worth that space.
          *
          * Send moved down with them and stopped being absolutely positioned.
          * It used to be pinned to the bottom right of the composer so it
          * would not strand itself as the field grew; with a settings row now
          * occupying that corner, the pin would have put it ON TOP of the
          * harness picker. In the row it is a sibling of what it sits beside,
          * which is what it should have been once there was a row to join.
          */}
        <div className="chatfoot">
          <ChatBar
            state={state}
            agent={agent}
            // Sin selector cuando alguien fijó el harness desde fuera: ver `Props`.
            onAgent={forced ? undefined : (next) => {
              if (next === agent) return;
              rememberChatAgent(tabId, next);
              setAgent(next);
            }}
            onConfig={(configId, value) => send({ t: "config", configId, value })}
            onList={() => send({ t: "sessions" })}
            onLoad={(sessionId) => send({ t: "load", sessionId })}
          />
          {state.status === "busy" ? (
            <button className="chatsend danger" title={t("chat.stop")} onClick={() => send({ t: "cancel" })}>
              <span aria-hidden="true">■</span><span className="sr">{t("chat.stop")}</span>
            </button>
          ) : (
            <button
              className="chatsend"
              title={t("chat.send")}
              disabled={state.status !== "ready" || (!draft.trim() && !images.length) || (images.length > 0 && !state.imageInput)}
              onClick={submit}
            >
              <span aria-hidden="true">↑</span><span className="sr">{t("chat.send")}</span>
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

/** Textarea glyphs are transparent; this mirrored layer colors just `@`. */
function HighlightMentions({ text }: { text: string }) {
  return <>{text.split(/(@)/).map((part, index) =>
    part === "@" ? <span key={index} className="mentionat">@</span> : part,
  )}</>;
}

function Mentions({
  draft, selected, onPick,
}: {
  draft: string;
  selected: AcpPromptResource[];
  onPick: (resource: AcpPromptResource, from: number, to: number) => void;
}) {
  const [notes, setNotes] = useState<AcpPromptResource[]>([]);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  useEffect(() => {
    if (!match || notes.length) return;
    fetch("/api/index").then((response) => response.json()).then((data) => {
      setNotes((data.notes ?? []).map((note: { id: string; title: string; path: string }) => ({
        id: note.id, title: note.title, path: note.path,
      })));
    }).catch(() => {});
  }, [Boolean(match), notes.length]);
  if (!match) return selected.length ? <div className="chatmentions">{selected.map((item) => <span key={item.id}><span className="mentionat">@</span>{item.title}</span>)}</div> : null;
  const query = match[1]!.toLowerCase();
  const shown = notes.filter((note) => `${note.title} ${note.path}`.toLowerCase().includes(query)).slice(0, 8);
  const at = match.index + match[0].lastIndexOf("@");
  return <ScrollPicker
    className="chatmentionpicker"
    items={shown}
    onPick={(note) => onPick(note, at, draft.length)}
    renderItem={(note, active) => <button key={note.id} className={active ? "active" : undefined}>
      <strong>{note.title}</strong><span className="dim">{note.path}</span>
    </button>}
  />;
}

/**
 * Completion picker controlled from the text field: ↑/↓ moves; Enter or Tab picks.
 * The list itself retains native wheel/trackpad scrolling and mouse clicks.
 */
function ScrollPicker<T,>({ items, onPick, renderItem, className = "" }: {
  items: readonly T[];
  onPick: (item: T) => void;
  renderItem: (item: T, active: boolean) => ReactNode;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => setActive((current) => Math.min(current, items.length - 1)), [items.length]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        onPick(items[active]!);
      }
    };
    // Capture runs before the textarea's submit handler; see `onKeyDown`.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, items, onPick]);
  useEffect(() => {
    list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return <div ref={list} className={`chatcmds ${className}`} role="listbox">
    {items.map((item, index) => <span key={index} onMouseEnter={() => setActive(index)} onClick={() => onPick(item)}>
      {renderItem(item, index === active)}
    </span>)}
  </div>;
}

/**
 * La barra de arriba: quién contesta, con qué opciones, y cuánto contexto queda.
 *
 * ## El selector de harness
 *
 * Es lo primero de la barra porque es lo que manda: qué modelos hay, qué
 * comandos existen y qué permisos se piden son consecuencias de quién
 * contesta. Antes el harness se elegía ANTES de abrir el chat y quedaba fijo,
 * así que comparar dos harnesses sobre la misma pregunta significaba dos
 * pestañas y volver a escribirla.
 *
 * Cambiarlo **no pierde nada**: cada harness tiene su propia conversación viva
 * debajo de la misma pestaña, y volver a uno lo encuentra donde se dejó,
 * incluso con un turno a medias. Por eso es un desplegable y no un diálogo que
 * avise de que se va a perder el hilo.
 *
 * ## Los modelos
 *
 * Salen de `configOptions`, que los anuncia el agente: no hay ninguna tabla de
 * modelos en esta app y por eso no puede quedarse vieja. Cuando el agente **no
 * anuncia ninguna opción** aquí no aparece nada, y eso es un caso real, no un
 * hueco — dice la verdad, que ese ajuste no se hace desde aquí.
 */
function ChatBar({ state, agent, onAgent, onConfig, onList, onLoad }: {
  state: ChatState;
  agent: string;
  /** `undefined` esconde el selector: el harness lo fijó quien monta el chat. */
  onAgent?: (agent: string) => void;
  onConfig: (id: string, value: string | boolean) => void;
  onList: () => void;
  onLoad: (sessionId: string) => void;
}) {
  const t = useT();
  return (
    <div className="chatbar">
      {onAgent ? (
        <HarnessPicker agent={agent} onAgent={onAgent} detail={state.agentDetail} />
      ) : (
        <strong title={state.agentDetail}>{state.agentName || t("chat.connecting")}</strong>
      )}

      {/*
        * Junto al selector de harness porque la pregunta es la misma —con
        * quién estoy hablando— en su versión temporal: qué agente, y cuál de
        * sus conversaciones. Separarlos obligaría a buscar en dos sitios lo
        * que se decide de una vez.
        */}
      {state.canList && <HistoryPicker state={state} onList={onList} onLoad={onLoad} />}

      {state.configOptions.map((option) => (
        <label key={option.id} className="chatopt">
          <span>{option.name}</span>
          {option.type === "boolean" ? (
            <input type="checkbox" checked={option.currentValue}
                   onChange={(e) => onConfig(option.id, e.target.checked)} />
          ) : (
            <select value={option.currentValue} onChange={(e) => onConfig(option.id, e.target.value)}>
              <ConfigOptions options={option.options} />
            </select>
          )}
        </label>
      ))}

      {/*
        * El modelo, como TEXTO y no como desplegable, cuando el agente solo lo
        * dice por la API vieja. Hermes anuncia doce y contesta «Method not
        * found» a `session/select_model`: un control para elegirlos sería una
        * mentira con forma de botón. Se cambia con su propio `/model`, que es
        * lo que dice el `title`.
        */}
      {state.model && (
        <span className="chatmodel" title={t("chat.modelViaCommand")}>{state.model.label}</span>
      )}

      {/*
        * Contexto y coste de ESTA sesión.
        *
        * Los dos llegan tipados en `usage_update`, así que no hay que
        * deducirlos de ningún texto. El coste se pintaba y se tiraba: el
        * adaptador de Claude Code manda `cost: { amount, currency }` en cada
        * actualización y aquí solo se usaba `used`/`size`.
        *
        * Es además la mitad de lo que la TUI de Claude Code enseña en su panel
        * de `/usage` y que su salida de texto —la que recibe un cliente ACP—
        * NO trae: ahí no hay coste de sesión por ningún lado. Ver
        * `docs/acp-migration.md`.
        */}
      {state.usage && (
        <span className="dim chatusage">
          {t("chat.context", { pct: String(Math.round((state.usage.used / Math.max(state.usage.size, 1)) * 100)) })}
          {state.usage.cost && ` · ${formatCost(state.usage.cost)}`}
        </span>
      )}
    </div>
  );
}

/**
 * Cuándo pasó, en una palabra.
 *
 * Relativo y no una fecha porque la lista se lee para reconocer, no para
 * fechar: «hace 2 h» sitúa una conversación en la sesión de trabajo de hoy,
 * mientras que «2026-08-23 18:40» obliga a restarle la hora actual. Pasada la
 * semana se invierte —ya no hay nada que reconocer— y se enseña la fecha.
 */
function whenLabel(iso: string, locale: string, t: ReturnType<typeof useT>): string {
  const at = Date.parse(iso);
  if (!iso || Number.isNaN(at)) return "";
  const minutes = Math.round((Date.now() - at) / 60_000);
  const plural = (key: "chat.minutesAgo" | "chat.hoursAgo" | "chat.daysAgo", n: number) =>
    t(`${key}.${n === 1 ? "one" : "other"}` as Parameters<typeof t>[0], { n: String(n) });
  if (minutes < 1) return t("chat.justNow");
  if (minutes < 60) return plural("chat.minutesAgo", minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural("chat.hoursAgo", hours);
  const days = Math.round(hours / 24);
  if (days <= 7) return plural("chat.daysAgo", days);
  return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/**
 * Las conversaciones anteriores de este agente, para volver a una.
 *
 * ## De dónde sale la lista
 *
 * Del agente, por `session/list`. Summa no lleva su propio registro de
 * conversaciones, y esa es la decisión que da forma a todo lo demás: lo que se
 * ve aquí es lo que el harness tiene, incluidas las conversaciones que nacieron
 * en su CLI y no en esta app, y sin nada que se pueda quedar desfasado cuando
 * alguien borre una por fuera. Ver `AcpSession.listSessions`.
 *
 * Cada harness tiene las suyas: la pregunta se le hace al proceso que está
 * conectado, así que cambiar de harness cambia la lista sin que aquí haya que
 * filtrar por nada.
 *
 * ## Por qué se pide al abrir y no al montarse
 *
 * Un panel de chat se monta al restaurar una pestaña, y pedir la lista ahí
 * gastaría una petición por cada pestaña de cada ventana en cada arranque,
 * para una lista que casi nunca se mira. Se pide al abrir el menú, y se vuelve
 * a pedir cada vez: es la clase de dato que cambia solo — el propio agente crea
 * conversaciones desde su CLI mientras la app está abierta.
 */
function HistoryPicker({ state, onList, onLoad }: {
  state: ChatState;
  onList: () => void;
  onLoad: (sessionId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const menu = useRef<HTMLDetailsElement>(null);
  const sessions = state.sessions;

  return (
    <details
      ref={menu}
      className="harnesspicker historypicker"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onList(); }}
    >
      <summary title={t("chat.history")} aria-label={t("chat.history")}>
        <span aria-hidden="true" className="historyglyph">◷</span>
        <span className="historylabel">{t("chat.history")}</span>
      </summary>
      <div className="harnessmenu historymenu" role="listbox" aria-label={t("chat.history")}>
        {/*
          * Tres estados y no dos. `null` es «todavía no ha contestado» y se
          * dice así; una lista vacía de verdad merece su propia frase. Con un
          * solo caso, el viaje de ida y vuelta se vería como «no hay ninguna»,
          * que es la respuesta contraria dicha con seguridad.
          */}
        {sessions === null ? (
          <p className="harnesshint">{t("chat.historyLoading")}</p>
        ) : sessions.length === 0 ? (
          <p className="harnesshint">{t("chat.historyEmpty")}</p>
        ) : (
          <div className="historylist">
            {sessions.map((conversation) => (
              <button
                key={conversation.sessionId}
                type="button"
                role="option"
                aria-selected={false}
                title={conversation.title || conversation.sessionId}
                onClick={() => { onLoad(conversation.sessionId); menu.current?.removeAttribute("open"); }}
              >
                {/* Sin título, el id: es feo y es cierto, y deja la fila pulsable. */}
                <span className="historytitle">{conversation.title || conversation.sessionId}</span>
                <span className="historywhen">{whenLabel(conversation.updatedAt, locale, t)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="harnesshint">{t("chat.historyHint")}</p>
      </div>
    </details>
  );
}

/**
 * Native selects do not consistently allow images inside their options. This
 * compact menu keeps the familiar selector behavior while making each bundled
 * harness logo visible.
 */
function HarnessPicker({ agent, onAgent, detail }: {
  agent: string;
  onAgent: (agent: string) => void;
  detail?: string;
}) {
  const t = useT();
  const selected = presetById(agent) ?? ACP_PRESETS[0]!;
  const fallback = useDefaultAgent();
  const setDefault = useSetDefaultAgent();
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={menu} className="harnesspicker">
      <summary title={detail} aria-label={`Select harness: ${selected.name}`}>
        <img src={selected.logo} alt="" className="harnesslogo" />
        <span>{selected.name}</span>
        {/*
          * Drawn rather than typed. The character it replaces could not be
          * centred or rotated without moving; see `.harnesschev` in
          * `globals.css` for why this one neither rotates nor needs to.
          */}
        <svg className="harnesschev" viewBox="0 0 9 13" aria-hidden="true" focusable="false">
          <path d="M1.6 5.2 4.5 2.3l2.9 2.9M1.6 7.8l2.9 2.9 2.9-2.9"
                fill="none" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="harnessmenu" role="listbox" aria-label="Harnesses">
        {ACP_PRESETS.map((preset) => {
          const isDefault = preset.id === fallback;
          return (
            <div key={preset.id} className="harnessrow">
              <button
                type="button"
                role="option"
                aria-selected={preset.id === agent}
                className={preset.id === agent ? "selected" : undefined}
                onClick={() => { onAgent(preset.id); menu.current?.removeAttribute("open"); }}
              >
                <img src={preset.logo} alt="" className="harnesslogo" />
                <span>{preset.name}</span>
              </button>
              {/*
                * The star sets the default WITHOUT switching this tab to that
                * harness, which is why it is a control of its own and not a
                * side effect of picking. The two are genuinely different
                * questions — "talk to this one now" and "open new chats with
                * this one" — and tying them together would mean you could not
                * try a harness once without adopting it, nor adopt one
                * without abandoning the conversation you are in.
                *
                * The current default is not a button: pressing it would have
                * nothing to do, and an unsetting toggle would leave the app
                * with NO default. There is always one.
                */}
              {isDefault ? (
                <span className="harnessstar on" title={t("chat.isDefaultHarness")} aria-label={t("chat.isDefaultHarness")}>★</span>
              ) : (
                <button
                  type="button"
                  className="harnessstar"
                  title={t("chat.makeDefaultHarness", { name: preset.name })}
                  aria-label={t("chat.makeDefaultHarness", { name: preset.name })}
                  onClick={(e) => { e.stopPropagation(); void setDefault(preset.id); }}
                >☆</button>
              )}
            </div>
          );
        })}
        <p className="harnesshint">{t("chat.defaultHarnessHint")}</p>
      </div>
    </details>
  );
}

/**
 * El coste de la sesión, en su moneda.
 *
 * Cuatro decimales por debajo de un centavo y dos por encima: un turno corto
 * cuesta $0.0021 y redondearlo a dos decimales lo enseña como `$0.00`, que se
 * lee como «gratis» en vez de como «poco». Es exactamente lo que hace la TUI
 * de Claude Code en su desglose por modelo.
 *
 * `Intl` y no un `$` a mano porque `currency` viene del agente y no tiene por
 * qué ser USD.
 */
function formatCost(cost: { amount: number; currency: string }): string {
  const digits = cost.amount > 0 && cost.amount < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: cost.currency,
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(cost.amount);
  } catch {
    // Una moneda que Intl no conoce no puede tumbar la barra entera.
    return `${cost.amount.toFixed(digits)} ${cost.currency}`;
  }
}

/**
 * Las opciones de un desplegable, planas o agrupadas.
 *
 * Las dos formas son válidas en el esquema y las dos aparecen en la práctica:
 * OpenCode anuncia 364 modelos, que sin agrupar por proveedor son una lista
 * imposible de recorrer.
 */
function ConfigOptions({ options }: { options: acp.SessionConfigSelectOptions }) {
  const grouped = options.length > 0 && "group" in options[0]!;
  if (!grouped) {
    return <>{(options as acp.SessionConfigSelectOption[]).map((o) => (
      <option key={o.value} value={o.value}>{o.name}</option>
    ))}</>;
  }
  return <>{(options as acp.SessionConfigSelectGroup[]).map((g) => (
    <optgroup key={g.group} label={g.name}>
      {g.options.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
    </optgroup>
  ))}</>;
}

/** La conversación, con auto-scroll mientras el usuario esté mirando el final. */
function Transcript({
  state, agent, onRetry, onAuthenticate, onLaunchAuth,
}: {
  state: ChatState;
  agent: string;
  onRetry: (viaNpx: boolean) => void;
  onAuthenticate: (methodId: string) => void;
  onLaunchAuth: (methodId: string) => void;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  /*
   * Solo se baja solo si ya estabas abajo. Arrastrar la vista hacia arriba
   * para releer algo y que la respuesta que sigue llegando te devuelva al
   * final es de las cosas que hacen inservible un chat largo.
   */
  const pin = useCallback(() => {
    const el = host.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(pin, [state.items, state.terminals, pin]);

  /*
   * It also re-pins whenever A HEIGHT CHANGES, not only when a message
   * arrives. That was the missing half: the last paragraph came out clipped
   * with the scrollbar already at the end, because the final height landed
   * after the effect had run — a font finishing its load, a `<details>`
   * folding itself once the call settles, the permission dialog or the
   * command list appearing between the transcript and the composer, the
   * composer itself growing with the draft. None of those send a message, so
   * none of them used to bring the view back down.
   */
  useEffect(() => {
    const el = host.current;
    const inner = body.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => pin());
    ro.observe(el);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [pin]);

  return (
    <div
      className="chatscroll"
      ref={host}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div className="chatflow" ref={body}>
        {state.auth && (
          <div className="warnbox chatauth">
            <strong>{t(state.auth.required ? "chat.authRequired" : "chat.authAvailable")}</strong>
            <p>{state.auth.message}</p>
            <div className="cfgrow">
              {state.auth.methods.map((method) => {
                const terminal = "type" in method && method.type === "terminal";
                return (
                  <button
                    className="newbtn"
                    key={method.id}
                    disabled={state.status === "authenticating"}
                    title={method.description ?? undefined}
                    onClick={() => terminal ? onLaunchAuth(method.id) : onAuthenticate(method.id)}
                  >
                    {state.status === "authenticating" ? t("chat.authenticating") : method.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {state.manualAuth && (
          <ManualAuth
            manual={state.manualAuth}
            onReopen={() => onLaunchAuth(state.manualAuth!.methodId)}
            onDone={() => onRetry(false)}
          />
        )}
        {/*
          * Una conversación vacía tenía que decir algo. Con Hermes el panel se
          * quedaba en un título, un porcentaje de contexto y un desplegable de
          * diagnóstico sobre un vacío enorme — sin modelo que elegir, porque
          * Hermes no anuncia ninguno, y sin nada que explicara la ausencia. Se
          * veía averiado sin estarlo.
          */}
        {/*
          * Cargar una conversación deja el panel en `starting` con la lista
          * vacía —el mismo estado que arrancar— y sin esto se vería un panel
          * en blanco durante los dos segundos que el agente tarda en
          * reproducir trescientos mensajes. Decir qué está pasando es la
          * diferencia entre esperar y creer que el clic no llegó.
          */}
        {state.loading && !state.items.length && (
          <p className="chatempty">{t("chat.historyOpening")}</p>
        )}
        {!state.items.length && state.status !== "starting" && <Empty state={state} agent={agent} />}
        {toRows(state.items).map((row) => row.row === "tools"
          ? <ToolGroup key={row.key} items={row.items} terminals={state.terminals} />
          : <Item key={row.key} item={row.item} terminals={state.terminals} onRetry={onRetry} />)}
        {state.status === "busy" && <p className="dim chatwait">{t("chat.working")}</p>}
      </div>
    </div>
  );
}

/**
 * Iniciar sesión fuera de la app, porque el método es interactivo.
 *
 * El **comando es el mecanismo** y por eso ocupa el centro y se puede copiar;
 * abrir la terminal automáticamente es la comodidad, y puede no haber
 * funcionado. Al revés —un botón grande y el comando escondido— deja sin
 * salida a quien esté en un escritorio donde no se pudo abrir nada.
 *
 * No hay barra de progreso ni espera: la app no ve ese proceso, así que fingir
 * que lo vigila sería mentir. Lo dice la persona al volver.
 */
function ManualAuth({
  manual, onReopen, onDone,
}: {
  manual: { command: string; opened: boolean };
  onReopen: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(manual.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin permiso de portapapeles: el comando está a la vista para seleccionarlo */ }
  };

  return (
    <div className="warnbox chatmanualauth">
      <strong>{t(manual.opened ? "chat.authOpenedTerminal" : "chat.authRunThis")}</strong>
      <p>{t("chat.authManualHint")}</p>
      <code className="chatauthcmd">{manual.command}</code>
      <div className="cfgrow">
        <button className="newbtn" onClick={copy}>{t(copied ? "chat.authCopied" : "chat.authCopy")}</button>
        <button className="newbtn" onClick={onReopen}>{t("chat.authOpenTerminal")}</button>
        <button className="newbtn" onClick={onDone}>{t("chat.authDone")}</button>
      </div>
    </div>
  );
}

/**
 * Qué se ve antes del primer mensaje.
 *
 * La segunda línea solo aparece cuando el agente NO anuncia opciones y su
 * preset sabe dónde se configura. Es la diferencia entre «aquí falta algo» y
 * «esto se ajusta en otro sitio, y aquí está el comando»: la primera lectura
 * es la que invita a buscar un fallo que no existe.
 */
function Empty({ state, agent }: { state: ChatState; agent: string }) {
  const t = useT();
  const hint = state.configOptions.length ? undefined : presetById(agent)?.configHint;
  return (
    <div className="chatempty">
      <p>{t("chat.empty")}</p>
      {hint && <p className="cfghint">{t("chat.modelElsewhere", { command: hint })}</p>}
      {state.commands.length > 0 && (
        <p className="cfghint">{t("chat.slashHint", { n: String(state.commands.length) })}</p>
      )}
    </div>
  );
}

/**
 * El botón que lleva a la página de instalación del proveedor.
 *
 * Sigue siendo un `<a>` y no un `<button>` con `onClick`, aunque se vea como
 * un botón: así lo recoge el manejador de enlaces externos de Electron —que
 * pregunta antes de salir de la app y abre en el navegador del sistema, no en
 * una ventana sin barra de direcciones—, y así funcionan el clic con el botón
 * central y el «copiar enlace». Un `<button>` tendría que reimplementar las
 * tres cosas, y la del medio es la que importa.
 *
 * El rótulo NO lleva el nombre del agente a propósito. Para Antigravity la
 * página es la de Bun —lo que falta ahí es el intérprete, no el agente— y un
 * rótulo que dijera «instalar Antigravity» apuntando a `bun.sh` sería falso.
 * El `title` lleva la dirección, que es la respuesta exacta a «¿a dónde me
 * manda esto?» cuando no hay barra de estado que la enseñe.
 */
function InstallLink({ href }: { href: string }) {
  const t = useT();
  return (
    <a className="newbtn chatinstallgo" href={href} target="_blank" rel="noreferrer noopener" title={href}>
      {t("chat.installOfficial")} <span aria-hidden="true">↗</span>
    </a>
  );
}

/**
 * Qué se ve cuando el harness elegido no está instalado.
 *
 * Antes era una frase y un comando sueltos —«vibe-acp is not installed. Install
 * it with curl …»— y eso deja fuera las dos cosas que de verdad cuestan: que
 * ese comando se teclea en una terminal FUERA de la app, y que después se
 * vuelve aquí en vez de reiniciar nada. Un comando sin el sitio donde se pega
 * no es una instrucción, es un dato.
 *
 * De ahí la forma: tres pasos numerados, el comando en su propio bloque con
 * botón de copiar —el mismo trato que `ManualAuth` le da al comando de login,
 * porque es el mismo tipo de encargo— y un enlace a la documentación oficial,
 * que es a donde hay que ir cuando el script de instalación falla y la app ya
 * no puede ayudar.
 *
 * El nombre y el enlace se sacan del preset, no del mensaje de error: el
 * servidor manda el id y la tabla hace el resto. Ver `wire.ts`.
 */
function MissingAgent({
  item, onRetry,
}: { item: Extract<ChatItem, { kind: "error" }>; onRetry: (viaNpx: boolean) => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const preset = item.agent ? presetById(item.agent) : undefined;
  // Sin preset —un id que ya no está en la tabla— se cae al nombre del binario,
  // que siempre viene. Es peor rótulo, pero no deja el título vacío.
  const name = preset?.name ?? item.command ?? "";
  const command = item.command ?? "";

  const copy = async () => {
    if (!item.install) return;
    try {
      await navigator.clipboard.writeText(item.install);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin permiso de portapapeles: el comando está a la vista */ }
  };

  return (
    <div className="warnbox chaterror chatmissing">
      <strong>{t("chat.missingTitle", { name })}</strong>
      <p>{t("chat.missingLead", { command })}</p>

      {/*
        * Los pasos solo se enumeran cuando hay un comando que dar. Sin él —un
        * preset sin `install` y sin `npm`— una lista que empieza por «abre una
        * terminal» y no dice qué escribir sería peor que no tenerla.
        */}
      {item.install ? (
        <ol className="chatinstallsteps">
          <li>{t("chat.installStep1")}</li>
          <li>
            {t("chat.installStep2")}
            <code className="chatauthcmd">{item.install}</code>
            <button className="newbtn chatinstallcopy" onClick={copy}>
              {t(copied ? "chat.installCopied" : "chat.installCopy")}
            </button>
          </li>
          <li><Rich text={t("chat.installStep3")} /></li>
        </ol>
      ) : null}

      {/*
        * El atajo se ofrece SOLO cuando el adaptador viene de npm, y como un
        * botón que hay que pulsar. Detrás hay una descarga de la red la
        * primera vez, y una app que promete no llamar a ningún servicio no
        * puede hacer eso por su cuenta «para ahorrarle un paso» a nadie. El
        * rótulo dice lo que pasa; la letra pequeña, que solo la primera vez.
        */}
      <div className="cfgrow">
        {/*
          * «Reintentar» va PRIMERO porque es lo que hace todo el mundo:
          * instalarlo en una terminal y volver. Antes solo estaba el atajo de
          * npx, así que quien lo instalaba a mano se quedaba mirando un error
          * que ya no era cierto.
          */}
        <button className="newbtn" onClick={() => onRetry(false)}>{t("chat.tryAgain")}</button>
        {/*
          * La página oficial, al lado de «Reintentar» y no en letra pequeña al
          * final: es la otra mitad de lo que se puede hacer desde aquí. Quien
          * no quiera pegar un `curl` a ciegas —y es una postura razonable ante
          * un script que se descarga y se ejecuta— necesita esta salida tan a
          * mano como la rápida, no escondida bajo el resto del aviso.
          */}
        {preset && <InstallLink href={installDocsUrl(preset)} />}
        {item.npx && (
          <button className="newbtn" onClick={() => onRetry(true)}>
            {t("chat.runWithoutInstalling")}
          </button>
        )}
      </div>
      {item.npx && <p className="cfghint">{t("chat.npxHint", { command: item.npx })}</p>}

      {/*
        * El caso que el reintento no arregla y que parece un fallo de la app:
        * está instalado, pero en un PATH que un proceso lanzado desde el Dock
        * no hereda. Va al final porque solo se lee cuando lo de arriba falló.
        */}
      {/* `div` y no `p`: `Rich` pinta párrafos, y un `<p>` dentro de otro es
          HTML inválido — React lo deshace al hidratar y el aviso desaparece. */}
      <div className="cfghint"><Rich text={t("chat.installAlready")} /></div>
    </div>
  );
}

function Item({
  item, terminals, onRetry,
}: { item: ChatItem; terminals: Record<string, string>; onRetry: (viaNpx: boolean) => void }) {
  const t = useT();
  if (item.kind === "user") return (
    <div className="chatmsg chatuser">
      {item.images.length > 0 && (
        <div className="chatmessageimages">
          {item.images.map((image, index) => (
            <img
              key={image.id}
              src={promptImageSource(image)}
              alt={t("chat.imageAttachment", { n: String(index + 1) })}
            />
          ))}
        </div>
      )}
      {item.text && <Rich text={item.text} />}
    </div>
  );
  if (item.kind === "message") return <div className="chatmsg chatagent"><Rich text={item.text} /></div>;

  // El pensamiento llega como un evento APARTE del mensaje, así que se puede
  // plegar sin adivinar dónde empieza — no hay que reconocer ninguna marca.
  if (item.kind === "thought") {
    return (
      <details className="chatthought">
        <summary className="dim">{t("chat.thinking")}</summary>
        <Rich text={item.text} />
      </details>
    );
  }

  if (item.kind === "error") {
    /*
     * Falta el binario: el fallo más común y el único que la persona puede
     * arreglar sin salir de aquí. Tiene su propio componente porque necesita
     * estado —el acuse de «copiado»— y porque lo que hay que enseñar no es un
     * mensaje sino un procedimiento. Ver `MissingAgent`.
     */
    if (item.code === "agent-not-found") {
      return <MissingAgent item={item} onRetry={onRetry} />;
    }
    return (
      <div className="warnbox chaterror">
        {/*
          * El texto crudo del servidor solo se pinta cuando no hay código. El
          * servidor no sabe en qué idioma está la interfaz —vive en
          * `settings.json` y lo reparte el layout por contexto—, así que los
          * fallos que son NUESTROS viajan como código y se traducen aquí. Lo
          * que contesta el agente no se puede traducir y va tal cual.
          */}
        <strong>{t("chat.failed")}</strong>{" "}
        {item.code === "npx-not-found" ? t("chat.noNode") : item.message}
        {/* Node tampoco se instala desde aquí, pero sí se puede decir dónde. */}
        {item.code === "npx-not-found" && (
          <div className="cfgrow"><InstallLink href={NODE_DOWNLOAD} /></div>
        )}
      </div>
    );
  }

  if (item.kind === "plan") {
    return (
      <div className="chatplan">
        <strong className="dim">{t("chat.plan")}</strong>
        {item.markdown ? <Rich text={item.markdown} /> : (
          <ul>
            {item.entries.map((entry, i) => (
              <li key={i} data-status={entry.status}>{entry.content}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return <ToolCard call={item.call} terminals={terminals} />;
}

/**
 * How each tool kind is tallied in a run's summary line.
 *
 * The prefix is completed with `.one` or `.other` — the plural convention
 * `lib/i18n.ts` prescribes, rather than pulling ICU into the translator for
 * two branches.
 */
const TOOL_TALLY = {
  read: "chat.tally.read",
  edit: "chat.tally.edit",
  delete: "chat.tally.delete",
  move: "chat.tally.move",
  search: "chat.tally.search",
  execute: "chat.tally.execute",
  think: "chat.tally.think",
  fetch: "chat.tally.fetch",
  switch_mode: "chat.tally.switchMode",
  other: "chat.tally.other",
} as const;

/**
 * A run of consecutive calls, folded into one line.
 *
 * It starts CLOSED, while running too, and that is where it parts ways with a
 * lone card. One open card streams its output and costs what one card costs;
 * fifteen open at once are the answer pushed off screen, which is exactly what
 * the person wanted to read. What streams instead is the summary — the tallies
 * climb and the running call's title trails them — which answers "where is it
 * at?" while costing a line.
 *
 * Nothing auto-folds when the run settles, so the end of a turn can never
 * close something the person had just opened by hand.
 */
function ToolGroup({ items, terminals }: { items: ToolItem[]; terminals: Record<string, string> }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const active = items.find((i) => {
    const status = i.call.status ?? "pending";
    return status === "pending" || status === "in_progress";
  });
  const failed = items.some((i) => i.call.status === "failed");
  const status = active ? "in_progress" : failed ? "failed" : "completed";

  // Tallies in the order each kind first appeared: it reads as the story of
  // the turn rather than as a table sorted by something else.
  const tally = useMemo(() => {
    const counts = new Map<keyof typeof TOOL_TALLY, number>();
    for (const item of items) {
      const kind = (item.call.kind ?? "other") as keyof typeof TOOL_TALLY;
      const key = kind in TOOL_TALLY ? kind : "other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts].map(([kind, n]) =>
      t(`${TOOL_TALLY[kind]}.${n === 1 ? "one" : "other"}` as Parameters<typeof t>[0], { n: String(n) }));
    const line = parts.join(", ");
    return line.charAt(0).toUpperCase() + line.slice(1);
  }, [items, t]);

  return (
    <details
      className="chattoolgroup"
      data-status={status}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="chattoolhead">
        <span className="chattallytext">{tally}</span>
        {active && <span className="chattallynow">{active.call.title}</span>}
        <span className="chattoolkind">{items.length}</span>
        <DisclosureChevron />
      </summary>
      <div className="chattoolgroupbody">
        {items.map((item) => <ToolCard key={item.key} call={item.call} terminals={terminals} />)}
      </div>
    </details>
  );
}

/** Cada llamada a herramienta, con lo que produjo. */
function ToolCard({ call, terminals }: { call: acp.ToolCall; terminals: Record<string, string> }) {
  const status = call.status ?? "pending";
  const hasBody =
    (call.content ?? []).length > 0 || Boolean(rawOutputText(call.rawOutput));
  // Collapsed once the call settles: a finished command's output should not
  // push the conversation out of view. While it runs (pending/in_progress) the
  // card stays open so the output streams in sight. The user can still toggle
  // either way — `open` seeds the initial state and follows status changes,
  // and `onToggle` lets a manual click override it.
  const running = status === "pending" || status === "in_progress";
  const [open, setOpen] = useState(running);
  const settled = useRef(false);
  useEffect(() => {
    // Auto-collapse exactly once, on the transition to a settled state, so a
    // later manual re-open is not clobbered on the next render.
    if (!running && !settled.current) {
      settled.current = true;
      setOpen(false);
    }
    if (running) settled.current = false;
  }, [running]);

  if (!hasBody) {
    // Nothing to expand: render the head alone, not an empty disclosure.
    return (
      <div className="chattool" data-status={status} data-kind={call.kind ?? "other"}>
        <div className="chattoolhead">
          <span className="chattoolkind">{call.kind ?? "other"}</span>
          <span>{call.title}</span>
        </div>
      </div>
    );
  }

  return (
    <details
      className="chattool"
      data-status={status}
      data-kind={call.kind ?? "other"}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="chattoolhead">
        <span className="chattoolkind">{call.kind ?? "other"}</span>
        <span>{call.title}</span>
        <DisclosureChevron />
      </summary>
      {(call.content ?? []).map((content, i) => (
        <ToolContent key={i} content={content} terminals={terminals} />
      ))}
      {/*
        * Respaldo para las herramientas que no mandan `content`. Ver
        * `rawOutputText`: el adaptador de Codex deja ahí la salida de sus
        * comandos, y sin esto su tarjeta sale vacía. Plegado, porque no es la
        * ruta que el protocolo define y su forma no está garantizada.
        */}
      {!(call.content ?? []).length && <RawOutput rawOutput={call.rawOutput} />}
    </details>
  );
}

/** A geometrically centered disclosure mark that rotates without shifting. */
function DisclosureChevron() {
  return (
    <span className="chatdisclosure" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <path d="m4.25 6.25 3.75 3.5 3.75-3.5" />
      </svg>
    </span>
  );
}

function RawOutput({ rawOutput }: { rawOutput: unknown }) {
  const t = useT();
  const text = rawOutputText(rawOutput);
  if (!text) return null;
  return (
    <details className="chatraw">
      <summary className="dim">{t("chat.rawOutput")}</summary>
      <pre className="chatterm">{text}</pre>
    </details>
  );
}

/**
 * Las tres formas en que una herramienta puede producir salida. **Se pintan
 * las tres**, y esa es una decisión, no exhaustividad por costumbre:
 *
 * - `content` — el agente ejecutó por su cuenta y cuenta el resultado. El
 *   cliente de referencia (`obsidian-agent-client`) descarta esta variante; en
 *   una app donde el agente lo elige el usuario, descartarla significa que
 *   según con quién hables ves la salida o no ves nada.
 * - `diff` — el cambio a un archivo, ya estructurado. No hay que reconocer
 *   ningún formato de parche: viene con ruta, texto viejo y texto nuevo.
 * - `terminal` — un proceso que corre en ESTA app (`src/acp/terminal.ts`), y
 *   por eso su salida se ve mientras corre en vez de al final.
 */
function ToolContent({ content, terminals }: { content: acp.ToolCallContent; terminals: Record<string, string> }) {
  if (content.type === "content") {
    const text = blockText(content.content);
    return text ? <Rich text={text} /> : null;
  }
  if (content.type === "diff") return <DiffView diff={content} />;
  return <pre className="chatterm">{terminals[content.terminalId] ?? ""}</pre>;
}

/**
 * Un diff por líneas, calculado aquí porque el protocolo manda los dos textos
 * enteros y no el parche.
 *
 * El algoritmo es el prefijo/sufijo común: se recortan las líneas iguales de
 * los dos extremos y lo que queda en medio es lo que cambió. No es un diff de
 * Myers y no pretende serlo — para lo que llega aquí, que casi siempre es una
 * edición localizada dentro de un archivo, da el mismo resultado y cabe en diez
 * líneas. Un cambio muy repartido se verá como un bloque grande en vez de
 * varios pequeños; nada se pinta mal, solo con menos detalle.
 */
function DiffView({ diff }: { diff: acp.Diff }) {
  const rows = useMemo(() => {
    const before = (diff.oldText ?? "").split("\n");
    const after = diff.newText.split("\n");
    // Un archivo nuevo (`oldText: null`) no tiene nada que comparar: todo es
    // añadido, y `[""]` de un split vacío daría una línea borrada fantasma.
    if (diff.oldText == null) return after.map((line) => ({ sign: "+", line }));

    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) tail++;

    return [
      ...before.slice(head, before.length - tail).map((line) => ({ sign: "-", line })),
      ...after.slice(head, after.length - tail).map((line) => ({ sign: "+", line })),
    ];
  }, [diff.oldText, diff.newText]);

  return (
    <div className="chatdiff">
      <div className="chatdiffpath">{diff.path}</div>
      <pre>
        {rows.map((row, i) => (
          <div key={i} className={row.sign === "+" ? "add" : "del"}>{row.sign} {row.line}</div>
        ))}
      </pre>
    </div>
  );
}

/**
 * Markdown, rendered as React elements — never as HTML.
 *
 * **No markdown is turned into an HTML string.** `marked` can, but injecting
 * model output through `dangerouslySetInnerHTML` is exactly the hole it looks
 * like: it takes only the agent quoting a note that contains an
 * `<img onerror=...>`. So instead of `marked.parse` we use `marked.lexer` to
 * get a token tree and walk it into React nodes. React escapes every text node
 * on its own, so bold, italics, inline code, links, lists, headings and
 * blockquotes all render as real formatting with no injection surface. Fenced
 * code keeps its own block so it stays monospaced and copyable; links are
 * constrained to safe protocols and never carry an `onerror`-style attribute
 * because there is no raw HTML to carry one.
 */
function renderInline(tokens: readonly Token[], keyBase: string): ReactNode[] {
  return (tokens as MarkedToken[]).map((tok, i) => {
    const key = `${keyBase}.${i}`;
    switch (tok.type) {
      case "strong":
        return <strong key={key}>{renderInline(tok.tokens ?? [], key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(tok.tokens ?? [], key)}</em>;
      case "del":
        return <del key={key}>{renderInline(tok.tokens ?? [], key)}</del>;
      case "codespan":
        return <code key={key} className="chatinlinecode">{tok.text}</code>;
      case "br":
        return <br key={key} />;
      case "link": {
        // Only http(s) and mailto survive; anything else renders as its text,
        // so a `javascript:` or `data:` href can never become a live link.
        const safe = /^(https?:|mailto:)/i.test(tok.href ?? "");
        const kids = renderInline(tok.tokens ?? [], key);
        return safe
          ? <a key={key} href={tok.href} target="_blank" rel="noreferrer noopener">{kids}</a>
          : <span key={key}>{kids}</span>;
      }
      // `text` tokens can themselves hold nested inline tokens (e.g. a list
      // item's content); render those, or fall back to the raw string.
      case "text":
        return tok.tokens?.length
          ? <span key={key}>{renderInline(tok.tokens, key)}</span>
          : <span key={key}>{tok.text}</span>;
      default:
        return <span key={key}>{"text" in tok ? (tok as { text?: string }).text ?? "" : ""}</span>;
    }
  });
}

function renderBlocks(tokens: readonly Token[], keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  (tokens as MarkedToken[]).forEach((tok, i) => {
    const key = `${keyBase}.${i}`;
    switch (tok.type) {
      case "code":
        out.push(<pre key={key} className="chatcode" data-lang={tok.lang || undefined}>{tok.text}</pre>);
        break;
      case "heading": {
        const H = (`h${Math.min(tok.depth, 6)}` as "h1");
        out.push(<H key={key} className="chatmd-h">{renderInline(tok.tokens ?? [], key)}</H>);
        break;
      }
      case "blockquote":
        out.push(<blockquote key={key} className="chatmd-quote">{renderBlocks(tok.tokens ?? [], key)}</blockquote>);
        break;
      case "list": {
        const items = tok.items.map((it, j) => (
          <li key={`${key}.${j}`}>{renderBlocks(it.tokens ?? [], `${key}.${j}`)}</li>
        ));
        out.push(tok.ordered
          ? <ol key={key} className="chatmd-list" start={typeof tok.start === "number" ? tok.start : undefined}>{items}</ol>
          : <ul key={key} className="chatmd-list">{items}</ul>);
        break;
      }
      case "hr":
        out.push(<hr key={key} className="chatmd-hr" />);
        break;
      case "space":
        break;
      case "paragraph":
        out.push(<p key={key} className="chatprose">{renderInline(tok.tokens ?? [], key)}</p>);
        break;
      case "text":
        out.push(<p key={key} className="chatprose">{tok.tokens?.length ? renderInline(tok.tokens, key) : tok.text}</p>);
        break;
      default:
        // Unknown block (html, table, etc.): show its source text, escaped by
        // React, rather than dropping it or injecting it.
        if ("text" in tok && (tok as { text?: string }).text) {
          out.push(<p key={key} className="chatprose">{(tok as { text: string }).text}</p>);
        }
    }
  });
  return out;
}

function Rich({ text }: { text: string }) {
  const blocks = useMemo(() => renderBlocks(marked.lexer(text), "b"), [text]);
  return <>{blocks}</>;
}

/**
 * Los comandos de barra del agente, filtrados según lo que se lleva escrito.
 *
 * Aparece solo mientras se escribe el nombre de un comando —`/` y ningún
 * espacio todavía— porque en cuanto empiezan los argumentos ya no hay nada que
 * elegir y la lista taparía la conversación.
 *
 * El texto se completa pero **no se manda**: hay comandos que llevan
 * argumentos (`/model gpt-5.4`), y enviarlos solos haría lo que no se pidió.
 * Por eso se deja el espacio final y el cursor en la caja.
 */
function Commands({
  commands, draft, onPick,
}: { commands: acp.AvailableCommand[]; draft: string; onPick: (name: string) => void }) {
  const match = /^\/([^\s]*)$/.exec(draft);
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  const shown = commands.filter((c) => c.name.toLowerCase().startsWith(prefix));
  if (!shown.length) return null;
  return (
    <ScrollPicker
      items={shown}
      onPick={(command) => onPick(command.name)}
      renderItem={(command, active) => <button key={command.name} className={active ? "active" : undefined}>
        <code>/{command.name}</code>
        <span className="dim">{command.description}</span>
      </button>}
    />
  );
}

/**
 * El permiso.
 *
 * Modal sobre la conversación y no una línea más dentro de ella: el turno está
 * DETENIDO esperando esta respuesta, y algo que bloquea no puede quedarse
 * enterrado bajo el scroll.
 *
 * Los botones son los que manda el agente, con sus propios nombres. No se
 * traducen ni se reordenan: «Allow once» y «Allow always» no significan lo
 * mismo en todos los agentes, y suponer cuál es cuál es exactamente el error
 * que cometía el camino de las banderas.
 */
function PermissionDialog({
  request, onPick,
}: { request: acp.RequestPermissionRequest; onPick: (optionId: string) => void }) {
  const t = useT();
  return (
    <div className="chatperm">
      <p><strong>{t("chat.permission")}</strong> {request.toolCall?.title ?? ""}</p>
      <div className="cfgrow">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            className={`newbtn${option.kind.startsWith("reject") ? " danger" : ""}`}
            onClick={() => onPick(option.optionId)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
