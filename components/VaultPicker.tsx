"use client";
import { useEffect, useState } from "react";

/**
 * Elegir la carpeta del vault.
 *
 * Vive en dos sitios y por eso es un componente y no parte del panel de
 * configuración: la pantalla de "todavía no hay vault" (primer arranque) y la
 * sección Vault de ese panel (cambiarlo después) son la misma decisión tomada
 * en dos momentos distintos.
 *
 * Dos caminos según dónde corra:
 *
 * - **En Electron** hay diálogo nativo (`window.summa`, ver electron/preload.cjs).
 *   El proceso principal guarda, reinicia el servidor y recarga la ventana; a
 *   este componente no le toca hacer nada más.
 * - **En el navegador** (npm run dev) no hay selector de carpetas que devuelva
 *   una ruta: `<input type="file" webkitdirectory>` da los ARCHIVOS, no la ruta
 *   del directorio, y los nombres que expone son relativos. Por eso queda un
 *   campo de texto, que además es lo que un desarrollador prefiere. Ahí el
 *   reinicio es manual y se dice explícitamente.
 */

export default function VaultPicker({ current, onDone }: { current: string | null; onDone?: () => void }) {
  const [desktop, setDesktop] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [err, setErr] = useState("");
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState(false);

  // En el render del servidor `window` no existe, así que la detección tiene
  // que pasar por un efecto: decidirla durante el render daría hidrataciones
  // distintas en cliente y servidor.
  useEffect(() => setDesktop(typeof window !== "undefined" && !!window.summa), []);

  async function pick() {
    setErr(""); setBusy(true);
    try {
      // Sin await sobre el resultado final: el proceso principal recarga la
      // ventana en cuanto el servidor nuevo responde, así que esta promesa
      // normalmente muere con la página. No es un error.
      await window.summa!.pickVault();
    } catch {
      setErr("no se pudo abrir el selector");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const p = draft.trim();
    if (!p || busy) return;
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/vault", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "no se pudo guardar"); return; }
      if (d.needsRestart) setRestart(true);
      onDone?.();
    } catch {
      setErr("no se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  if (desktop) {
    return (
      <div className="vaultpick">
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                onClick={pick} disabled={busy}>
          {current ? "Cambiar vault…" : "Elegir carpeta…"}
        </button>
        {err && <div className="err">{err}</div>}
      </div>
    );
  }

  return (
    <div className="vaultpick">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        placeholder="~/Documents/mi-wiki"
        spellCheck={false}
      />
      <div className="cfgrow">
        <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                onClick={save} disabled={busy || !draft.trim()}>
          {busy ? "Guardando…" : "Usar esta carpeta"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}
      {restart && (
        <p className="cfghint">
          Guardado. En el navegador el servidor no se reinicia solo: para el
          proceso de <code>npm run dev</code> y vuelve a arrancarlo para que
          tome el vault nuevo.
        </p>
      )}
    </div>
  );
}
