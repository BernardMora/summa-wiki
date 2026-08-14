"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * Shell real dentro de la app — para no saltar de pestaña a correr Claude
 * Code (u otro comando) mientras se trabaja en una nota.
 *
 * La pty vive en el servidor (server.ts) bajo `id`, no en esta conexión:
 * cambiar de pestaña, mover el panel o recargar la página solo cierra el
 * WebSocket, no la shell — al volver, se reengancha a la misma sesión y
 * redibuja lo último que había en pantalla. Cerrar la pestaña con la × sí la
 * mata (ver Workspace.tsx → closeTab).
 *
 * Se conecta al puerto principal + 1, no al mismo puerto que sirve las
 * páginas — ver el comentario grande en server.ts sobre por qué la terminal
 * necesita su propio `http.Server`.
 */

function currentTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || undefined;
  return { background: v("--bg"), foreground: v("--fg"), cursor: v("--fg"), selectionBackground: v("--sel") };
}

interface Entry {
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
  ro: ResizeObserver;
  mo: MutationObserver;
  mq: MediaQueryList;
  repaint: () => void;
  teardown: ReturnType<typeof setTimeout> | null;
}

/**
 * Un WebSocket + Terminal por id, fuera de React — para sobrevivir al doble
 * montaje de efectos que hace StrictMode en desarrollo (monta → limpia →
 * monta, contra el mismo host, en microsegundos).
 *
 * Sin esto, cada apertura de una pestaña abría dos conexiones reales de
 * WebSocket casi simultáneas al mismo id. En vez de perseguir esa carrera a
 * nivel de red, se evita crear la segunda conexión: la limpieza real se
 * difiere, y si el mismo id vuelve a montarse antes de que corra, se cancela
 * y se reutiliza tal cual. Un cambio de pestaña genuino, segundos después, sí
 * llega a limpiar y a abrir una conexión nueva — solo la ventana de
 * milisegundos de StrictMode queda absorbida.
 */
const registry = new Map<string, Entry>();

/**
 * Comandos que deben ejecutarse al abrir una terminal, por id de pestaña.
 *
 * Un buzón fuera de React, como el `registry` de arriba y por el mismo motivo:
 * quien programa el comando (la ingesta) y quien abre la pestaña (el workspace)
 * no comparten árbol de componentes, y pasarlo por props obligaría a enhebrar
 * el dato por cinco niveles que no lo usan.
 */
const pendingCmd = new Map<string, string>();

const pendingCwd = new Map<string, string>();

/** Programa un comando —y opcionalmente un directorio— para la próxima terminal con ese id. */
export function runInNewTerminal(id: string, cmd: string, cwd?: string) {
  pendingCmd.set(id, cmd);
  if (cwd) pendingCwd.set(id, cwd);
}

export default function TerminalPane({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let entry = registry.get(id);
    if (entry && entry.teardown !== null) {
      clearTimeout(entry.teardown);
      entry.teardown = null;
    } else if (!entry) {
      const term = new Terminal({
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 13,
        cursorBlink: true,
        theme: currentTheme(),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const termPort = Number(location.port || (location.protocol === "https:" ? 443 : 80)) + 1;
      const cmd = pendingCmd.get(id) ?? "";
      const cwd = pendingCwd.get(id) ?? "";
      // De un solo uso: reengancharse a la pestaña no debe relanzar el comando.
      pendingCmd.delete(id);
      pendingCwd.delete(id);
      const q = new URLSearchParams({ id });
      if (cmd) q.set("cmd", cmd);
      if (cwd) q.set("cwd", cwd);
      const ws = new WebSocket(`${proto}//${location.hostname}:${termPort}/api/terminal?${q}`);

      const sendResize = () => {
        fit.fit();
        // U+E000: ver el comentario en server.ts — \x01 colisionaba con
        // Ctrl-A, un tecleo real (Cmd+flecha lo manda para ir al inicio de
        // línea).
        if (ws.readyState === ws.OPEN) ws.send("" + JSON.stringify({ cols: term.cols, rows: term.rows }));
      };
      ws.onopen = sendResize;
      ws.onmessage = (e) => term.write(e.data as string);
      ws.onclose = () => term.write("\r\n\x1b[2m— sesión terminada —\x1b[0m\r\n");
      term.onData((s) => { if (ws.readyState === ws.OPEN) ws.send(s); });

      // xterm no tiene mapeo propio para estos: Cmd+flecha/Delete se los
      // quedaba el navegador (navegar atrás/adelante) o el textarea oculto
      // (mover el cursor dentro de él, invisible en la pantalla del
      // terminal) en vez de llegar a la shell. Se envían los mismos
      // controles que usa Terminal.app con zsh/readline.
      //
      // Shift+Space no manda un byte fijo, sino la marca U+E001, porque el
      // byte correcto depende de qué proceso esté al frente y eso solo lo
      // sabe el servidor (ver server.ts). Resumen: dentro de Claude Code
      // es un salto de línea; en el prompt de la shell, un espacio normal.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const send = (bytes: string) => { e.preventDefault(); if (ws.readyState === ws.OPEN) ws.send(bytes); return false; };
        if (e.metaKey && e.key === "ArrowLeft") return send("\x01");   // Ctrl-A: inicio de línea
        if (e.metaKey && e.key === "ArrowRight") return send("\x05");  // Ctrl-E: fin de línea
        if (e.metaKey && e.key === "Backspace") return send("\x15");   // Ctrl-U: borrar la línea
        // `code` además de `key`: el primero es la tecla física, y no depende
        // de la distribución del teclado ni de cómo el navegador decida
        // reportar un espacio con mayúscula.
        if (e.shiftKey && (e.key === " " || e.code === "Space")) return send("");
        return true;
      });

      const ro = new ResizeObserver(sendResize);
      // Repinta cuando cambia el tema (toggle explícito o preferencia del
      // sistema en modo "auto"): xterm no lee variables CSS por sí solo.
      const repaint = () => { term.options.theme = currentTheme(); };
      const mo = new MutationObserver(repaint);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", repaint);

      entry = { term, fit, ws, ro, mo, mq, repaint, teardown: null };
      registry.set(id, entry);
    }

    // El host cambia en cada montaje real (tab distinto en el DOM) aunque el
    // id sea el mismo — p. ej. al arrastrar la pestaña a otro panel para la
    // vista dividida. Reparenta el nodo del terminal en vez de reabrirlo:
    // xterm.open() exige que el contenedor ya tenga dimensiones reales en
    // ese instante, y el panel recién creado por el split puede no haber
    // asentado su layout todavía — se veía como una terminal que ya no
    // pintaba texto tras moverla, aunque los datos le siguieran llegando.
    // Mover el DOM ya renderizado no reinicializa nada.
    if (!host.contains(entry.term.element ?? null) && entry.term.element) {
      host.appendChild(entry.term.element);
    }
    entry.fit.fit();
    entry.term.focus();
    entry.ro.observe(host);

    return () => {
      entry!.ro.unobserve(host);
      entry!.teardown = setTimeout(() => {
        registry.delete(id);
        entry!.mo.disconnect();
        entry!.mq.removeEventListener("change", entry!.repaint);
        entry!.ws.close();
        entry!.term.dispose();
      }, 300);
    };
  }, [id]);

  return <div ref={hostRef} className="termhost" />;
}
