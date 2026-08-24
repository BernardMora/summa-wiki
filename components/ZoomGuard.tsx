"use client";
import { useEffect } from "react";

/**
 * Stops the whole page zooming on a trackpad PINCH — and only on a pinch.
 *
 * A pinch arrives as ctrl+wheel. The PDF viewer wants that gesture for its own
 * zoom, so it is allowed through inside .pdfscroll and swallowed everywhere
 * else: otherwise trying to zoom a PDF near its edge scales the entire UI. Same
 * for Safari's gesture events.
 *
 * ⚠ The keyboard is NOT guarded, and that is the point of this comment. This
 * component used to swallow ⌘/ctrl +/- as well, which took the one zoom people
 * actually ask for along with the accident nobody asks for (issue #16). A pinch
 * is a gesture you make by mistake while scrolling; ⌘+ is a decision. In the
 * browser the key now reaches the browser's own zoom; in the desktop app it
 * reaches the View menu's zoom roles, which is where Electron implements it.
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
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", onGesture as EventListener, { passive: false });
    window.addEventListener("gesturechange", onGesture as EventListener, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", onGesture as EventListener);
      window.removeEventListener("gesturechange", onGesture as EventListener);
    };
  }, []);
  return null;
}
