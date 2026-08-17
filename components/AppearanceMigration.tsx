"use client";
import { useEffect } from "react";
import { DEFAULT_APPEARANCE } from "@/src/appearance/catalog.ts";

/** One-time bridge from the old device preference to the vault-owned setting. */
export default function AppearanceMigration({ needed }: { needed: boolean }) {
  useEffect(() => {
    if (!needed) return;
    const legacy = localStorage.getItem("wiki.theme");
    if (legacy !== "light" && legacy !== "dark" && legacy !== "system") return;
    localStorage.removeItem("wiki.theme");
    if (legacy === "system") return;
    fetch("/api/appearance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_APPEARANCE, mode: legacy }),
    }).catch(() => {});
  }, [needed]);
  return null;
}
