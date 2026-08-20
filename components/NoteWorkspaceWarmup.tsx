"use client";
import { useEffect } from "react";

/**
 * Home no monta el editor, pero casi toda salida útil desde Home sí.
 * Descarga su chunk cuando el navegador queda ocioso para que el primer clic
 * no pague a la vez navegación, parseo de CodeMirror y montaje del workspace.
 * No pide ninguna nota ni recorre links: solo calienta código estático local.
 */
export default function NoteWorkspaceWarmup() {
  useEffect(() => {
    let cancelled = false;
    const warm = () => { if (!cancelled) void import("./ArticleClient.tsx"); };
    const browser = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idle = browser.requestIdleCallback?.(warm, { timeout: 1_500 });
    const timer = idle === undefined ? window.setTimeout(warm, 500) : null;
    return () => {
      cancelled = true;
      if (idle !== undefined) browser.cancelIdleCallback?.(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
  return null;
}
