"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const KEY = "wiki.theme";

/** Cycles system → light → dark. "system" clears the attribute and follows the OS. */
export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    const saved = localStorage.getItem(KEY) as Mode | null;
    if (saved === "light" || saved === "dark" || saved === "system") setMode(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    localStorage.setItem(KEY, mode);
  }, [mode]);

  const next: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const label: Record<Mode, string> = { system: "Auto", light: "Claro", dark: "Oscuro" };
  const icon: Record<Mode, string> = { system: "◐", light: "☀", dark: "☾" };

  return (
    <button
      className="themebtn"
      onClick={() => setMode(next[mode])}
      title={`Tema: ${label[mode]} — clic para cambiar`}
      aria-label={`Tema: ${label[mode]}`}
    >
      {icon[mode]} {label[mode]}
    </button>
  );
}
