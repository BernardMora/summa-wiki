import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import Masthead from "@/components/Masthead.tsx";
import SideNav from "@/components/SideNav.tsx";
import Resizer from "@/components/Resizer.tsx";
import TabsProvider, { TabBar } from "@/components/Tabs.tsx";
import ZoomGuard from "@/components/ZoomGuard.tsx";
import { readConfig } from "@/src/config.ts";

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
  return {
    title: cfg.tagline ? `${cfg.name} — ${cfg.tagline}` : cfg.name,
    description: "Lector y editor local de la base de conocimiento del AIOS",
    icons: { icon: "/api/icon" },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = readConfig();
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('wiki.theme');" +
              "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
      </head>
      <body>
        <ZoomGuard />
        <Suspense fallback={null}>
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
        </Suspense>
      </body>
    </html>
  );
}
