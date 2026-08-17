"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "./I18n";

/**
 * Ayuda del formato de imágenes.
 *
 * Vive en el masthead y no en la spec del vault porque documenta algo que solo
 * existe dentro de esta app: los corchetes del pie de foto (`[izq]`, `[w=220]`)
 * los interpreta el live preview —ver `parseCaption` en `livePreview.ts`— y en
 * cualquier otro renderizador de markdown se leen como texto del pie. Quien
 * escribe la nota necesita saberlo en el momento de escribirla, no al buscar
 * documentación.
 *
 * Los ejemplos se copian al hacer clic. Es lo que convierte el panel en algo
 * usable: la sintaxis es corta pero se escribe mal a la primera —comillas
 * dentro del paréntesis, corchetes ANTES del texto—, y pegar un ejemplo y
 * editarlo es más rápido y menos frágil que teclearla de memoria.
 *
 * Si cambia `DIRECTIVE_RE`, esta tabla se queda mintiendo. Son las dos únicas
 * piezas que describen los atajos, así que se tocan juntas.
 */

/** Los atajos que entiende `parseCaption`, en el orden en que se explican. */
const DIRECTIVES: { syntax: string; key: "help.dirLeft" | "help.dirWide" | "help.dirWidth" }[] = [
  { syntax: "[izq] · [left]", key: "help.dirLeft" },
  { syntax: "[ancho] · [wide]", key: "help.dirWide" },
  { syntax: "[w=500]", key: "help.dirWidth" },
];

/** Ejemplo copiable. El clic copia la línea entera, tal como va en la nota. */
function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Sin portapapeles (navegador sin permiso) el ejemplo se sigue leyendo y
      // se puede seleccionar a mano: no hay nada que avisar.
    }
  }

  return (
    <button className="helpsnip" onClick={copy} title={t("help.copy")}>
      <code>{code}</code>
      <span className="helpcopy">{copied ? t("help.copied") : t("help.copy")}</span>
    </button>
  );
}

export default function Help() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const t = useT();

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

  return (
    <div className="cfgwrap" ref={box}>
      <button
        className="themebtn"
        onClick={() => setOpen((v) => !v)}
        title={t("help.title")}
        aria-label={t("help.title")}
        aria-expanded={open}
      >
        {/* Interrogación en un círculo, del mismo peso que el engrane de al
            lado: los dos abren un panel y tienen que pesar igual en la barra. */}
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8 0.6A7.4 7.4 0 1 0 8 15.4A7.4 7.4 0 0 0 8 0.6ZM8 2.1A5.9 5.9 0 1 1 8 13.9A5.9 5.9 0 0 1 8 2.1Z" />
          <path d="M8 3.6c-1.5 0-2.6.9-2.8 2.3l1.5.2c.1-.7.6-1.1 1.3-1.1.7 0 1.2.4 1.2 1 0 .5-.2.8-.9 1.3-.8.6-1.1 1.1-1.1 2v.4h1.5v-.3c0-.5.2-.8.9-1.3.9-.6 1.2-1.2 1.2-2.1 0-1.4-1.1-2.4-2.8-2.4Z" />
          <path d="M7.9 11a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z" />
        </svg>
      </button>

      {open && (
        <div className="cfgpanel helppanel">
          <div className="cfgsec">{t("help.images")}</div>
          <p className="helptext">{t("help.captionIntro")}</p>
          <Snippet code={`![alt](assets/${t("help.sampleFile")} "${t("help.sampleCaption")}")`} />
          <p className="cfghint">{t("help.captionRule")}</p>

          <div className="cfgsec">{t("help.shortcuts")}</div>
          <p className="helptext">{t("help.shortcutsIntro")}</p>
          <table className="helptable">
            <tbody>
              {DIRECTIVES.map((d) => (
                <tr key={d.syntax}>
                  <td><code>{d.syntax}</code></td>
                  <td>{t(d.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="helptext">{t("help.combineIntro")}</p>
          <Snippet code={`![alt](assets/${t("help.sampleFile")} "[${t("help.sampleDir")}][w=220] ${t("help.sampleCaption")}")`} />

          <div className="cfgsec">{t("help.editing")}</div>
          <ul className="helplist">
            <li>{t("help.editReveal")}</li>
            <li>{t("help.editDefaults")}</li>
            <li>{t("help.editUnknown")}</li>
            <li>{t("help.editPortable")}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
