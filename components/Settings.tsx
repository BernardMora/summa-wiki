"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VaultPicker from "./VaultPicker";

/**
 * Panel de configuración, en el sitio donde antes estaba el botón de tema.
 *
 * El tema vive en localStorage (es preferencia del dispositivo: la misma wiki
 * abierta en dos máquinas puede querer claro en una y oscuro en otra). El
 * nombre y la bajada viven en `04-Sistema/wiki-config.json`, dentro del vault,
 * porque son identidad de la wiki y tienen que viajar con ella.
 *
 * Ese reparto no es cosmético: por eso el tema se aplica al instante sin tocar
 * el servidor, y el nombre necesita un POST y un refresh.
 */

type Mode = "system" | "light" | "dark";
const KEY = "wiki.theme";

const MODES: { id: Mode; icon: string; label: string }[] = [
  { id: "system", icon: "◐", label: "Auto" },
  { id: "light", icon: "☀", label: "Claro" },
  { id: "dark", icon: "☾", label: "Oscuro" },
];

interface VaultInfo {
  vault: string | null;
  display: string | null;
  source: "env" | "settings" | "legacy" | "none";
  exists: boolean;
  migrated: string[];
}

/** Por qué la app está mirando ESA carpeta. Ver el CLI, que imprime lo mismo. */
const SOURCE_HINT: Record<VaultInfo["source"], string> = {
  env: "Fijado por la variable WIKI_VAULT: manda sobre lo que se elija aquí.",
  settings: "Elegido en la app.",
  legacy: "La ruta histórica. Elige una carpeta para fijarla y dejar de depender del default.",
  none: "Sin vault configurado.",
};

export default function Settings({ name, tagline }: { name: string; tagline: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("system");
  const [draftName, setDraftName] = useState(name);
  const [draftTag, setDraftTag] = useState(tagline);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Se pide al abrir, no al montar: el panel vive en el masthead de cada
  // página y la ruta del vault no cambia sola. Pedirla en cada carga sería una
  // petición por navegación para un dato que casi nadie mira.
  useEffect(() => {
    if (!open || vault) return;
    fetch("/api/vault").then((r) => r.json()).then(setVault).catch(() => {});
  }, [open, vault]);

  useEffect(() => {
    const s = localStorage.getItem(KEY) as Mode | null;
    if (s === "light" || s === "dark" || s === "system") setMode(s);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    localStorage.setItem(KEY, mode);
  }, [mode]);

  // El servidor manda: si el nombre cambia por fuera (editando el JSON a mano,
  // o un agente), el borrador se re-sincroniza en vez de quedarse viejo.
  useEffect(() => { setDraftName(name); setDraftTag(tagline); }, [name, tagline]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const dirty = draftName.trim() !== name || draftTag.trim() !== tagline;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, tagline: draftTag }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "no se pudo guardar"); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      // El nombre lo pintan componentes de servidor (masthead, barra lateral,
      // <title>): hay que pedirle a Next que los vuelva a renderizar.
      router.refresh();
    } catch {
      setErr("no se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cfgwrap" ref={box}>
      <button
        className="themebtn"
        onClick={() => setOpen((v) => !v)}
        title="Configuración"
        aria-label="Configuración"
        aria-expanded={open}
      >
        {/*
          Engrane, no el sol de antes: ese icono venía de cuando el botón solo
          alternaba el tema, y desde que abre el panel entero prometía otra cosa.

          Va RELLENO y no de trazo como el resto de los iconos del árbol. A 13 px
          un engrane de contorno no cabe: sus dientes miden fracciones de píxel y
          el trazo los cierra hasta volverlos una rueda lisa. Relleno, cada diente
          es una silueta a contraste pleno y se sigue leyendo. Seis dientes por lo
          mismo — con ocho, los huecos se funden entre sí a este tamaño.
        */}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"
             fillRule="evenodd" aria-hidden="true">
          <path d="M6.57 3.31L6.61 0.83A7.3 7.3 0 0 1 9.39 0.83L9.43 3.31A4.9 4.9 0 0 1 11.34 4.42L13.51 3.21A7.3 7.3 0 0 1 14.90 5.62L12.77 6.90A4.9 4.9 0 0 1 12.77 9.10L14.90 10.38A7.3 7.3 0 0 1 13.51 12.79L11.34 11.58A4.9 4.9 0 0 1 9.43 12.69L9.39 15.17A7.3 7.3 0 0 1 6.61 15.17L6.57 12.69A4.9 4.9 0 0 1 4.66 11.58L2.49 12.79A7.3 7.3 0 0 1 1.10 10.38L3.23 9.10A4.9 4.9 0 0 1 3.23 6.90L1.10 5.62A7.3 7.3 0 0 1 2.49 3.21L4.66 4.42ZM8 5.25A2.75 2.75 0 1 0 8 10.75A2.75 2.75 0 1 0 8 5.25Z" />
        </svg>
      </button>

      {open && (
        <div className="cfgpanel">
          <div className="cfgsec">Tema</div>
          <div className="cfgmodes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={mode === m.id ? "on" : ""}
                onClick={() => setMode(m.id)}
              >{m.icon} {m.label}</button>
            ))}
          </div>

          <div className="cfgsec">Nombre de la wiki</div>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Summa Wiki"
            maxLength={60}
          />
          <input
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Bajada (opcional)"
            maxLength={80}
          />
          {err && <div className="err">{err}</div>}
          <div className="cfgrow">
            <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                    disabled={!dirty || saving} onClick={save}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
            {saved && <span className="dim">guardado</span>}
          </div>
          <p className="cfghint">
            Se guarda en <code>.summa/config.json</code>, dentro del vault.
            El icono del Dock y el nombre de la ventana se actualizan al reiniciar la app.
          </p>

          {/*
            El vault va ABAJO y separado del resto: es la única opción del
            panel que descarta todo lo que hay en pantalla y vuelve a arrancar
            el servidor. Mezclarla con el nombre y el tema —que se aplican al
            instante— invitaría a tocarla sin querer.
          */}
          <div className="cfgsec">Vault</div>
          {vault ? (
            <>
              <code className="cfgpath">{vault.display}</code>
              <p className="cfghint">{SOURCE_HINT[vault.source]}</p>
            </>
          ) : (
            <p className="cfghint">Sin vault configurado.</p>
          )}
          <VaultPicker current={vault?.vault ?? null} />
          {/* Cambiar y crear son cosas distintas: la de arriba abre una carpeta
              que ya existe, esta monta una estructura nueva. Sin esta entrada,
              el asistente de creación solo se alcanzaba en el primer arranque. */}
          <a className="cfglink" href="/setup?new=1">Crear un vault nuevo…</a>

          <div className="cfgsec">Contenido</div>
          <a className="cfglink" href="/ingest">Traer carpetas al vault…</a>
        </div>
      )}
    </div>
  );
}
