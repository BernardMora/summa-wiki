"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VaultPicker from "./VaultPicker";
import { useT, useLocale } from "./I18n";
import { LOCALES, type Locale } from "@/lib/i18n.ts";
import AppearanceDesigner from "./AppearanceDesigner.tsx";

/**
 * Panel de configuración, en el sitio donde antes estaba el botón de tema.
 *
 * La apariencia y la identidad viven dentro del vault: la primera en
 * `.summa/appearance.json` y la segunda en `.summa/config.json`. Ambas viajan
 * con la wiki; el diseñador previsualiza en el cliente y solo escribe al
 * pulsar Aplicar.
 *
 * El IDIOMA es el tercer caso y no encaja en ninguno de los dos anteriores. Es
 * preferencia del dispositivo —el mismo vault se puede leer en dos idiomas en
 * dos máquinas— pero no puede vivir en localStorage, porque media
 * interfaz la pinta el servidor. Va en `settings.json` de la máquina, y por eso
 * necesita POST + refresh aunque no sea identidad de la wiki.
 */

/**
 * El nombre de cada idioma, EN ese idioma.
 *
 * No se traduce y no debe traducirse: quien tiene la app en un idioma que no
 * entiende necesita reconocer el suyo en la lista, y «Spanish» no le sirve de
 * nada a quien solo lee español. Es la convención de cualquier selector de
 * idioma serio, y la razón por la que estas dos cadenas no están en el
 * diccionario.
 */
const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

interface VaultInfo {
  vault: string | null;
  display: string | null;
  source: "env" | "settings" | "legacy" | "none";
  exists: boolean;
  migrated: string[];
}

/** Por qué la app está mirando ESA carpeta. Ver el CLI, que imprime lo mismo. */
const SOURCE_HINT = {
  env: "vault.sourceEnv",
  settings: "vault.sourceSettings",
  legacy: "vault.sourceLegacy",
  none: "vault.sourceNone",
} as const;

export default function Settings({ name, tagline }: { name: string; tagline: string }) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftTag, setDraftTag] = useState(tagline);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [switching, setSwitching] = useState<Locale | null>(null);

  // Se pide al abrir, no al montar: el panel vive en el masthead de cada
  // página y la ruta del vault no cambia sola. Pedirla en cada carga sería una
  // petición por navegación para un dato que casi nadie mira.
  useEffect(() => {
    if (!open || vault) return;
    fetch("/api/vault").then((r) => r.json()).then(setVault).catch(() => {});
  }, [open, vault]);

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

  /**
   * Cambia el idioma de la interfaz.
   *
   * Optimista sería un error aquí: el texto que hay que repintar lo produce el
   * servidor, así que hasta que `router.refresh()` no vuelve no hay nada nuevo
   * que mostrar. El estado `switching` marca cuál se está aplicando para que el
   * botón no parezca muerto durante ese viaje.
   *
   * No reinicia el servidor —el idioma se resuelve por petición— pero el menú
   * nativo de Electron sí vive en otro proceso y se entera por su cuenta: main
   * vigila `settings.json`. Ver `electron/main.js`.
   */
  async function switchLocale(next: Locale) {
    if (next === locale || switching) return;
    setSwitching(next); setErr("");
    try {
      const r = await fetch("/api/locale", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!r.ok) { setErr(t("settings.saveFailed")); return; }
      // El menú nativo lo pinta el proceso principal de Electron, que no ve
      // este POST. En el navegador `window.summa` no existe y no hay menú que
      // arreglar, así que el encadenamiento opcional es la comprobación entera.
      window.summa?.localeChanged().catch(() => {});
      router.refresh();
    } catch {
      setErr(t("settings.saveFailed"));
    } finally {
      setSwitching(null);
    }
  }

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
      if (!r.ok) { setErr(d.error ?? t("settings.saveFailed")); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      // El nombre lo pintan componentes de servidor (masthead, barra lateral,
      // <title>): hay que pedirle a Next que los vuelva a renderizar.
      router.refresh();
    } catch {
      setErr(t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cfgwrap" ref={box}>
      <button
        className="themebtn"
        onClick={() => setOpen((v) => !v)}
        title={t("settings.title")}
        aria-label={t("settings.title")}
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
          <div className="cfgsec">{t("settings.appearance")}</div>
          <AppearanceDesigner />

          {/*
            El idioma va junto al tema y no abajo con el vault: los dos son
            preferencias de quien mira la pantalla y ninguno destruye nada. El
            vault está abajo porque es el único ajuste del panel que tira todo
            lo que hay en pantalla.
          */}
          <div className="cfgsec">{t("settings.language")}</div>
          <div className="cfgmodes">
            {LOCALES.map((l) => (
              <button
                key={l}
                className={locale === l ? "on" : ""}
                disabled={!!switching}
                onClick={() => switchLocale(l)}
                lang={l}
              >{switching === l ? "…" : LOCALE_NAMES[l]}</button>
            ))}
          </div>
          <p className="cfghint">{t("settings.languageHint")}</p>

          <div className="cfgsec">{t("settings.wikiName")}</div>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder={t("settings.wikiNamePlaceholder")}
            maxLength={60}
          />
          <input
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder={t("settings.taglinePlaceholder")}
            maxLength={80}
          />
          {err && <div className="err">{err}</div>}
          <div className="cfgrow">
            <button className="newbtn" style={{ margin: 0, width: "auto", padding: "4px 12px" }}
                    disabled={!dirty || saving} onClick={save}>
              {saving ? t("common.saving") : t("common.save")}
            </button>
            {saved && <span className="dim">{t("common.saved")}</span>}
          </div>
          <p className="cfghint">{t("settings.configHint", { file: ".summa/config.json" })}</p>

          {/*
            El vault va ABAJO y separado del resto: es la única opción del
            panel que descarta todo lo que hay en pantalla y vuelve a arrancar
            el servidor. Mezclarla con el nombre y el tema —que se aplican al
            instante— invitaría a tocarla sin querer.
          */}
          <div className="cfgsec">{t("settings.vault")}</div>
          {vault ? (
            <>
              <code className="cfgpath">{vault.display}</code>
              <p className="cfghint">{t(SOURCE_HINT[vault.source])}</p>
            </>
          ) : (
            <p className="cfghint">{t("settings.noVault")}</p>
          )}
          <VaultPicker current={vault?.vault ?? null} />
          {/* Cambiar y crear son cosas distintas: la de arriba abre una carpeta
              que ya existe, esta monta una estructura nueva. Sin esta entrada,
              el asistente de creación solo se alcanzaba en el primer arranque. */}
          <a className="cfglink" href="/setup?new=1">{t("settings.newVault")}</a>

          <div className="cfgsec">{t("settings.content")}</div>
          <a className="cfglink" href="/ingest">{t("settings.ingest")}</a>
        </div>
      )}
    </div>
  );
}
