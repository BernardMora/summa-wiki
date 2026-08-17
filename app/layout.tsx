import "./globals.css";
import "./appearance.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import Masthead from "@/components/Masthead.tsx";
import SideNav from "@/components/SideNav.tsx";
import Resizer from "@/components/Resizer.tsx";
import TabsProvider, { TabBar } from "@/components/Tabs.tsx";
import ZoomGuard from "@/components/ZoomGuard.tsx";
import { readConfig } from "@/src/config.ts";
import { I18nProvider } from "@/components/I18n.tsx";
import { getLocale, getT } from "@/lib/i18n.server.ts";
import { appearanceExists, readAppearance } from "@/src/appearance/store.ts";
import { appearanceAttributes, resolveAppearance } from "@/src/appearance/catalog.ts";
import AppearanceMigration from "@/components/AppearanceMigration.tsx";

/**
 * La identidad sale del vault (`04-Sistema/wiki-config.json`). Se resuelve en
 * el servidor, así que llega ya en el HTML: nada de un fetch en el cliente que
 * haría parpadear el nombre de la app en cada carga.
 *
 * `force-dynamic` porque este layout lee un archivo mutable: el panel de
 * configuración lo reescribe, y también puede tocarlo un agente o el propio
 * usuario a mano. Sin esto, el segmento es candidato a caché y el nombre puede
 * quedarse pegado al de la primera carga.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = readConfig();
  const t = getT();
  return {
    // El nombre y la bajada NO se traducen: salen del vault, los escribió el
    // usuario. Solo la descripción, que es texto de la app.
    title: cfg.tagline ? `${cfg.name} — ${cfg.tagline}` : cfg.name,
    description: t("app.description"),
    icons: { icon: "/api/icon" },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = readConfig();
  const appearance = readAppearance();
  const migrateAppearance = !appearanceExists();
  const resolvedAppearance = resolveAppearance(appearance);
  // Se resuelve una vez aquí y baja por contexto: es el único punto por el que
  // pasan todas las páginas, así que es el único sitio donde hace falta leerlo.
  const locale = getLocale();
  return (
    <html lang={locale} suppressHydrationWarning {...appearanceAttributes(resolvedAppearance)}>
      <head>{migrateAppearance && <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('wiki.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />}</head>
      <body>
        <AppearanceMigration needed={migrateAppearance} />
        <ZoomGuard />
        <Suspense fallback={null}>
        <I18nProvider locale={locale}>
        <TabsProvider>
          <Masthead name={cfg.name} tagline={cfg.tagline} />
          <div className="shell">
            <SideNav />
            <Resizer />
            <div className="content">
              <TabBar />
              {children}
            </div>
          </div>
        </TabsProvider>
        </I18nProvider>
        </Suspense>
      </body>
    </html>
  );
}
