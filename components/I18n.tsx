"use client";
import { createContext, useContext, useMemo } from "react";
import { makeT, collator, FALLBACK_LOCALE, type Locale, type T } from "@/lib/i18n.ts";

/**
 * El idioma, repartido a los componentes de cliente.
 *
 * Viaja por contexto desde el layout raíz y no por `fetch`: el servidor ya lo
 * sabe al renderizar, y pedirlo desde el cliente significaría pintar la
 * interfaz una vez sin traducir y otra vez con ella. El tema puede permitirse
 * ese parpadeo porque es un atributo en `<html>` que un script inline resuelve
 * antes de pintar; el idioma es el texto mismo.
 *
 * Por eso tampoco vive en `localStorage` como el tema: la mitad de esta app
 * —portada, barra lateral, `<title>`, errores de API— se renderiza en el
 * servidor, y el servidor no ve `localStorage`. La única fuente que los dos
 * lados pueden leer es `settings.json`.
 */
const Ctx = createContext<Locale>(FALLBACK_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

/** El idioma actual, cuando hace falta el dato y no la traducción. */
export function useLocale(): Locale {
  return useContext(Ctx);
}

/**
 * El traductor. `useT()` en cualquier componente de cliente.
 *
 * Memoizado por idioma para no reconstruir la clausura en cada render — no es
 * caro, pero `t` acaba en las dependencias de muchos `useEffect` y una
 * identidad nueva por render los volvería a disparar todos.
 */
export function useT(): T {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}

/** Ordena texto según el idioma. Reemplaza los `localeCompare(x, "es")` sueltos. */
export function useCollator(): Intl.Collator {
  const locale = useLocale();
  return useMemo(() => collator(locale), [locale]);
}
