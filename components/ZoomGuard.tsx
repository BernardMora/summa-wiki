"use client";
import { useEffect } from "react";

/**
 * Stops the browser zooming the whole page on a trackpad pinch.
 *
 * A pinch arrives as ctrl+wheel. The PDF viewer wants that gesture for its own
 * zoom, so it is allowed through inside .pdfscroll and swallowed everywhere
 * else — otherwise trying to zoom a PDF near its edge scales the entire UI.
 * Also covers Safari's gesture events and ctrl +/- keyboard zoom.
 */
export default function ZoomGuard() {
  useEffect(() => {
    const insidePdf = (t: EventTarget | null) =>
      t instanceof Element && Boolean(t.closest(".pdfscroll"));

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;              // plain scroll: leave alone
      if (insidePdf(e.target)) return;     // the PDF handles its own zoom
      e.preventDefault();
    };
    const onGesture = (e: Event) => {
      if (insidePdf(e.target)) return;
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && ["+", "-", "=", "_"].includes(e.key)) e.preventDefault();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", onGesture as EventListener, { passive: false });
    window.addEventListener("gesturechange", onGesture as EventListener, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", onGesture as EventListener);
      window.removeEventListener("gesturechange", onGesture as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
